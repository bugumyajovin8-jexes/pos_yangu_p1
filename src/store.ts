import { create } from 'zustand';
import { Product, User, Feature } from './db';
import { Language, translations, TranslationKey } from './translations';

interface CartItem extends Product {
  qty: number;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'alert' | 'confirm';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface PosState {
  cart: CartItem[];
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  clearCart: () => void;
  cartTotal: () => number;
  cartProfit: () => number;
  
  // Auth
  isAuthenticated: boolean;
  token: string | null;
  user: User | null;
  authError: string | null;
  setAuth: (token: string | null, user: User | null) => void;
  updateUser: (userUpdates: Partial<User>) => void;
  logout: (error?: string) => void;
  setAuthError: (error: string | null) => void;
  
  // Features
  features: Feature[];
  setFeatures: (features: Feature[]) => void;
  isFeatureEnabled: (featureKey: string) => boolean;
  
  // Modal
  modal: ModalConfig;
  showAlert: (title: string, message: string) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => void;
  hideModal: () => void;

  // Language
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

export const useStore = create<PosState>((set, get) => ({
  cart: [],
  addToCart: (product) => set((state) => {
    const existing = state.cart.find(item => item.id === product.id);
    if (existing) {
      if (existing.qty >= product.stock) {
        return state;
      }
      return {
        cart: state.cart.map(item => 
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        )
      };
    }
    if (product.stock <= 0) return state;
    return { cart: [...state.cart, { ...product, qty: 1 }] };
  }),
  removeFromCart: (productId) => set((state) => ({
    cart: state.cart.filter(item => item.id !== productId)
  })),
  updateQty: (productId, qty) => set((state) => {
    const item = state.cart.find(i => i.id === productId);
    if (item && qty > item.stock) {
      return state;
    }
    return {
      cart: state.cart.map(item => 
        item.id === productId ? { ...item, qty } : item
      )
    };
  }),
  clearCart: () => set({ cart: [] }),
  cartTotal: () => get().cart.reduce((total, item) => total + (item.sell_price * item.qty), 0),
  cartProfit: () => get().cart.reduce((total, item) => total + ((item.sell_price - item.buy_price) * item.qty), 0),
  
  isAuthenticated: false,
  token: localStorage.getItem('pos_token') || null,
  user: JSON.parse(localStorage.getItem('pos_user') || 'null'),
  authError: null,
  setAuth: (token, user) => {
    if (token && user) {
      // Normalize shopId/shop_id for web compatibility
      const normalizedUser = {
        ...user,
        shopId: user.shopId || user.shop_id,
        shop_id: user.shop_id || user.shopId
      };
      localStorage.setItem('pos_token', token);
      localStorage.setItem('pos_user', JSON.stringify(normalizedUser));
      set({ isAuthenticated: true, token, user: normalizedUser, authError: null });
    } else {
      localStorage.removeItem('pos_token');
      localStorage.removeItem('pos_user');
      set({ isAuthenticated: false, token: null, user: null });
    }
  },
  updateUser: (userUpdates) => set((state) => {
    if (!state.user) return state;
    const updatedUser = { ...state.user, ...userUpdates };
    localStorage.setItem('pos_user', JSON.stringify(updatedUser));
    return { user: updatedUser };
  }),
  logout: (error) => {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    set({ isAuthenticated: false, token: null, user: null, cart: [], authError: error || null });
  },
  setAuthError: (error) => set({ authError: error }),
  
  features: [],
  setFeatures: (features) => set({ features }),
  isFeatureEnabled: (featureKey: string) => {
    const state = get();
    const user = state.user;
    if (user && ['admin', 'boss', 'superadmin', 'owner'].includes(user.role)) return true;
    
    // Find feature by key (handle both camelCase and snake_case just in case)
    const feature = state.features.find(f => f.featureKey === featureKey || (f as any).feature_key === featureKey);
    
    if (!feature) return false;
    
    // Robust boolean check (handles true, "true", 1, "1")
    const isEnabled = feature.isEnabled === true || 
                     (feature.isEnabled as any) === 1 || 
                     String(feature.isEnabled).toLowerCase() === 'true' ||
                     String(feature.isEnabled) === '1';
                     
    return isEnabled;
  },
  
  modal: {
    isOpen: false,
    type: 'alert',
    title: '',
    message: ''
  },
  showAlert: (title, message) => set({
    modal: { isOpen: true, type: 'alert', title, message }
  }),
  showConfirm: (title, message, onConfirm, onCancel) => set({
    modal: { isOpen: true, type: 'confirm', title, message, onConfirm, onCancel }
  }),
  hideModal: () => set((state) => ({
    modal: { ...state.modal, isOpen: false }
  })),

  language: (localStorage.getItem('pos_lang') as Language) || 'sw',
  setLanguage: (lang) => {
    localStorage.setItem('pos_lang', lang);
    set({ language: lang });
  },
  t: (key) => {
    const lang = get().language;
    return translations[lang][key] || translations['sw'][key] || key;
  }
}));

// Initialize auth state if token exists
const initialToken = localStorage.getItem('pos_token');
if (initialToken) {
  useStore.setState({ isAuthenticated: true });
}
