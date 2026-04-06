import { useState } from 'react';
import { Package, Plus, X } from 'lucide-react';
import { formatNumberWithCommas, parseFormattedNumber } from '../utils/format';
import { getValidStock } from '../utils/stock';
import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { useFeatureToggles } from '../hooks/useFeatureToggles';

export default function LowStockModal({ isOpen, onClose, lowStockProducts, shopSettings }: any) {
  const [stockModalProduct, setStockModalProduct] = useState<any | null>(null);
  const [stockToAdd, setStockToAdd] = useState('');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const t = useStore(state => state.t);
  const showAlert = useStore(state => state.showAlert);
  const { isFeatureEnabled } = useFeatureToggles();
  const canManageProducts = isFeatureEnabled('staff_product_management');

  if (!isOpen) return null;

  const handleAddStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockModalProduct) return;
    
    const amount = parseFormattedNumber(stockToAdd);
    if (isNaN(amount) || amount <= 0) {
      showAlert(t('error'), t('invalidNumber'));
      return;
    }
    
    let updatedBatches = stockModalProduct.batches ? [...stockModalProduct.batches] : [];
    if (formExpiryDate) {
      const existingBatch = updatedBatches.find((b: any) => b.expiry_date === formExpiryDate);
      if (existingBatch) {
        existingBatch.stock += amount;
      } else {
        updatedBatches.push({ id: uuidv4(), stock: amount, expiry_date: formExpiryDate });
      }
    } else {
      const noExpiryBatch = updatedBatches.find((b: any) => !b.expiry_date);
      if (noExpiryBatch) {
        noExpiryBatch.stock += amount;
      } else {
        updatedBatches.push({ id: uuidv4(), stock: amount, expiry_date: '' });
      }
    }

    try {
      const currentDelta = stockModalProduct.stock_delta || 0;
      await db.products.update(stockModalProduct.id, {
        stock: stockModalProduct.stock + amount,
        stock_delta: currentDelta + amount,
        batches: updatedBatches,
        updated_at: new Date().toISOString(),
        synced: 0
      });
      setStockModalProduct(null);
      setStockToAdd('');
      setFormExpiryDate('');
      showAlert(t('success'), t('stockAddedSuccess'));
    } catch (error: any) {
      showAlert(t('error'), t('error') + ': ' + error.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center space-x-3 text-rose-600">
            <Package className="w-6 h-6" />
            <h2 className="text-xl font-bold text-slate-900">{t('lowStockTitle')}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          {lowStockProducts.length === 0 ? (
            <div className="text-center py-10">
              <Package className="w-12 h-12 text-slate-200 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">{t('noLowStockProducts')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {lowStockProducts.map((product: any) => (
                <div key={product.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                      <Package className="w-5 h-5 text-slate-400" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">{product.name}</h3>
                      <div className="flex items-center mt-1">
                        <span className="text-xs font-bold text-slate-500 mr-2">{t('stock')}:</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold bg-rose-100 text-rose-700">
                          {getValidStock(product)} pcs
                        </span>
                        <span className="text-xs text-slate-400 ml-2">({t('minStockAlert')}: {product.min_stock || 5})</span>
                      </div>
                    </div>
                  </div>
                  {canManageProducts && (
                    <button 
                      onClick={() => setStockModalProduct(product)}
                      className="flex items-center space-x-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-100 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="hidden sm:inline">{t('addStock')}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Nested Add Stock Modal */}
      {stockModalProduct && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl border border-slate-200">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">{t('addStockTitle')}</h2>
            <p className="text-slate-500 mb-8">
              {t('addingStockTo')} <span className="font-bold text-slate-900">{stockModalProduct.name}</span>. 
              {t('currentStockIs')} <span className="font-bold text-slate-900">{getValidStock(stockModalProduct)}</span>.
            </p>
            
            <form onSubmit={handleAddStockSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{t('quantityToAdd')}</label>
                <input 
                  autoFocus
                  required
                  type="text"
                  placeholder={t('exampleAmount')}
                  value={stockToAdd}
                  onChange={e => setStockToAdd(formatNumberWithCommas(e.target.value))}
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-xl font-bold mb-4"
                />
              </div>
              
              {shopSettings?.enable_expiry && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">{t('expiryDateOptional')}</label>
                  <input 
                    type="date"
                    value={formExpiryDate}
                    onChange={e => setFormExpiryDate(e.target.value)}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-xl font-bold"
                  />
                  <p className="text-xs text-slate-500 mt-2">{t('expiryDateDesc')}</p>
                </div>
              )}
              
              <div className="flex space-x-4">
                <button 
                  type="button"
                  onClick={() => { setStockModalProduct(null); setStockToAdd(''); setFormExpiryDate(''); }}
                  className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-colors"
                >
                  {t('cancel')}
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors"
                >
                  {t('add')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
