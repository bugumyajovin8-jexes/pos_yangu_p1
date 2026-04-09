import { useState, useMemo, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '../store';
import { formatCurrency } from '../utils/format';
import { getValidStock } from '../utils/stock';
import { Plus, Minus, Trash2, Search, ShoppingBag, CreditCard, User, Calendar, RefreshCw, CheckCircle2, ArrowLeft } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { db, recordAuditLog } from '../db';
import { SyncService } from '../services/sync';
import { useSupabaseData } from '../hooks/useSupabaseData';
import { differenceInDays, parseISO } from 'date-fns';

export default function Kikapu() {
  const user = useStore(state => state.user);
  const t = useStore(state => state.t);
  const [shopSettings, setShopSettings] = useState<any>(null);
  const { data: allSales } = useSupabaseData<any>('sales');
  
  const { cart, addToCart, removeFromCart, updateQty, clearCart, cartTotal, cartProfit, showAlert } = useStore();
  
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isCheckout, setIsCheckout] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [isCredit, setIsCredit] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCartMobile, setShowCartMobile] = useState(false);
  const processingRef = useRef(false);

  useEffect(() => {
    if (user?.shop_id) {
      // Fetch both local settings (for currency) and shop data (for expiry feature)
      Promise.all([
        db.settings.get(1),
        db.shops.get(user.shop_id)
      ]).then(([settingsData, shopData]) => {
        setShopSettings({
          ...settingsData,
          ...shopData
        });
      });
    }
  }, [user?.shop_id]);

  const currency = shopSettings?.currency || 'TZS';

  const uniqueCustomers = useMemo(() => {
    const customers = new Map<string, string>();
    allSales.forEach((s: any) => {
      if (s.customer_name) {
        customers.set(s.customer_name.toLowerCase(), s.customer_name);
      }
    });
    return Array.from(customers.values());
  }, [allSales]);

  const filteredCustomers = uniqueCustomers.filter(c => 
    c.toLowerCase().includes(customerName.toLowerCase())
  );

  // Optimized product fetching for large datasets
  const filteredProducts = useLiveQuery(
    async () => {
      if (!user?.shop_id) return [];
      
      let query = db.products.where('shop_id').equals(user.shop_id);
      
      // Filter out deleted and out of stock
      const activeProducts = await query.filter(p => !p.is_deleted && p.stock > 0).toArray();
      
      // Filter by search
      let filtered = activeProducts;
      if (debouncedSearch.trim()) {
        const s = debouncedSearch.toLowerCase();
        filtered = activeProducts.filter(p => p.name.toLowerCase().includes(s));
      }

      // Sort: Starts with search term first, then alphabetical
      return filtered
        .sort((a, b) => {
          const aName = a.name.toLowerCase();
          const bName = b.name.toLowerCase();
          const s = debouncedSearch.toLowerCase();
          
          const aStarts = aName.startsWith(s);
          const bStarts = bName.startsWith(s);
          
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          
          return aName.localeCompare(bName);
        })
        .slice(0, 100);
    },
    [user?.shop_id, debouncedSearch]
  ) || [];

  const handleSelectCustomer = (name: string) => {
    setCustomerName(name);
    setShowSuggestions(false);
    const previousSale = allSales.find(s => s.customer_name === name && s.customer_phone);
    if (previousSale?.customer_phone) {
      setCustomerPhone(previousSale.customer_phone);
    }
  };

  const handleCompleteSale = async (method: 'cash' | 'credit') => {
    if (cart.length === 0 || !user || isProcessing || processingRef.current) return;
    
    if (method === 'credit' && !customerName) {
      setIsCredit(true);
      setIsCheckout(true);
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);
    const saleId = uuidv4();

    try {
      // Use a transaction for the entire checkout process to prevent race conditions
      await db.transaction('rw', [db.products, db.sales, db.saleItems, db.auditLogs], async () => {
        // Final stock check from local DB
        for (const item of cart) {
          const dbProduct = await db.products.get(item.id);
          const currentStock = dbProduct ? dbProduct.stock : 0;
          if (!dbProduct || currentStock < item.qty) {
            throw new Error(t('insufficientStock').replace('{name}', item.name).replace('{stock}', currentStock.toString()));
          }
        }

        const sale = {
          id: saleId,
          shop_id: user.shop_id || user.shopId || '',
          user_id: user.id,
          total_amount: cartTotal(),
          total_profit: cartProfit(),
          payment_method: method,
          status: method === 'credit' ? 'pending' : 'completed',
          customer_name: method === 'credit' ? customerName : undefined,
          customer_phone: method === 'credit' ? customerPhone : undefined,
          due_date: method === 'credit' && dueDate ? new Date(dueDate).toISOString() : undefined,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          synced: 0
        };

        const saleItems = cart.map(item => ({
          id: uuidv4(),
          sale_id: saleId,
          shop_id: user.shop_id || user.shopId || '',
          product_id: item.id,
          product_name: item.name,
          qty: item.qty,
          buy_price: item.buy_price,
          sell_price: item.sell_price,
          profit: (item.sell_price - item.buy_price) * item.qty,
          created_at: new Date().toISOString(),
          isDeleted: 0,
          synced: 0
        }));

        // 1. Insert Sale
        await db.sales.add(sale as any);

        // 2. Insert Sale Items
        await db.saleItems.bulkAdd(saleItems);

        // Record Audit Log
        await recordAuditLog('complete_sale', {
          sale_id: saleId,
          total_amount: sale.total_amount,
          payment_method: method,
          items_count: cart.length,
          customer_name: customerName || undefined
        });

        // 3. Update Stocks locally (FEFO - First Expired, First Out)
        for (const item of cart) {
          const dbProduct = await db.products.get(item.id);
          if (dbProduct) {
            let remainingQtyToDeduct = item.qty;
            let updatedBatches = dbProduct.batches ? [...dbProduct.batches] : [];

            // If no batches but has stock, initialize with current stock
            if (updatedBatches.length === 0 && dbProduct.stock > 0) {
              updatedBatches.push({ id: uuidv4(), stock: dbProduct.stock, expiry_date: '' });
            }

            // Sort batches by expiry date (ascending, oldest first). 
            // If no expiry date, use ID as secondary sort.
            updatedBatches.sort((a, b) => {
              if (a.expiry_date && b.expiry_date) {
                const dateA = new Date(a.expiry_date).getTime();
                const dateB = new Date(b.expiry_date).getTime();
                if (dateA !== dateB) return dateA - dateB;
              }
              if (a.expiry_date && !b.expiry_date) return -1;
              if (!a.expiry_date && b.expiry_date) return 1;
              
              // Secondary sort by ID
              return a.id.localeCompare(b.id);
            });

            // Deduct from batches if they exist (FEFO - First Expired, First Out)
            for (let i = 0; i < updatedBatches.length; i++) {
              if (remainingQtyToDeduct <= 0) break;
              
              const batch = updatedBatches[i];
              
              // Skip expired batches
              const isExpired = batch.expiry_date && differenceInDays(parseISO(batch.expiry_date), new Date()) < 0;
              if (isExpired) continue;

              if (batch.stock > 0) {
                const deductAmount = Math.min(batch.stock, remainingQtyToDeduct);
                batch.stock -= deductAmount;
                remainingQtyToDeduct -= deductAmount;
              }
            }

            await db.products.update(item.id, { 
              stock: dbProduct.stock - item.qty,
              stock_delta: (dbProduct.stock_delta || 0) - item.qty,
              batches: updatedBatches,
              updated_at: new Date().toISOString(),
              synced: 0
            });
          }
        }
      });

      clearCart();
      setIsCheckout(false);
      setIsCredit(false);
      setCustomerName('');
      setCustomerPhone('');
      setDueDate('');
      SyncService.sync(true).catch(err => console.error('Checkout sync failed:', err));
      
    } catch (error: any) {
      showAlert(t('error'), t('error') + ': ' + error.message);
    } finally {
      setIsProcessing(false);
      processingRef.current = false;
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full bg-slate-50 overflow-hidden relative">
      {/* Left Side: Product Selection */}
      <div className="flex-1 flex flex-col border-r border-slate-200 bg-white min-w-0 h-full">
        <div className="p-4 md:p-6 border-b border-slate-100 flex-shrink-0">
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 mb-4">{t('selectProducts')}</h1>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input 
              type="text" 
              placeholder={t('searchProductsPlaceholder')} 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4 md:gap-6 items-start">
            {filteredProducts.map(product => (
              <button 
                key={product.id} 
                onClick={() => addToCart({ ...product, stock: product.stock })}
                className="group bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-500 hover:shadow-md transition-all text-left relative overflow-hidden flex flex-col h-full min-h-[120px]"
              >
                <div className="absolute top-0 right-0 p-2 opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <div className="bg-blue-600 text-white p-1.5 rounded-lg">
                    <Plus className="w-4 h-4" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-slate-900 mb-1 text-sm md:text-base line-clamp-2 leading-tight">{product.name}</h3>
                  <p className="text-lg font-black text-blue-600 mt-auto">{formatCurrency(product.sell_price, currency)}</p>
                </div>
                <div className="mt-4 flex items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider border-t border-slate-50 pt-3">
                  <span className={`w-2 h-2 rounded-full mr-2 ${product.stock < 10 ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
                  {t('stock')}: {product.stock}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile Floating Cart Button */}
      {cart.length > 0 && !showCartMobile && (
        <button 
          onClick={() => {
            setShowCartMobile(true);
            setIsCheckout(true);
          }}
          className="md:hidden fixed bottom-6 right-6 bg-emerald-600 text-white p-4 rounded-2xl shadow-2xl z-40 flex items-center space-x-3 animate-in fade-in slide-in-from-bottom-4 duration-300 border-2 border-white/20"
        >
          <div className="relative">
            <ShoppingBag className="w-6 h-6" />
            <span className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-emerald-600">
              {cart.reduce((sum, item) => sum + item.qty, 0)}
            </span>
          </div>
          <div className="text-left">
            <p className="text-[10px] uppercase font-bold opacity-80 leading-none mb-1">{t('payNow')}</p>
            <p className="font-black text-sm leading-none">{formatCurrency(cartTotal(), currency)}</p>
          </div>
        </button>
      )}

      {/* Right Side: Cart & Checkout (Desktop) */}
      <div className={`
        fixed inset-0 z-50 md:relative md:z-0 md:flex md:w-[400px] lg:w-[450px] flex-col bg-slate-50 shadow-2xl transition-transform duration-300 h-full overflow-hidden
        ${showCartMobile ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}
      `}>
        <div className="p-6 md:p-8 border-b border-slate-200 bg-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center">
            <button onClick={() => setShowCartMobile(false)} className="md:hidden mr-4 p-2 hover:bg-slate-100 rounded-xl">
              <ArrowLeft className="w-6 h-6 text-slate-600" />
            </button>
            <h2 className="text-lg md:text-xl font-bold text-slate-900 flex items-center">
              <ShoppingBag className="w-5 h-5 md:w-6 md:h-6 mr-2 md:mr-3 text-blue-600" /> {t('cart')}
            </h2>
          </div>
          {cart.length > 0 && (
            <button onClick={clearCart} className="text-rose-500 text-xs md:text-sm font-bold hover:underline">{t('clearAll')}</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-8 space-y-3 md:space-y-4">
            {cart.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-4">
                <div className="w-16 h-16 md:w-20 md:h-20 bg-slate-100 rounded-full flex items-center justify-center">
                  <ShoppingBag className="w-8 h-8 md:w-10 md:h-10" />
                </div>
                <p className="font-bold text-sm md:text-base">{t('cartEmpty')}</p>
              </div>
            ) : (
              <>
                {isCheckout && isCredit && (
                  <div className="space-y-4 md:space-y-6 animate-in slide-in-from-bottom-4 duration-300 pb-4">
                    <div className="space-y-3 md:space-y-4 p-4 md:p-6 bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
                      <h3 className="font-bold text-slate-900 flex items-center">
                        <User className="w-4 h-4 mr-2 text-blue-600" /> {t('creditInfo')}
                      </h3>
                      <div className="relative">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 md:mb-2">{t('customerName')}</label>
                        <div className="relative">
                          <User className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5 md:w-4 md:h-4" />
                          <input 
                            required 
                            placeholder={t('searchOrEnterName')}
                            value={customerName} 
                            onChange={e => {
                              setCustomerName(e.target.value);
                              setShowSuggestions(true);
                            }} 
                            onFocus={() => setShowSuggestions(true)}
                            className="w-full pl-9 md:pl-10 pr-4 py-2 md:py-3 bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 text-sm" 
                          />
                        </div>
                        {showSuggestions && filteredCustomers.length > 0 && customerName && (
                          <div className="absolute z-20 w-full bg-white mt-2 border border-slate-200 rounded-xl md:rounded-2xl shadow-2xl max-h-40 overflow-y-auto">
                            {filteredCustomers.map(c => (
                              <button
                                key={c}
                                onClick={() => handleSelectCustomer(c)}
                                className="w-full text-left p-3 md:p-4 hover:bg-blue-50 border-b border-slate-100 last:border-0 text-xs md:text-sm font-bold text-slate-700"
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 md:mb-2">{t('phoneNumber')}</label>
                        <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className="w-full p-2 md:p-3 bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 text-sm" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 md:mb-2">{t('paymentDate')}</label>
                        <div className="relative">
                          <Calendar className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5 md:w-4 md:h-4" />
                          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full pl-9 md:pl-10 pr-4 py-2 md:py-3 bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-900 text-sm" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {cart.map(item => {
                  const isAtMaxStock = item.qty >= item.stock;
                  return (
                    <div key={item.id} className="bg-white p-4 md:p-5 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm flex items-center space-x-3 md:space-x-4">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-slate-900 text-xs md:text-sm truncate">{item.name}</h4>
                        <p className="text-blue-600 font-bold text-xs md:text-sm">{formatCurrency(item.sell_price, currency)}</p>
                      </div>
                      <div className="flex items-center bg-slate-100 rounded-xl md:rounded-2xl p-0.5 md:p-1">
                        <button 
                          onClick={() => item.qty > 1 ? updateQty(item.id, item.qty - 1) : removeFromCart(item.id)} 
                          className="p-1.5 md:p-2 text-slate-600 hover:bg-white rounded-lg md:rounded-xl transition-colors"
                        >
                          <Minus className="w-3 h-3 md:w-4 md:h-4" />
                        </button>
                        <input
                          type="number"
                          value={item.qty}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val)) {
                              // Ensure value is at least 1 and at most available stock
                              const newQty = Math.max(0, Math.min(val, item.stock));
                              if (newQty > 0) {
                                updateQty(item.id, newQty);
                              }
                            }
                          }}
                          onBlur={(e) => {
                            const val = parseInt(e.target.value);
                            if (isNaN(val) || val <= 0) {
                              updateQty(item.id, 1);
                            }
                          }}
                          className="w-10 md:w-12 text-center font-bold text-slate-900 text-xs md:text-sm bg-transparent border-none focus:ring-0 p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button 
                          onClick={() => item.qty < item.stock && updateQty(item.id, item.qty + 1)} 
                          disabled={isAtMaxStock}
                          className={`p-1.5 md:p-2 rounded-lg md:rounded-xl transition-colors ${isAtMaxStock ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-white'}`}
                        >
                          <Plus className="w-3 h-3 md:w-4 md:h-4" />
                        </button>
                      </div>
                      <button onClick={() => removeFromCart(item.id)} className="text-rose-500 p-1.5 md:p-2 hover:bg-rose-50 rounded-lg md:rounded-xl transition-colors">
                        <Trash2 className="w-4 h-4 md:w-5 md:h-5" />
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Checkout Section - Fixed at Bottom */}
        <div className="p-6 md:p-8 bg-white border-t border-slate-200 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] flex-shrink-0">
          <div className="mb-4 md:mb-6">
            <div className="flex justify-between text-slate-500 font-bold text-[10px] md:text-sm uppercase tracking-widest mb-1">
              <span>{t('totalPayment')}</span>
            </div>
            <div className="flex justify-between items-end">
              <span className="text-slate-900 font-black text-2xl md:text-3xl">{formatCurrency(cartTotal(), currency)}</span>
              <span className="text-slate-400 text-[10px] md:text-xs font-bold mb-1">{cart.reduce((sum, item) => sum + item.qty, 0)} {t('items')}</span>
            </div>
          </div>

          {!isCheckout ? (
            <div className="flex flex-col space-y-3">
              <button 
                onClick={() => handleCompleteSale('cash')}
                disabled={cart.length === 0 || isProcessing}
                className="w-full bg-emerald-600 disabled:bg-slate-200 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all flex items-center justify-center space-x-3"
              >
                {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                <span>{t('completeSaleCash')}</span>
              </button>
              <button 
                onClick={() => { setIsCredit(true); setIsCheckout(true); }}
                disabled={cart.length === 0 || isProcessing}
                className="w-full bg-amber-500 disabled:bg-slate-200 text-white font-bold py-4 rounded-2xl shadow-lg shadow-amber-500/20 hover:bg-amber-600 transition-all flex items-center justify-center space-x-3"
              >
                <CreditCard className="w-5 h-5" />
                <span>{t('sellOnCredit')}</span>
              </button>
            </div>
          ) : (
            <div className="flex space-x-3">
              <button 
                onClick={() => { setIsCheckout(false); setIsCredit(false); }}
                className="flex-1 bg-slate-100 text-slate-600 font-bold py-3 md:py-4 rounded-xl md:rounded-2xl hover:bg-slate-200 transition-colors text-sm md:text-base"
              >
                {t('cancel')}
              </button>
              <button 
                onClick={() => handleCompleteSale('credit')}
                disabled={!customerName || isProcessing}
                className="flex-[2] bg-emerald-600 disabled:bg-slate-200 text-white font-bold py-3 md:py-4 rounded-xl md:rounded-2xl shadow-xl shadow-emerald-600/20 hover:bg-emerald-700 transition-all flex items-center justify-center space-x-2 md:space-x-3 text-sm md:text-base"
              >
                {isProcessing ? <RefreshCw className="w-5 h-5 md:w-6 md:h-6 animate-spin" /> : <CheckCircle2 className="w-5 h-5 md:w-6 md:h-6" />}
                <span>{isProcessing ? t('processing') : t('completeCredit')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

