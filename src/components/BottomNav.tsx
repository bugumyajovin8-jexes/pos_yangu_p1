import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Users, 
  History, 
  Settings,
  Receipt,
  AlertTriangle,
  Zap
} from 'lucide-react';
import { useStore } from '../store';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useFeatureToggles } from '../hooks/useFeatureToggles';

export default function BottomNav() {
  const user = useStore(state => state.user);
  const t = useStore(state => state.t);
  const { isFeatureEnabled } = useFeatureToggles();
  const shop = useLiveQuery(() => 
    user?.shop_id ? db.shops.get(user.shop_id) : null
  , [user?.shop_id]);

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: t('dashboard').substring(0, 5) },
    { to: '/bidhaa', icon: Package, label: t('products') },
    { to: '/kikapu', icon: ShoppingCart, label: t('cart') },
    { to: '/madeni', icon: Users, label: t('debts') },
    ...(isFeatureEnabled('staff_expense_management') ? [{ to: '/matumizi', icon: Receipt, label: t('expenses') }] : []),
    { to: '/zaidi', icon: Settings, label: t('more') },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-1 z-50 flex justify-around items-center">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center py-1 px-2 rounded-lg transition-colors ${
              isActive
                ? 'text-blue-600'
                : 'text-slate-500 hover:text-slate-900'
            }`
          }
        >
          <item.icon className="w-6 h-6" />
          <span className="text-[10px] font-medium mt-0.5">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
