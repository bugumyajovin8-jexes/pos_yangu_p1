import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatCurrency, formatNumberWithCommas, parseFormattedNumber } from '../utils/format';
import { getValidStock, getExpiredStock, getTotalStock } from '../utils/stock';
import { Plus, Search, Edit, Trash2, AlertCircle, RefreshCw, Package, ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { useSupabaseData } from '../hooks/useSupabaseData';
import { db, recordAuditLog } from '../db';
import { SyncService } from '../services/sync';
import { useFeatureToggles } from '../hooks/useFeatureToggles';
import ImportExcelModal from '../components/ImportExcelModal';

export default function Bidhaa() {
  const user = useStore(state => state.user);
  const showAlert = useStore(state => state.showAlert);
  const showConfirm = useStore(state => state.showConfirm);
  const t = useStore(state => state.t);
  const { isFeatureEnabled } = useFeatureToggles();
  const canManageProducts = isFeatureEnabled('staff_product_management');
  
  const [shopSettings, setShopSettings] = useState<any>(null);
  
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [stockModalProduct, setStockModalProduct] = useState<any | null>(null);
  const [stockToAdd, setStockToAdd] = useState('');

  // Form states for formatting
  const [formBuyPrice, setFormBuyPrice] = useState('');
  const [formSellPrice, setFormSellPrice] = useState('');
  const [formStock, setFormStock] = useState('');
  const [formMinStock, setFormMinStock] = useState('');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formNotifyDays, setFormNotifyDays] = useState('10');

  useEffect(() => {
    if (editingProduct) {
      setFormBuyPrice(formatNumberWithCommas(editingProduct.buy_price));
      setFormSellPrice(formatNumberWithCommas(editingProduct.sell_price));
      setFormStock(formatNumberWithCommas(editingProduct.stock));
      setFormMinStock(formatNumberWithCommas(editingProduct.min_stock || 5));
      setFormNotifyDays(editingProduct.notify_expiry_days?.toString() || '10');
      setFormExpiryDate('');
    } else {
      setFormBuyPrice('');
      setFormSellPrice('');
      setFormStock('');
      setFormMinStock('5');
      setFormNotifyDays('10');
      setFormExpiryDate('');
    }
  }, [editingProduct, isAdding]);

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

  // Optimized product count for large datasets
  const activeProductCount = useLiveQuery(
    () => {
      if (!user?.shop_id) return 0;
      return db.products.where('shop_id').equals(user.shop_id).filter(p => !p.is_deleted).count();
    },
    [user?.shop_id]
  ) || 0;

  // Optimized product fetching for large datasets
  const filteredProducts = useLiveQuery(
    async () => {
      if (!user?.shop_id) return [];
      
      let query = db.products.where('shop_id').equals(user.shop_id);
      
      // Filter out deleted
      const activeProducts = await query.filter(p => !p.is_deleted).toArray();
      
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

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const id = editingProduct?.id || uuidv4();
    
    const stockNum = parseFormattedNumber(formStock);
    const delta = editingProduct ? (stockNum - editingProduct.stock) : stockNum;
    
    let updatedBatches = editingProduct?.batches ? [...editingProduct.batches] : [];
    
    // If editing, we force the batches to stay in sync with the new total stock
    if (editingProduct && delta !== 0) {
      if (updatedBatches.length > 0) {
        const targetBatch = updatedBatches.find(b => !b.expiry_date) || updatedBatches[0];
        if (targetBatch) targetBatch.stock += delta;
      } else {
        updatedBatches = [{ id: uuidv4(), stock: stockNum, expiry_date: '' }];
      }
    } else if (!editingProduct) {
      updatedBatches = [{ id: uuidv4(), stock: stockNum, expiry_date: formExpiryDate || '' }];
    }

    const productData = {
      id,
      shop_id: user?.shop_id || '',
      name: formData.get('name') as string,
      buy_price: parseFormattedNumber(formBuyPrice),
      sell_price: parseFormattedNumber(formSellPrice),
      stock: stockNum,
      stock_delta: (editingProduct?.stock_delta || 0) + delta,
      min_stock: parseFormattedNumber(formMinStock),
      notify_expiry_days: parseInt(formNotifyDays) || 10,
      unit: 'pcs',
      updated_at: new Date().toISOString(),
      created_at: editingProduct?.created_at || new Date().toISOString(),
      isDeleted: 0,
      synced: 0,
      batches: updatedBatches
    };

    try {
      await db.products.put(productData);
      
      // Record Audit Log
      if (editingProduct) {
        const changes: any = {};
        if (productData.name !== editingProduct.name) changes.name = { new: productData.name, old: editingProduct.name };
        if (productData.buy_price !== editingProduct.buy_price) changes.buy_price = { new: productData.buy_price, old: editingProduct.buy_price };
        if (productData.sell_price !== editingProduct.sell_price) changes.sell_price = { new: productData.sell_price, old: editingProduct.sell_price };
        if (productData.stock !== editingProduct.stock) changes.stock = { new: productData.stock, old: editingProduct.stock };
        if (productData.notify_expiry_days !== editingProduct.notify_expiry_days) changes.notify_expiry_days = { new: productData.notify_expiry_days, old: editingProduct.notify_expiry_days };

        await recordAuditLog('edit_product', {
          product_id: id,
          name: productData.name,
          changes
        });
      } else {
        await recordAuditLog('add_product', {
          product_id: id,
          name: productData.name,
          buy_price: productData.buy_price,
          sell_price: productData.sell_price,
          stock: productData.stock
        });
      }

      setIsAdding(false);
      setEditingProduct(null);
      SyncService.sync(true).catch(err => console.error('Product save sync failed:', err));
    } catch (error: any) {
      showAlert(t('error'), t('error') + ': ' + error.message);
    }
  };

  const handleDelete = async (id: string) => {
    showConfirm(
      t('delete'),
      t('confirmDeleteProduct'),
      async () => {
        try {
          const product = await db.products.get(id);
          await db.products.update(id, { is_deleted: 1, synced: 0, updated_at: new Date().toISOString() });
          
          // Record Audit Log
          await recordAuditLog('delete_product', {
            product_id: id,
            name: product?.name
          });

          await SyncService.sync(true);
        } catch (error: any) {
          showAlert(t('error'), t('error') + ': ' + error.message);
        }
      }
    );
  };

  const handleDeleteAll = async () => {
    if (!user?.shop_id) return;
    
    const activeProducts = await db.products
      .where('shop_id')
      .equals(user.shop_id)
      .filter(p => !p.is_deleted)
      .toArray();

    if (activeProducts.length === 0) return;

    showConfirm(
      t('deleteAll'),
      t('confirmDeleteAllProducts').replace('{count}', activeProducts.length.toString()),
      async () => {
        try {
          const now = new Date().toISOString();
          const updates = activeProducts.map(p => ({
            ...p,
            is_deleted: 1,
            synced: 0,
            updated_at: now
          }));
          await db.products.bulkPut(updates);
          
          // Record Audit Log
          await recordAuditLog('delete_all_products', {
            count: activeProducts.length
          });

          await SyncService.sync(true);
        } catch (error: any) {
          showAlert(t('error'), t('error') + ': ' + error.message);
        }
      }
    );
  };

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
      await db.products.update(stockModalProduct.id, {
        stock: stockModalProduct.stock + amount,
        stock_delta: (stockModalProduct.stock_delta || 0) + amount,
        batches: updatedBatches,
        updated_at: new Date().toISOString(),
        synced: 0
      });

      // Record Audit Log
      await recordAuditLog('add_stock', {
        product_id: stockModalProduct.id,
        name: stockModalProduct.name,
        amount: amount,
        new_stock: stockModalProduct.stock + amount
      });

      setStockModalProduct(null);
      setStockToAdd('');
      setFormExpiryDate('');
      SyncService.sync(true).catch(err => console.error('Stock add sync failed:', err));
    } catch (error: any) {
      showAlert(t('error'), t('error') + ': ' + error.message);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (isAdding || editingProduct) {
    const p = editingProduct;
    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto">
        <button 
          onClick={() => { setIsAdding(false); setEditingProduct(null); }}
          className="flex items-center text-slate-500 hover:text-slate-900 font-medium mb-6 md:mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> {t('back')}
        </button>

        <div className="bg-white p-6 md:p-8 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 mb-6 md:mb-8">
            {p ? t('editProduct') : t('addNewProduct')}
          </h1>

          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">{t('productName')}</label>
              <input required name="name" defaultValue={p?.name} className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="Mfano: Sukari 1kg" />
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{t('buyPrice')}</label>
                <input 
                  required 
                  type="text" 
                  value={formBuyPrice}
                  onFocus={(e) => e.target.select()}
                  onChange={e => setFormBuyPrice(formatNumberWithCommas(e.target.value))}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{t('sellPrice')}</label>
                <input 
                  required 
                  type="text" 
                  value={formSellPrice}
                  onFocus={(e) => e.target.select()}
                  onChange={e => setFormSellPrice(formatNumberWithCommas(e.target.value))}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{t('stockQuantity')}</label>
                <input 
                  required 
                  type="text" 
                  value={formStock}
                  onFocus={(e) => e.target.select()}
                  onChange={e => setFormStock(formatNumberWithCommas(e.target.value))}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                />
              </div>
              {shopSettings?.enable_expiry && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">{t('expiryDate')}</label>
                  <input 
                    type="date" 
                    value={formExpiryDate}
                    onChange={e => setFormExpiryDate(e.target.value)}
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{t('minStockAlert')}</label>
                <input 
                  required 
                  type="text" 
                  value={formMinStock}
                  onFocus={(e) => e.target.select()}
                  onChange={e => setFormMinStock(formatNumberWithCommas(e.target.value))}
                  className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                />
              </div>
              {shopSettings?.enable_expiry && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">{t('notifyExpiryDays')}</label>
                  <input 
                    type="number" 
                    value={formNotifyDays}
                    onChange={e => setFormNotifyDays(e.target.value)}
                    placeholder="10"
                    className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                  />
                </div>
              )}
            </div>

            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl mt-4 hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20">
              {t('saveProduct')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t('productsInStock')}</h1>
          <div className="flex items-center mt-1 space-x-2">
            <p className="text-slate-500 text-sm md:text-base">{t('manageProductsDesc')}</p>
            <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
            <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full border border-blue-100">
              {activeProductCount} {t('productTypes')}
            </span>
          </div>
        </div>
        <div className="flex flex-col md:flex-row w-full md:w-auto gap-3">
          {canManageProducts && (
            <>
              <button 
                onClick={handleDeleteAll}
                className="bg-rose-50 text-rose-600 px-6 py-3 rounded-xl font-bold flex items-center justify-center hover:bg-rose-100 transition-colors border border-rose-100"
              >
                <Trash2 className="w-5 h-5 mr-2" /> {t('deleteAll')}
              </button>
              <button 
                onClick={() => setIsImporting(true)}
                className="bg-emerald-50 text-emerald-600 px-6 py-3 rounded-xl font-bold flex items-center justify-center hover:bg-emerald-100 transition-colors border border-emerald-100"
              >
                <FileSpreadsheet className="w-5 h-5 mr-2" /> {t('importExcel')}
              </button>
              <button 
                onClick={() => setIsAdding(true)}
                className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
              >
                <Plus className="w-5 h-5 mr-2" /> {t('addProduct')}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
        <input 
          type="text" 
          placeholder={t('searchByName')} 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-12 pr-4 py-3 md:py-4 bg-white border border-slate-200 rounded-xl md:rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition-all"
        />
      </div>

      <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">{t('products')}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">{t('sellingPrice')}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">{t('stock')}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider text-right">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.map(product => (
                <tr key={product.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-5">
                    <div className="flex items-center">
                      <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center mr-4">
                        <Package className="w-5 h-5 text-slate-500" />
                      </div>
                      <span className="font-bold text-slate-900">{product.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className="font-medium text-slate-700">{formatCurrency(product.sell_price, currency)}</span>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <div className="flex items-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${product.stock <= (product.min_stock || 5) ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {product.stock} pcs
                        </span>
                        {product.stock <= (product.min_stock || 5) && (
                          <AlertCircle className="w-4 h-4 text-rose-500 ml-2" />
                        )}
                      </div>
                      {getExpiredStock(product) > 0 && (
                        <span className="text-xs font-bold text-rose-500 mt-1">
                          {getExpiredStock(product)} {t('expiredStock')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex justify-end space-x-2">
                      {canManageProducts && (
                        <>
                          <button 
                            onClick={() => setStockModalProduct(product)}
                            className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                            title={t('addStockTitle')}
                          >
                            <Plus className="w-5 h-5" />
                          </button>
                          <button 
                            onClick={() => setEditingProduct(product)}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                          >
                            <Edit className="w-5 h-5" />
                          </button>
                          <button 
                            onClick={() => handleDelete(product.id)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredProducts.map(product => (
            <div key={product.id} className="p-4 flex flex-col space-y-3">
              <div className="flex justify-between items-start">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center mr-3">
                    <Package className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">{product.name}</h3>
                    <p className="text-sm font-medium text-blue-600">{formatCurrency(product.sell_price, currency)}</p>
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl">
                <div className="flex flex-col">
                  <div className="flex items-center">
                    <span className="text-xs font-bold text-slate-500 uppercase mr-2">{t('stock')}:</span>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${product.stock <= (product.min_stock || 5) ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {product.stock} pcs
                    </span>
                    {product.stock <= (product.min_stock || 5) && (
                      <AlertCircle className="w-4 h-4 text-rose-500 ml-2" />
                    )}
                  </div>
                  {getExpiredStock(product) > 0 && (
                    <span className="text-xs font-bold text-rose-500 mt-1">
                      {getExpiredStock(product)} {t('expiredStock')}
                    </span>
                  )}
                </div>
                <div className="flex space-x-1">
                  {canManageProducts && (
                    <>
                      <button 
                        onClick={() => setStockModalProduct(product)}
                        className="p-2 text-slate-400 hover:text-amber-600"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => setEditingProduct(product)}
                        className="p-2 text-slate-400 hover:text-blue-600"
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => handleDelete(product.id)}
                        className="p-2 text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        {filteredProducts.length === 0 && (
          <div className="text-center py-20">
            <Package className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">{t('noProductsFound')}</p>
          </div>
        )}
      </div>

      {/* Stock Addition Modal */}
      {stockModalProduct && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl border border-slate-200">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">{t('addStockTitle')}</h2>
            <p className="text-slate-500 mb-8">
              {t('addingStockTo')} <span className="font-bold text-slate-900">{stockModalProduct.name}</span>. 
              {t('currentStockIs')} <span className="font-bold text-slate-900">{stockModalProduct.stock}</span>.
            </p>
            
            <form onSubmit={handleAddStockSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">{t('quantityToAdd')}</label>
                <input 
                  autoFocus
                  required
                  type="text"
                  placeholder="Mfano: 10"
                  value={stockToAdd}
                  onFocus={(e) => e.target.select()}
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

      <ImportExcelModal 
        isOpen={isImporting} 
        onClose={() => setIsImporting(false)} 
      />

    </div>
  );
}
