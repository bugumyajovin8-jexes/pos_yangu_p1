import { useState, useEffect } from 'react';
import { useSupabaseData } from '../hooks/useSupabaseData';
import { formatCurrency } from '../utils/format';
import { AlertTriangle, Package, Calendar, RefreshCw, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { db } from '../db';
import { differenceInDays, isPast, parseISO } from 'date-fns';
import { useNavigate } from 'react-router-dom';

export default function Expiry() {
  const user = useStore(state => state.user);
  const t = useStore(state => state.t);
  const showAlert = useStore(state => state.showAlert);
  const showConfirm = useStore(state => state.showConfirm);
  const navigate = useNavigate();
  const [shopSettings, setShopSettings] = useState<any>(null);
  const [currency, setCurrency] = useState('TZS');
  const { data: products, loading } = useSupabaseData<any>('products');

  useEffect(() => {
    if (user?.shop_id) {
      db.shops.get(user.shop_id).then(data => {
        setShopSettings(data);
        if (data && data.enable_expiry === false) {
          navigate('/');
        }
      });
      db.settings.get(1).then(data => {
        if (data?.currency) setCurrency(data.currency);
      });
    }
  }, [user?.shop_id, navigate]);

  // Process products to find expiring batches
  const expiringItems = products.flatMap(product => {
    if (!product.batches || product.is_deleted) return [];
    
    return product.batches
      .filter((batch: any) => batch.expiry_date && batch.stock > 0)
      .map((batch: any) => {
        const expiryDate = parseISO(batch.expiry_date);
        const daysUntilExpiry = differenceInDays(expiryDate, new Date());
        
        return {
          ...product,
          batchId: batch.id,
          batchStock: batch.stock,
          expiryDate: batch.expiry_date,
          daysUntilExpiry,
          notifyDays: product.notify_expiry_days || 30,
          isExpired: isPast(expiryDate) && daysUntilExpiry < 0
        };
      });
  }).sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  const expired = expiringItems.filter(item => item.isExpired);
  const expiringSoon = expiringItems.filter(item => !item.isExpired && item.daysUntilExpiry <= item.notifyDays);

  const handleDisposeBatch = async (productId: string, batchId: string) => {
    showConfirm(
      t('disposeBatch'),
      t('disposeBatchConfirm'),
      async () => {
        try {
          const product = products.find(p => p.id === productId);
          if (!product) return;

          const updatedBatches = product.batches.filter((b: any) => b.id !== batchId);
          const removedBatch = product.batches.find((b: any) => b.id === batchId);
          const newTotalStock = Math.max(0, (product.stock || 0) - (removedBatch?.stock || 0));

          await db.products.update(productId, {
            batches: updatedBatches,
            stock: newTotalStock,
            stock_delta: (product.stock_delta || 0) - (removedBatch?.stock || 0),
            updated_at: new Date().toISOString(),
            synced: 0
          });
          showAlert(t('success'), t('disposeBatchSuccess'));
        } catch (error: any) {
          showAlert(t('error'), t('disposeBatchError') + ': ' + error.message);
        }
      }
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t('expiryTracking')}</h1>
        <p className="text-slate-500 mt-1 text-sm md:text-base">{t('expiredAndExpiringSoon')}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Expired Products */}
        <div className="bg-white rounded-2xl md:rounded-3xl border border-rose-200 shadow-sm overflow-hidden">
          <div className="bg-rose-50 p-4 md:p-6 border-b border-rose-100 flex items-center">
            <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center mr-4">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-rose-900">{t('expiredProducts')}</h2>
              <p className="text-sm text-rose-600 font-medium">{expired.length} {t('products').toLowerCase()}</p>
            </div>
            {expired.length > 0 && (
              <button 
                onClick={() => {
                  showConfirm(
                    t('disposeAll'),
                    t('disposeAllConfirm'),
                    async () => {
                      for (const item of expired) {
                        // We need a direct way to update without multiple confirms
                        const product = products.find(p => p.id === item.id);
                        if (product) {
                          const updatedBatches = product.batches.filter((b: any) => b.id !== item.batchId);
                          const removedBatch = product.batches.find((b: any) => b.id === item.batchId);
                          const newTotalStock = Math.max(0, (product.stock || 0) - (removedBatch?.stock || 0));
                          await db.products.update(item.id, {
                            batches: updatedBatches,
                            stock: newTotalStock,
                            stock_delta: (product.stock_delta || 0) - (removedBatch?.stock || 0),
                            updated_at: new Date().toISOString(),
                            synced: 0
                          });
                        }
                      }
                      showAlert(t('success'), t('disposeBatchSuccess'));
                    }
                  );
                }}
                className="text-xs font-bold text-rose-600 hover:underline flex items-center"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" /> {t('disposeAll')}
              </button>
            )}
          </div>
          
          <div className="divide-y divide-slate-100">
            {expired.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                {t('noExpiredProducts')}
              </div>
            ) : (
              expired.map(item => (
                <div key={`${item.id}-${item.batchId}`} className="p-4 md:p-6 flex items-start justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-start">
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center mr-4 flex-shrink-0 mt-1">
                      <Package className="w-5 h-5 text-slate-500" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">{item.name}</h3>
                      <div className="flex items-center mt-1 space-x-4 text-sm">
                        <span className="text-slate-600 font-medium">{t('stock')}: <span className="text-slate-900 font-bold">{item.batchStock}</span></span>
                        <span className="text-slate-600 font-medium">{t('price')}: <span className="text-slate-900 font-bold">{formatCurrency(item.sell_price, currency)}</span></span>
                      </div>
                      <div className="flex items-center mt-2 text-xs font-bold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg inline-flex">
                        <Calendar className="w-3.5 h-3.5 mr-1.5" />
                        {t('expiredOn')}: {new Date(item.expiryDate).toLocaleDateString(useStore.getState().language === 'sw' ? 'sw-TZ' : 'en-US')}
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDisposeBatch(item.id, item.batchId)}
                    className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                    title={t('disposeBatch')}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Expiring Soon Products */}
        <div className="bg-white rounded-2xl md:rounded-3xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="bg-amber-50 p-4 md:p-6 border-b border-amber-100 flex items-center">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center mr-4">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-amber-900">{t('expiringSoonProducts')}</h2>
              <p className="text-sm text-amber-600 font-medium">{expiringSoon.length} {t('products').toLowerCase()}</p>
            </div>
          </div>
          
          <div className="divide-y divide-slate-100">
            {expiringSoon.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                {t('noExpiringSoonProducts')}
              </div>
            ) : (
              expiringSoon.map(item => (
                <div key={`${item.id}-${item.batchId}`} className="p-4 md:p-6 flex items-start justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-start">
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center mr-4 flex-shrink-0 mt-1">
                      <Package className="w-5 h-5 text-slate-500" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">{item.name}</h3>
                      <div className="flex items-center mt-1 space-x-4 text-sm">
                        <span className="text-slate-600 font-medium">{t('stock')}: <span className="text-slate-900 font-bold">{item.batchStock}</span></span>
                        <span className="text-slate-600 font-medium">{t('price')}: <span className="text-slate-900 font-bold">{formatCurrency(item.sell_price, currency)}</span></span>
                      </div>
                      <div className="flex items-center mt-2 text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg inline-flex">
                        <Calendar className="w-3.5 h-3.5 mr-1.5" />
                        {t('expiresOn')}: {new Date(item.expiryDate).toLocaleDateString(useStore.getState().language === 'sw' ? 'sw-TZ' : 'en-US')} ({item.daysUntilExpiry} {t('daysRemaining')})
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDisposeBatch(item.id, item.batchId)}
                    className="p-2 text-amber-600 hover:bg-amber-50 rounded-xl transition-colors"
                    title={t('disposeBatch')}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
