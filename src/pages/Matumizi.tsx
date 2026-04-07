import { useState, useEffect } from 'react';
import { formatCurrency, formatNumberWithCommas, parseFormattedNumber } from '../utils/format';
import { Plus, Search, Trash2, RefreshCw, Receipt, ArrowLeft, Calendar, Tag, DollarSign, ShieldAlert } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { useSupabaseData } from '../hooks/useSupabaseData';
import { db, recordAuditLog } from '../db';
import { SyncService } from '../services/sync';
import { startOfMonth } from 'date-fns';
import { useFeatureToggles } from '../hooks/useFeatureToggles';
import { Navigate } from 'react-router-dom';

export default function Matumizi() {
  const user = useStore(state => state.user);
  const t = useStore(state => state.t);
  const showAlert = useStore(state => state.showAlert);
  const showConfirm = useStore(state => state.showConfirm);
  const { isFeatureEnabled, isBoss } = useFeatureToggles();
  const canManageExpenses = isFeatureEnabled('staff_expense_management');

  if (!isBoss() && !canManageExpenses) {
    return <Navigate to="/" />;
  }

  const [shopSettings, setShopSettings] = useState<any>(null);
  const { data: expenses, loading, refresh } = useSupabaseData<any>('expenses');
  
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [formAmount, setFormAmount] = useState('');

  useEffect(() => {
    if (!isAdding) {
      setFormAmount('');
    }
  }, [isAdding]);

  useEffect(() => {
    if (user?.shop_id) {
      db.settings.get(1).then(data => setShopSettings(data));
    }
  }, [user?.shop_id]);

  const currency = shopSettings?.currency || 'TZS';

  const myExpenses = expenses.filter(e => e.user_id === user?.id);

  const filteredExpenses = myExpenses
    .filter(e => !e.is_deleted && (e.description.toLowerCase().includes(search.toLowerCase()) || e.category.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const expenseData = {
      id: uuidv4(),
      shop_id: user?.shop_id || '',
      user_id: user?.id || '',
      description: (formData.get('description') as string) || (formData.get('category') as string),
      amount: parseFormattedNumber(formAmount),
      category: formData.get('category') as string,
      date: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      isDeleted: 0,
      synced: 0
    };

    try {
      await db.expenses.add(expenseData);
      
      // Record Audit Log
      await recordAuditLog('add_expense', {
        amount: expenseData.amount,
        category: expenseData.category,
        description: expenseData.description
      });

      setIsAdding(false);
      SyncService.sync(true).catch(err => console.error('Expense sync failed:', err));
    } catch (error: any) {
      showAlert(t('error'), t('saveFailed') + ': ' + error.message);
    }
  };

  const handleDelete = async (id: string) => {
    showConfirm(t('deleteExpense'), t('deleteExpenseConfirm'), async () => {
      try {
        const expense = await db.expenses.get(id);
        await db.expenses.update(id, { is_deleted: 1, synced: 0, updated_at: new Date().toISOString() });
        
        // Record Audit Log
        await recordAuditLog('delete_expense', {
          expense_id: id,
          category: expense?.category,
          amount: expense?.amount
        });

        await SyncService.sync(true);
      } catch (error: any) {
        showAlert(t('error'), t('deleteFailed') + ': ' + error.message);
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (isAdding) {
    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto">
        <button 
          onClick={() => setIsAdding(false)}
          className="flex items-center text-slate-500 hover:text-slate-900 font-medium mb-6 md:mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> {t('back')}
        </button>

        <div className="bg-white p-6 md:p-8 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 mb-6 md:mb-8">
            {t('newExpense')}
          </h1>

          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">{t('category')}</label>
              <div className="relative">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <select required name="category" className="w-full pl-10 p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none">
                  <option value="Chakula">{t('expenseCategoryFood')}</option>
                  <option value="Usafiri">{t('expenseCategoryTransport')}</option>
                  <option value="Kodi">{t('expenseCategoryRent')}</option>
                  <option value="Mshahara">{t('expenseCategorySalary')}</option>
                  <option value="Umeme/Maji">{t('expenseCategoryUtilities')}</option>
                  <option value="Vifaa">{t('expenseCategoryEquipment')}</option>
                  <option value="Matengenezo">{t('expenseCategoryMaintenance')}</option>
                  <option value="Nyingine">{t('expenseCategoryOther')}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">{t('expenseDescription')}</label>
              <input name="description" className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder={t('expenseDescriptionPlaceholder')} />
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">{t('amount')}</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  required 
                  type="text" 
                  value={formAmount}
                  onChange={e => setFormAmount(formatNumberWithCommas(e.target.value))}
                  className="w-full pl-10 p-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                  placeholder="0" 
                />
              </div>
            </div>

            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl mt-4 hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20">
              {t('saveExpense')}
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
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t('businessExpenses')}</h1>
          <p className="text-slate-500 mt-1 text-sm md:text-base">{t('trackOperatingCosts')}</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="w-full md:w-auto bg-blue-600 text-white px-6 py-3 rounded-xl font-bold flex items-center justify-center hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
        >
          <Plus className="w-5 h-5 mr-2" /> {t('addExpense')}
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">{t('totalExpenses')}</p>
          <h3 className="text-2xl font-black text-slate-900">
            {formatCurrency(myExpenses.filter((e: any) => !e.is_deleted).reduce((sum, e) => sum + e.amount, 0), currency)}
          </h3>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">{t('monthlyExpenses')}</p>
          <h3 className="text-2xl font-black text-blue-600">
            {formatCurrency(
              myExpenses
                .filter((e: any) => !e.is_deleted && new Date(e.created_at).getTime() >= startOfMonth(new Date()).getTime())
                .reduce((sum, e) => sum + e.amount, 0), 
              currency
            )}
          </h3>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">{t('recordCount')}</p>
          <h3 className="text-2xl font-black text-slate-900">{myExpenses.filter((e: any) => !e.is_deleted).length}</h3>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
        <input 
          type="text" 
          placeholder={t('searchExpensesPlaceholder')} 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-12 pr-4 py-3 md:py-4 bg-white border border-slate-200 rounded-xl md:rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition-all"
        />
      </div>

      <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="hidden md:block">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">{t('date')}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">{t('description')}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">{t('category')}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider">{t('amount')}</th>
                <th className="px-6 py-4 text-sm font-bold text-slate-600 uppercase tracking-wider text-right">{t('action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredExpenses.map(expense => (
                <tr key={expense.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-5">
                    <div className="flex items-center text-slate-500">
                      <Calendar className="w-4 h-4 mr-2" />
                      <span className="text-sm">{new Date(expense.created_at).toLocaleDateString()}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className="font-bold text-slate-900">{expense.description}</span>
                  </td>
                  <td className="px-6 py-5">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                      {expense.category}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <span className="font-bold text-rose-600">-{formatCurrency(expense.amount, currency)}</span>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <button onClick={() => handleDelete(expense.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-slate-100">
          {filteredExpenses.map(expense => (
            <div key={expense.id} className="p-4 flex flex-col space-y-3">
              <div className="flex justify-between items-start">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-rose-50 rounded-lg flex items-center justify-center mr-3">
                    <Receipt className="w-5 h-5 text-rose-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">{expense.description}</h3>
                    <p className="text-xs text-slate-500">{new Date(expense.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <button onClick={() => handleDelete(expense.id)} className="p-2 text-slate-400 hover:text-rose-600">
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
              <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white border border-slate-200 text-slate-700 uppercase">
                  {expense.category}
                </span>
                <span className="font-bold text-rose-600">-{formatCurrency(expense.amount, currency)}</span>
              </div>
            </div>
          ))}
        </div>

        {filteredExpenses.length === 0 && (
          <div className="text-center py-20">
            <Receipt className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">{t('noExpensesFound')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
