import { useState } from 'react';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { getValidStock } from '../utils/stock';
import { startOfDay, startOfMonth, subMonths, differenceInDays, isPast, parseISO } from 'date-fns';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, YAxis, CartesianGrid } from 'recharts';
import { AlertTriangle, TrendingUp, TrendingDown, DollarSign, Package, ShieldCheck, CreditCard, ChevronRight, RefreshCw, Calendar, ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSupabaseData } from '../hooks/useSupabaseData';
import { db } from '../db';
import LowStockModal from '../components/LowStockModal';
import { useLiveQuery } from 'dexie-react-hooks';
import { useFeatureToggles } from '../hooks/useFeatureToggles';

export default function Dashibodi() {
  const user = useStore(state => state.user);
  const t = useStore(state => state.t);
  const navigate = useNavigate();
  const { isFeatureEnabled } = useFeatureToggles();
  const canManageProducts = isFeatureEnabled('staff_product_management');

  const isAdmin = ['admin', 'boss', 'superadmin', 'owner'].includes(user?.role || '');

  const { data: sales, loading: salesLoading } = useSupabaseData<any>('sales', { allTime: true });
  const { data: products, loading: productsLoading } = useSupabaseData<any>('products');
  const { data: expenses, loading: expensesLoading } = useSupabaseData<any>('expenses', { days: 60 });
  const { data: debtPayments, loading: paymentsLoading } = useSupabaseData<any>('debtPayments', { allTime: true });
  const [showLowStockModal, setShowLowStockModal] = useState(false);

  const shopSettings = useLiveQuery(
    () => db.settings.get(1),
    []
  );

  const shop = useLiveQuery(
    () => user?.shop_id ? db.shops.get(user.shop_id) : undefined,
    [user?.shop_id]
  );

  const mergedSettings: any = {
    ...shopSettings,
    ...shop
  };

  const license = useLiveQuery(
    () => db.license.get(1),
    []
  );

  const currency = shopSettings?.currency || 'TZS';

  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const monthStart = startOfMonth(now).getTime();
  const lastMonthStart = startOfMonth(subMonths(now, 1)).getTime();

  // Boss sees all shop sales, Staff sees only their own
  const mySales = sales.filter(s => isAdmin ? true : s.user_id === user?.id);

  const isActiveSale = (s: any) => !s.is_deleted && s.status !== 'cancelled' && s.status !== 'refunded';

  const todaySales = mySales.filter(s => isActiveSale(s) && new Date(s.created_at).getTime() >= todayStart);
  const monthSales = mySales.filter(s => isActiveSale(s) && new Date(s.created_at).getTime() >= monthStart);
  const lastMonthSales = mySales.filter(s => {
    const saleTime = new Date(s.created_at).getTime();
    return isActiveSale(s) && saleTime >= lastMonthStart && saleTime < monthStart;
  });

  const calcTotal = (arr: any[]) => arr.reduce((sum, s) => sum + s.total_amount, 0);

  const currentMonthTotal = calcTotal(monthSales);
  const lastMonthTotal = calcTotal(lastMonthSales);
  const percentChange = lastMonthTotal > 0 
    ? ((currentMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 
    : (currentMonthTotal > 0 ? 100 : 0);

  const activeProducts = products;
  const totalStock = activeProducts.reduce((sum, p) => sum + p.stock, 0);
  const lowStockProducts = activeProducts.filter(p => p.stock <= (p.min_stock || 5));

  // Calculate expiring products
  const expiringItems = activeProducts.flatMap(product => {
    if (!product.batches) return [];
    
    return product.batches
      .filter((batch: any) => batch.expiry_date && batch.stock > 0)
      .map((batch: any) => {
        const expiryDate = parseISO(batch.expiry_date);
        const daysUntilExpiry = differenceInDays(expiryDate, new Date());
        const notifyDays = product.notify_expiry_days || 30;
        
        return {
          ...product,
          batchId: batch.id,
          batchStock: batch.stock,
          expiryDate: batch.expiry_date,
          daysUntilExpiry,
          notifyDays,
          isExpired: isPast(expiryDate) && daysUntilExpiry < 0,
          isExpiringSoon: daysUntilExpiry >= 0 && daysUntilExpiry <= notifyDays
        };
      });
  });

  const expiredProducts = expiringItems.filter(item => item.isExpired);
  const expiringSoonProducts = expiringItems.filter(item => item.isExpiringSoon);

  const daysRemaining = license ? Math.max(0, Math.ceil((new Date(license.expiryDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : 0;

  const chartData = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dayStart = startOfDay(d).getTime();
    const dayEnd = dayStart + 86400000;
    const daySales = mySales.filter(s => {
      const saleTime = new Date(s.created_at).getTime();
      return isActiveSale(s) && saleTime >= dayStart && saleTime < dayEnd;
    });
    return {
      name: d.toLocaleDateString(useStore.getState().language === 'sw' ? 'sw-TZ' : 'en-US', { weekday: 'short' }),
      [t('revenue')]: calcTotal(daySales),
    };
  });

  const totalDebt = sales
    .filter(s => !s.is_deleted && s.payment_method === 'credit' && s.status !== 'cancelled' && s.status !== 'refunded')
    .reduce((sum, s) => {
      const payments = debtPayments.filter(p => p.sale_id === s.id);
      const amountPaid = payments.reduce((pSum, p) => pSum + p.amount, 0);
      const remaining = s.total_amount - amountPaid;
      return sum + (remaining > 0 ? remaining : 0);
    }, 0);

  if (salesLoading || productsLoading || expensesLoading || paymentsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8">
      {/* Mobile Header */}
      <header className="md:hidden flex justify-between items-center mb-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 truncate max-w-[200px]">
            {shop?.name || shopSettings?.shopName || t('dashboard')}
          </h1>
          <p className="text-xs text-slate-500">{t('welcomeBack')}, {user?.name}</p>
        </div>
        <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">
          {user?.name?.charAt(0) || 'U'}
        </div>
      </header>

      {/* Desktop Header */}
      <header className="hidden md:flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{shop?.name || shopSettings?.shopName || t('dashboard')}</h1>
          <div className="flex items-center space-x-2 mt-1">
            <p className="text-slate-500">{t('welcomeBack')}, {user?.name}</p>
            <span className="text-slate-300">•</span>
            <p className="text-slate-500 font-medium">{new Date().toLocaleDateString(useStore.getState().language === 'sw' ? 'sw-TZ' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          {license && (
            <div className={`flex items-center px-4 py-2 rounded-xl text-sm font-semibold ${daysRemaining > 5 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
              {daysRemaining > 5 ? <ShieldCheck className="w-4 h-4 mr-2" /> : <AlertTriangle className="w-4 h-4 mr-2" />}
              {`${t('daysRemaining').charAt(0).toUpperCase() + t('daysRemaining').slice(1)}: ${daysRemaining}`}
            </div>
          )}
          {canManageProducts && (
            <button 
              onClick={() => navigate('/bidhaa')}
              className="bg-amber-500 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-amber-600 transition-colors shadow-lg shadow-amber-500/20"
            >
              {t('addStock')}
            </button>
          )}
          <button 
            onClick={() => navigate('/kikapu')}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
          >
            {t('sellNow')}
          </button>
        </div>
      </header>

      {/* Mobile License Status */}
      <div className="md:hidden space-y-3">
        <div className="flex justify-between items-center">
          <p className="text-slate-500 text-sm font-medium">{new Date().toLocaleDateString(useStore.getState().language === 'sw' ? 'sw-TZ' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          {lowStockProducts.length > 0 && (
            <div 
              onClick={() => setShowLowStockModal(true)}
              className="flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-100 text-rose-700 border border-rose-200 cursor-pointer"
            >
              <AlertTriangle className="w-3 h-3 mr-1.5" />
              {t('lowStock')} ({lowStockProducts.length})
            </div>
          )}
        </div>
        {license && (
          <div className={`flex items-center px-4 py-3 rounded-xl text-sm font-semibold ${daysRemaining > 5 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
            {daysRemaining > 5 ? <ShieldCheck className="w-4 h-4 mr-2" /> : <AlertTriangle className="w-4 h-4 mr-2" />}
            {`${t('daysRemaining').charAt(0).toUpperCase() + t('daysRemaining').slice(1)}: ${daysRemaining}`}
          </div>
        )}
      </div>

      {/* Alerts Grid */}
      {( (shop?.enable_expiry && (expiredProducts.length > 0 || expiringSoonProducts.length > 0)) || lowStockProducts.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          {/* Expired Card */}
          {shop?.enable_expiry && expiredProducts.length > 0 && (
            <div className="bg-white p-5 rounded-2xl border border-rose-200 shadow-sm cursor-pointer hover:shadow-md transition-all flex flex-col justify-between" onClick={() => navigate('/expiry')}>
              <div className="flex items-center space-x-3 text-rose-600 mb-3">
                <AlertTriangle className="w-6 h-6" />
                <div>
                  <h2 className="text-lg font-bold leading-tight">{t('expired')}</h2>
                  <p className="text-sm text-slate-500 font-medium">{expiredProducts.length} {t('products').toLowerCase()}</p>
                </div>
              </div>
              <p className="text-blue-600 text-sm font-semibold hover:underline flex items-center">
                {t('clickToSeeMore')} <ChevronRight className="w-4 h-4 ml-1" />
              </p>
            </div>
          )}

          {/* Expiring Soon Card */}
          {shop?.enable_expiry && expiringSoonProducts.length > 0 && (
            <div className="bg-white p-5 rounded-2xl border border-amber-200 shadow-sm cursor-pointer hover:shadow-md transition-all flex flex-col justify-between" onClick={() => navigate('/expiry')}>
              <div className="flex items-center space-x-3 text-amber-600 mb-3">
                <Calendar className="w-6 h-6" />
                <div>
                  <h2 className="text-lg font-bold leading-tight">{t('expiringSoon')}</h2>
                  <p className="text-sm text-slate-500 font-medium">{expiringSoonProducts.length} {t('products').toLowerCase()}</p>
                </div>
              </div>
              <p className="text-blue-600 text-sm font-semibold hover:underline flex items-center">
                {t('clickToSeeMore')} <ChevronRight className="w-4 h-4 ml-1" />
              </p>
            </div>
          )}

          {/* Low Stock Card */}
          {lowStockProducts.length > 0 && (
            <div className="bg-white p-5 rounded-2xl border border-rose-100 shadow-sm cursor-pointer hover:shadow-md transition-all flex flex-col justify-between" onClick={() => setShowLowStockModal(true)}>
              <div className="flex items-center space-x-3 text-rose-600 mb-3">
                <Package className="w-6 h-6" />
                <div>
                  <h2 className="text-lg font-bold leading-tight">{t('stockAlert')}</h2>
                  <p className="text-sm text-slate-500 font-medium">{lowStockProducts.length} {t('products').toLowerCase()}</p>
                </div>
              </div>
              <p className="text-blue-600 text-sm font-semibold hover:underline flex items-center">
                {t('clickToSeeMore')} <ChevronRight className="w-4 h-4 ml-1" />
              </p>
            </div>
          )}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mb-4">
            <DollarSign className="w-6 h-6 text-blue-600" />
          </div>
          <p className="text-sm font-medium text-slate-500">{t('revenue')} ({t('today')})</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(calcTotal(todaySales), currency)}</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center mb-4">
            <ShoppingBag className="w-6 h-6 text-emerald-600" />
          </div>
          <p className="text-sm font-medium text-slate-500">{t('salesCount')}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{t('sales')} {todaySales.length}</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="w-12 h-12 bg-rose-50 rounded-xl flex items-center justify-center mb-4">
            <CreditCard className="w-6 h-6 text-rose-600" />
          </div>
          <p className="text-sm font-medium text-slate-500">{t('debtStatus')}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalDebt, currency)}</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center mb-4">
            <Package className="w-6 h-6 text-amber-600" />
          </div>
          <p className="text-sm font-medium text-slate-500">{t('currentStock')}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalStock} {t('items')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        {/* Chart Section */}
        <div className="lg:col-span-2 bg-white p-4 md:p-8 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-center mb-6 md:mb-8">
            <h2 className="text-lg md:text-xl font-bold text-slate-900">{t('revenueTrend')}</h2>
            <select className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500">
              <option>{t('last7Days')}</option>
              <option>{t('thisMonth')}</option>
            </select>
          </div>
          <div className="h-64 md:h-80 relative min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  fontSize={12} 
                  tickLine={false} 
                  axisLine={false} 
                  tick={{fill: '#64748b'}}
                  dy={10}
                />
                <YAxis 
                  fontSize={12} 
                  tickLine={false} 
                  axisLine={false} 
                  tick={{fill: '#64748b'}}
                  tickFormatter={(value) => `${value / 1000}k`}
                />
                <Tooltip 
                  formatter={(value: number) => formatCurrency(value, currency)}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  cursor={{fill: '#f8fafc'}}
                />
                <Bar dataKey={t('revenue')} fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Side Info Section */}
        <div className="space-y-6 md:space-y-8">
          <div className="bg-slate-900 text-white p-6 md:p-8 rounded-2xl md:rounded-3xl shadow-xl relative overflow-hidden">
            <div className="relative z-10">
              <h2 className="text-base md:text-lg font-semibold opacity-80">{t('monthlyRevenue')}</h2>
              <p className="text-2xl md:text-3xl font-bold mt-2">{formatCurrency(calcTotal(monthSales), currency)}</p>
              <div className={`mt-6 flex items-center text-sm font-medium ${percentChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {percentChange >= 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                <span>{percentChange >= 0 ? '+' : ''}{percentChange.toFixed(1)}% {t('sinceLastMonth')}</span>
              </div>
              <button 
                onClick={() => navigate('/historia')}
                className="mt-8 w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl font-medium transition-colors flex items-center justify-center"
              >
                {t('viewReport')} <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
            <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-blue-600/20 rounded-full blur-3xl"></div>
          </div>
        </div>
      </div>

      <LowStockModal 
        isOpen={showLowStockModal} 
        onClose={() => setShowLowStockModal(false)} 
        lowStockProducts={lowStockProducts} 
        shopSettings={mergedSettings} 
      />
    </div>
  );
}

