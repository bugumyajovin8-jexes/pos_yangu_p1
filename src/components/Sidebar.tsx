import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Users, 
  History, 
  Settings, 
  LogOut,
  Store,
  Receipt,
  AlertTriangle
} from 'lucide-react';
import { useStore } from '../store';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useFeatureToggles } from '../hooks/useFeatureToggles';

export default function Sidebar() {
  const logout = useStore(state => state.logout);
  const user = useStore(state => state.user);
  const t = useStore(state => state.t);
  const { isFeatureEnabled } = useFeatureToggles();

  const shop = useLiveQuery(() => 
    user?.shop_id ? db.shops.get(user.shop_id) : null
  , [user?.shop_id]);

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t('dashboard') },
    { to: '/bidhaa', icon: Package, label: t('products') },
    { to: '/kikapu', icon: ShoppingCart, label: t('cart') },
    { to: '/historia', icon: History, label: t('history') },
    { to: '/madeni', icon: Users, label: t('debts') },
    ...(isFeatureEnabled('staff_expense_management') ? [{ to: '/matumizi', icon: Receipt, label: t('expenses') }] : []),
    { to: '/zaidi', icon: Settings, label: t('more') },
    ...(shop?.enable_expiry ? [{ to: '/expiry', icon: AlertTriangle, label: t('expiryTracking') }] : []),
  ];

  return (
    <aside className="hidden md:flex w-64 bg-slate-900 text-white h-screen flex-col sticky top-0">
      <div className="p-6 flex items-center space-x-3 border-b border-slate-800">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center overflow-hidden">
          <img src="/logo.png" alt="Venics Sales" className="w-full h-full object-cover" onError={(e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.nextElementSibling?.classList.remove('hidden');
          }} />
          <Store className="w-6 h-6 text-white hidden" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-lg leading-none truncate">{shop?.name || 'Venics Sales'}</h1>
          <p className="text-xs text-slate-400 mt-1">{t('desktopEdition')}</p>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2 mt-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            <span className="font-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center space-x-3 px-4 py-3 mb-4">
          <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-xs font-bold">
            {user?.name?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
            <p className="text-xs text-slate-500 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={() => logout()}
          className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-500 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">{t('logout')}</span>
        </button>
      </div>
    </aside>
  );
}
