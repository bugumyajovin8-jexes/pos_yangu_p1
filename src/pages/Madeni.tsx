import { useState, useEffect } from 'react';
import { formatCurrency, formatNumberWithCommas, parseFormattedNumber } from '../utils/format';
import { format } from 'date-fns';
import { CheckCircle, Phone, User, RefreshCw, AlertCircle, Search, Wallet, X, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { useSupabaseData } from '../hooks/useSupabaseData';
import { db, recordAuditLog } from '../db';
import { SyncService } from '../services/sync';
import { v4 as uuidv4 } from 'uuid';

export default function Madeni() {
  const user = useStore(state => state.user);
  const showAlert = useStore(state => state.showAlert);
  const showConfirm = useStore(state => state.showConfirm);
  const [shopSettings, setShopSettings] = useState<any>(null);
  const { data: sales, loading: salesLoading } = useSupabaseData<any>('sales');
  const { data: saleItems, loading: itemsLoading } = useSupabaseData<any>('sale_items');
  const { data: debtPayments, loading: paymentsLoading } = useSupabaseData<any>('debtPayments');
  const [search, setSearch] = useState('');
  
  const [paymentModal, setPaymentModal] = useState<{
    show: boolean;
    sale: any | null;
    amount: string;
  }>({
    show: false,
    sale: null,
    amount: ''
  });

  useEffect(() => {
    if (user?.shop_id) {
      db.settings.get(1).then(data => setShopSettings(data));
    }
  }, [user?.shop_id]);

  const currency = shopSettings?.currency || 'TZS';
  
  const unpaidDebts = sales
    .filter(s => !s.is_deleted && s.payment_method === 'credit' && s.status !== 'cancelled')
    .map(sale => {
      const payments = debtPayments.filter(p => p.sale_id === sale.id);
      const amountPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const remainingBalance = sale.total_amount - amountPaid;
      return { ...sale, amountPaid, remainingBalance };
    })
    .filter(s => s.remainingBalance > 0)
    .filter(s => s.customer_name?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  
  const totalDebt = unpaidDebts.reduce((sum, s) => sum + s.remainingBalance, 0);

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModal.sale || !user?.shop_id) return;

    const amount = parseFormattedNumber(paymentModal.amount);
    if (isNaN(amount) || amount <= 0) {
      showAlert('Kosa', 'Tafadhali weka kiasi sahihi.');
      return;
    }

    if (amount > paymentModal.sale.remainingBalance) {
      showAlert('Kosa', 'Kiasi hakiwezi kuzidi deni linalodaiwa.');
      return;
    }

    try {
      const now = new Date().toISOString();
      const paymentId = uuidv4();
      
      // 1. Record the payment
      await db.debtPayments.add({
        id: paymentId,
        shop_id: user.shop_id,
        sale_id: paymentModal.sale.id,
        amount: amount,
        date: now,
        created_at: now,
        updated_at: now,
        isDeleted: 0,
        synced: 0
      });

      // 2. Check if fully paid
      const newRemaining = paymentModal.sale.remainingBalance - amount;
      
      // Record Audit Log
      await recordAuditLog('debt_payment', {
        payment_id: paymentId,
        sale_id: paymentModal.sale.id,
        customer_name: paymentModal.sale.customer_name,
        amount: amount,
        remaining_balance: newRemaining
      });

      if (newRemaining <= 0) {
        await db.sales.update(paymentModal.sale.id, { 
          status: 'completed', 
          is_paid: true,
          updated_at: now, 
          synced: 0 
        });
      }

      setPaymentModal({ show: false, sale: null, amount: '' });
      await SyncService.sync(true);
    } catch (error: any) {
      showAlert('Kosa', 'Imeshindwa kufanya malipo: ' + error.message);
    }
  };

  const handleDeleteDebt = async (debt: any) => {
    showAlert('Kosa', 'Huna ruhusa ya kufuta deni hili.');
  };

  if (salesLoading || itemsLoading || paymentsLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Madeni</h1>
          <p className="text-slate-500 mt-1 text-sm md:text-base">Simamia wateja wanaodaiwa na makusanyo</p>
        </div>
        <div className="w-full md:w-auto bg-rose-50 border border-rose-100 px-4 md:px-6 py-3 rounded-xl md:rounded-2xl flex items-center space-x-4">
          <div className="w-8 h-8 md:w-10 md:h-10 bg-rose-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-5 h-5 md:w-6 md:h-6 text-rose-600" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-rose-800 uppercase">Jumla ya Madeni Yaliyobaki</p>
            <p className="text-lg md:text-xl font-bold text-rose-600">{formatCurrency(totalDebt, currency)}</p>
          </div>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
        <input 
          type="text" 
          placeholder="Tafuta mteja..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-12 pr-4 py-3 md:py-4 bg-white border border-slate-200 rounded-xl md:rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition-all"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        {unpaidDebts.length === 0 ? (
          <div className="col-span-full text-center py-20 bg-white rounded-3xl border border-slate-200">
            <User className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">Hakuna madeni yoyote kwa sasa.</p>
          </div>
        ) : (
          unpaidDebts.map(debt => (
            <div key={debt.id} className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="p-4 md:p-6 border-b border-slate-100">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-100 rounded-xl md:rounded-2xl flex items-center justify-center">
                      <User className="w-5 h-5 md:w-6 md:h-6 text-slate-500" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="font-bold text-slate-900 text-sm md:text-base">{debt.customer_name}</h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${debt.amountPaid > 0 ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-rose-100 text-rose-700 border border-rose-200'}`}>
                          {debt.amountPaid > 0 ? 'Deni la Sehemu' : 'Deni'}
                        </span>
                      </div>
                      <p className="text-[10px] md:text-xs text-slate-500 flex items-center mt-0.5">
                        <Phone className="w-3 h-3 mr-1" /> {debt.customer_phone || 'Namba haipo'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <p className="text-[10px] text-slate-400 font-bold uppercase mb-2">{format(new Date(debt.created_at), 'MMM dd, yyyy')}</p>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl md:rounded-2xl p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-500 uppercase">Jumla ya Deni:</span>
                    <span className="text-sm font-bold text-slate-900">{formatCurrency(debt.total_amount, currency)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-emerald-600 uppercase">Kiasi Kilicholipwa:</span>
                    <span className="text-sm font-bold text-emerald-600">{formatCurrency(debt.amountPaid, currency)}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                    <span className="text-xs font-bold text-rose-600 uppercase">Kiasi Kilichobaki:</span>
                    <span className="text-lg font-bold text-rose-600">{formatCurrency(debt.remainingBalance, currency)}</span>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Bidhaa Alizochukua:</p>
                  <div className="space-y-1">
                    {saleItems.filter(i => i.sale_id === debt.id).map((item, idx) => (
                      <div key={idx} className="flex justify-between text-[10px] md:text-xs">
                        <span className="text-slate-600 font-medium">{item.product_name} x{item.qty}</span>
                        <span className="text-slate-900 font-bold">{formatCurrency(item.sell_price * item.qty, currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 md:p-6 bg-slate-50/50 flex items-center justify-between mt-auto">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Kikomo cha Malipo</span>
                  <span className="text-xs md:text-sm font-bold text-slate-700">
                    {debt.due_date ? format(new Date(debt.due_date), 'dd/MM/yyyy') : 'Hakuna'}
                  </span>
                </div>
                <button 
                  onClick={() => setPaymentModal({ show: true, sale: debt, amount: '' })}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-bold flex items-center hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  Lipa Deni
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Payment Modal */}
      {paymentModal.show && paymentModal.sale && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-900">Lipa Deni</h2>
              <button 
                onClick={() => setPaymentModal({ show: false, sale: null, amount: '' })}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>
            
            <div className="bg-slate-50 p-4 rounded-2xl mb-6">
              <p className="text-sm text-slate-500 mb-1">Mteja: <span className="font-bold text-slate-900">{paymentModal.sale.customer_name}</span></p>
              <p className="text-sm text-slate-500">Kiasi Kinachodaiwa: <span className="font-bold text-rose-600">{formatCurrency(paymentModal.sale.remainingBalance, currency)}</span></p>
            </div>

            <form onSubmit={handlePaymentSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Kiasi Anacholipa Sasa</label>
                <input 
                  autoFocus
                  required
                  type="text"
                  placeholder="Mfano: 50,000"
                  value={paymentModal.amount}
                  onChange={e => setPaymentModal(prev => ({ ...prev, amount: formatNumberWithCommas(e.target.value) }))}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-xl font-bold"
                />
              </div>
              
              <div className="flex space-x-4">
                <button 
                  type="button"
                  onClick={() => setPaymentModal({ show: false, sale: null, amount: '' })}
                  className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-colors"
                >
                  Ghairi
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors flex items-center justify-center"
                >
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Thibitisha Malipo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

