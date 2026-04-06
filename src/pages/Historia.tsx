import { useState, useMemo, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { formatCurrency } from '../utils/format';
import { format, startOfDay, startOfWeek, startOfMonth, subMonths, startOfYear, subDays, eachDayOfInterval } from 'date-fns';
import { Receipt, Calendar, Download, TrendingUp, BarChart3, RefreshCw, ChevronRight, ShoppingBag, Trophy, Trash2, RotateCcw, LineChart as LineChartIcon } from 'lucide-react';
import { useStore } from '../store';
import { TranslationKey } from '../translations';
import { useSupabaseData, useSupabaseTotals } from '../hooks/useSupabaseData';
import { db, recordAuditLog } from '../db';
import { SyncService } from '../services/sync';
import { useFeatureToggles } from '../hooks/useFeatureToggles';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';

export default function Historia() {
  const user = useStore(state => state.user);
  const t = useStore(state => state.t);
  const showAlert = useStore(state => state.showAlert);
  const showConfirm = useStore(state => state.showConfirm);
  const { isFeatureEnabled, isBoss } = useFeatureToggles();
  const canRefund = isFeatureEnabled('staff_refund_management') || isBoss();
  const [shopSettings, setShopSettings] = useState<any>(null);
  const [view, setView] = useState<'risiti' | 'ripoti'>('risiti');
  const [filter, setFilter] = useState('leo');
  const [reportType, setReportType] = useState<'mwezi' | 'mwaka'>('mwezi');

  const daysToLoad = useMemo(() => {
    switch(filter) {
      case 'leo': return 2;
      case 'wiki': return 8;
      case 'mwezi': return 32;
      case 'miezi6': return 185;
      case 'mwaka': return 367;
      case 'yote': return 3650; // 10 years
      default: return 30;
    }
  }, [filter]);

  const { data: sales, loading: salesLoading } = useSupabaseData<any>('sales', { days: daysToLoad, allTime: filter === 'yote' });
  const { data: saleItems, loading: itemsLoading } = useSupabaseData<any>('sale_items', { days: daysToLoad, allTime: filter === 'yote' });
  const { data: expenses, loading: expensesLoading } = useSupabaseData<any>('expenses', { days: daysToLoad, allTime: filter === 'yote' });

  // All-time totals for safe display when "yote" is selected
  const { total: allTimeRevenue } = useSupabaseTotals('sales', 'total_amount', user?.id);
  const { total: allTimeExpenses } = useSupabaseTotals('expenses', 'amount', user?.id);

  const handleReverseSale = async (sale: any) => {
    if (!canRefund) {
      showAlert(t('noPermission'), t('noPermissionRefund'));
      return;
    }

    showConfirm(t('refundSale'), t('refundConfirm'), async () => {
      try {
        // 1. Get sale items
        const items = saleItems.filter(i => i.sale_id === sale.id);
        
        // 2. Update stock for each item
        for (const item of items) {
          const product = await db.products.get(item.product_id);
          if (product) {
            await db.products.update(product.id, {
              stock: product.stock + item.qty,
              synced: 0,
              updated_at: new Date().toISOString()
            });
          }
        }

        // 3. Mark sale as refunded
        await db.sales.update(sale.id, {
          status: 'refunded',
          synced: 0,
          updated_at: new Date().toISOString()
        });

        // Record Audit Log
        await recordAuditLog('refund_sale', {
          sale_id: sale.id,
          total_amount: sale.total_amount,
          items_count: items.length
        });

        // 4. Trigger sync
        SyncService.sync(true).catch(console.error);
        
        showAlert(t('success'), t('refundSuccess'));
      } catch (error: any) {
        showAlert(t('error'), t('refundFailed') + ': ' + error.message);
      }
    });
  };

  const handleDeleteSale = async (sale: any) => {
    showAlert(t('noPermission'), t('noPermissionRefund'));
  };

  useEffect(() => {
    if (user?.shop_id) {
      db.settings.get(1).then(data => setShopSettings(data));
    }
  }, [user?.shop_id]);

  const currency = shopSettings?.currency || 'TZS';

  const now = new Date();
  const getStartDate = () => {
    switch(filter) {
      case 'leo': return startOfDay(now).getTime();
      case 'wiki': return startOfWeek(now).getTime();
      case 'mwezi': return startOfMonth(now).getTime();
      case 'miezi6': return subMonths(now, 6).getTime();
      case 'mwaka': return startOfYear(now).getTime();
      default: return 0;
    }
  };

  const startDate = getStartDate();
  const mySales = sales.filter(s => s.user_id === user?.id);
  const filteredSales = mySales
    .filter(s => !s.is_deleted && new Date(s.created_at).getTime() >= startDate && s.status !== 'cancelled')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const myExpenses = expenses.filter(e => e.user_id === user?.id);
  const filteredExpenses = myExpenses
    .filter(e => !e.is_deleted && new Date(e.created_at).getTime() >= startDate);

  const totalRevenue = filter === 'yote' ? allTimeRevenue : filteredSales.filter(s => s.status !== 'refunded').reduce((sum, s) => sum + s.total_amount, 0);
  const totalExpenses = filter === 'yote' ? allTimeExpenses : filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  const showNetProfit = ['mwezi', 'miezi6', 'mwaka'].includes(filter);

  // Top 10 Best Selling Products
  const [topProductsFilter, setTopProductsFilter] = useState<'qty' | 'profit'>('qty');
  
  const topProducts = useMemo(() => {
    const productSales: Record<string, { name: string, qty: number, revenue: number, profit: number }> = {};
    
    // Filter sale items for the selected period
    const relevantSalesIds = new Set(filteredSales.filter(s => s.status !== 'refunded').map(s => s.id));
    
    saleItems.forEach(item => {
      if (relevantSalesIds.has(item.sale_id)) {
        if (!productSales[item.product_id]) {
          productSales[item.product_id] = { name: item.product_name, qty: 0, revenue: 0, profit: 0 };
        }
        productSales[item.product_id].qty += item.qty;
        productSales[item.product_id].revenue += (item.qty * item.sell_price);
        productSales[item.product_id].profit += (item.profit || 0);
      }
    });

    return Object.values(productSales)
      .sort((a, b) => b[topProductsFilter] - a[topProductsFilter])
      .slice(0, 10);
  }, [saleItems, filteredSales, topProductsFilter]);

  // Performance Chart Data (Last 30 days)
  const performanceData = useMemo(() => {
    const last30Days = eachDayOfInterval({
      start: subDays(now, 29),
      end: now
    });

    return last30Days.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const daySales = mySales.filter(s => !s.is_deleted && s.status !== 'cancelled' && s.status !== 'refunded' && format(new Date(s.created_at), 'yyyy-MM-dd') === dateStr);
      
      const revenue = daySales.reduce((sum, s) => sum + s.total_amount, 0);
      
      return {
        name: format(day, 'dd/MM'),
        [t('revenue')]: revenue,
      };
    });
  }, [mySales, expenses, t]);

  const exportCSV = () => {
    const headers = [t('date'), t('amount'), t('type'), t('customerName')];
    const rows = filteredSales.map(s => [
      `"${format(new Date(s.created_at), 'yyyy-MM-dd HH:mm')}"`,
      `"${s.total_amount}"`,
      `"${s.payment_method === 'credit' ? t('credit') : t('cash')}"`,
      `"${s.customer_name || t('cash')}"`
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `mauzo_${filter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const reportData = useMemo(() => {
    const groups: Record<string, { mapato: number, mauzo: number }> = {};
    
    sales.filter(s => !s.is_deleted && s.status !== 'cancelled' && s.status !== 'refunded').forEach(sale => {
      const date = new Date(sale.created_at);
      const dateStr = reportType === 'mwezi' 
        ? format(date, 'MMM yyyy') 
        : format(date, 'yyyy');
        
      if (!groups[dateStr]) {
        groups[dateStr] = { mapato: 0, mauzo: 0 };
      }
      groups[dateStr].mapato += sale.total_amount;
      groups[dateStr].mauzo += 1;
    });

    return Object.entries(groups).map(([label, data]) => ({
      label,
      ...data,
    })).sort((a, b) => b.label.localeCompare(a.label));
  }, [sales, reportType]);

  if (salesLoading || itemsLoading || expensesLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#6366f1', '#f43f5e'];

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t('historyAndReports')}</h1>
          <p className="text-slate-500 mt-1 text-sm md:text-base">{t('viewSalesAndProfit')}</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-xl md:rounded-2xl w-full md:w-auto">
          <button 
            onClick={() => setView('risiti')}
            className={`flex-1 md:flex-none px-4 md:px-6 py-2 md:py-2.5 rounded-lg md:rounded-xl text-xs md:text-sm font-bold flex items-center justify-center transition-all ${view === 'risiti' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Receipt className="w-4 h-4 mr-2" /> {t('receipts')}
          </button>
          <button 
            onClick={() => setView('ripoti')}
            className={`flex-1 md:flex-none px-4 md:px-6 py-2 md:py-2.5 rounded-lg md:rounded-xl text-xs md:text-sm font-bold flex items-center justify-center transition-all ${view === 'ripoti' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <BarChart3 className="w-4 h-4 mr-2" /> {t('reports')}
          </button>
        </div>
      </header>

      {view === 'risiti' ? (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex space-x-2 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
              {['leo', 'wiki', 'mwezi', 'miezi6', 'mwaka', 'yote'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`whitespace-nowrap px-4 md:px-5 py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-all ${
                    filter === f ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {t(f as TranslationKey)}
                </button>
              ))}
            </div>
            <button 
              onClick={exportCSV} 
              className="w-full md:w-auto bg-white border border-slate-200 text-slate-700 px-5 py-2 rounded-xl text-sm font-bold flex items-center justify-center hover:bg-slate-50 transition-all"
            >
              <Download className="w-4 h-4 mr-2" /> {t('downloadCSV')}
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
            <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{t('revenue')}</p>
              <p className="text-lg md:text-2xl font-bold text-slate-900">{formatCurrency(totalRevenue, currency)}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Desktop Table */}
            <div className="hidden md:block">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">{t('date')}</th>
                    <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">{t('product')}</th>
                    <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">{t('type')}</th>
                    <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider text-right">{t('amount')}</th>
                    <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider text-right">{t('action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.map(sale => (
                    <tr key={sale.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-5">
                        <div className="flex items-center text-slate-600 text-sm font-medium">
                          <Calendar className="w-4 h-4 mr-2 opacity-50" />
                          {format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm')}
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="text-sm font-bold text-slate-900 max-w-xs truncate">
                          {saleItems.filter(i => i.sale_id === sale.id).map(i => i.product_name).join(', ')}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {saleItems.filter(i => i.sale_id === sale.id).reduce((a, b) => a + b.qty, 0)} {t('items')}
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${sale.payment_method === 'credit' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {sale.payment_method === 'credit' ? t('credit') : t('cash')}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <div className="font-bold text-slate-900">{formatCurrency(sale.total_amount, currency)}</div>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <button 
                          onClick={() => handleReverseSale(sale)}
                          className="text-amber-600 hover:text-amber-700 p-2 rounded-lg hover:bg-amber-50 transition-colors inline-flex items-center"
                          title={t('refundSale')}
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredSales.map(sale => (
                <div key={sale.id} className="p-4 flex flex-col space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center text-slate-500 text-[10px] font-bold uppercase">
                      <Calendar className="w-3 h-3 mr-1 opacity-50" />
                      {format(new Date(sale.created_at), 'dd/MM/yyyy HH:mm')}
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${sale.payment_method === 'credit' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {sale.payment_method === 'credit' ? t('credit') : t('cash')}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-slate-900 line-clamp-2">
                    {saleItems.filter(i => i.sale_id === sale.id).map(i => i.product_name).join(', ')}
                  </div>
                  <div className="flex justify-between items-end pt-2 border-t border-slate-50">
                    <div className="text-[10px] text-slate-400 font-bold uppercase">
                      {saleItems.filter(i => i.sale_id === sale.id).reduce((a, b) => a + b.qty, 0)} {t('items')}
                    </div>
                    <div className="flex items-center space-x-3">
                      <button 
                        onClick={() => handleReverseSale(sale)}
                        className="text-amber-600 hover:text-amber-700 p-1.5 rounded-lg hover:bg-amber-50 transition-colors"
                        title={t('refundSale')}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <div className="text-right">
                        <div className="font-bold text-slate-900 text-sm">{formatCurrency(sale.total_amount, currency)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {filteredSales.length === 0 && (
              <div className="text-center py-20">
                <ShoppingBag className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                <p className="text-slate-500 font-medium">{t('noSalesPeriod')}</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Charts & Insights Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
            {/* Business Growth Chart */}
            <div className="bg-white p-6 md:p-8 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center mr-3">
                    <LineChartIcon className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-base md:text-lg">{t('businessGrowth')}</h3>
                </div>
              </div>
              <div className="h-[300px] w-full relative min-h-[300px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <LineChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      interval={4}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      tickFormatter={(value) => value >= 1000 ? `${(value/1000).toFixed(0)}k` : value}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [formatCurrency(value, currency), '']}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 'bold', paddingTop: '20px' }} />
                    <Line 
                      type="monotone" 
                      dataKey={t('revenue')} 
                      stroke="#3b82f6" 
                      strokeWidth={3} 
                      dot={false} 
                      activeDot={{ r: 6, strokeWidth: 0 }} 
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top 10 Best Selling Products */}
            <div className="bg-white p-6 md:p-8 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center mr-3">
                    <Trophy className="w-5 h-5 text-amber-600" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-base md:text-lg">{t('topProducts')}</h3>
                </div>
              </div>
              <div className="h-[300px] w-full relative min-h-[300px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart data={topProducts} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" hide />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#475569', fontWeight: 'bold' }}
                      width={80}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [
                        `${value} ${t('items')}`, 
                        ''
                      ]}
                    />
                    <Bar dataKey="qty" radius={[0, 4, 4, 0]}>
                      {topProducts.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4">
            <button
              onClick={() => setReportType('mwezi')}
              className={`flex-1 md:flex-none px-6 py-3 rounded-xl md:rounded-2xl text-sm font-bold transition-all ${reportType === 'mwezi' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-white border border-slate-200 text-slate-600'}`}
            >
              {t('monthlyReport')}
            </button>
            <button
              onClick={() => setReportType('mwaka')}
              className={`flex-1 md:flex-none px-6 py-3 rounded-xl md:rounded-2xl text-sm font-bold transition-all ${reportType === 'mwaka' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-white border border-slate-200 text-slate-600'}`}
            >
              {t('yearlyReport')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 md:gap-8">
            {reportData.map((report, idx) => (
              <div key={idx} className="bg-white p-6 md:p-8 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all">
                <div className="flex justify-between items-center mb-6 md:mb-8 pb-4 border-b border-slate-100">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center mr-3">
                      <Calendar className="w-5 h-5 text-blue-600" />
                    </div>
                    <h3 className="font-bold text-slate-900 text-base md:text-lg">{report.label}</h3>
                  </div>
                  <span className="text-[10px] md:text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full uppercase">
                    {report.mauzo} {t('sales')}
                  </span>
                </div>
                
                <div className="space-y-4 md:space-y-6">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('totalRevenue')}</p>
                    <p className="text-xl md:text-2xl font-bold text-slate-900">{formatCurrency(report.mapato, currency)}</p>
                  </div>
                </div>
                
                <button className="mt-8 w-full flex items-center justify-center text-blue-600 font-bold text-sm hover:underline">
                  {t('viewDetails')} <ChevronRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            ))}
            {reportData.length === 0 && (
              <div className="col-span-full text-center py-20 bg-white rounded-3xl border border-slate-200">
                <BarChart3 className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                <p className="text-slate-500 font-medium">{t('noReportData')}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

