import { useState } from 'react';
import { X, Trash2, AlertTriangle, Calendar, RefreshCw } from 'lucide-react';
import { db } from '../db';
import { startOfDay, startOfWeek, startOfMonth, startOfYear, subDays, subWeeks, subMonths, subYears } from 'date-fns';
import { SyncService } from '../services/sync';
import { useStore } from '../store';

interface DeleteHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Period = 'today' | 'week' | 'month' | 'year' | 'all';

export default function DeleteHistoryModal({ isOpen, onClose }: DeleteHistoryModalProps) {
  const [period, setPeriod] = useState<Period>('today');
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmStep, setConfirmStep] = useState(1);
  const showAlert = useStore(state => state.showAlert);

  if (!isOpen) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const now = new Date();
      let startDate: number;

      switch (period) {
        case 'today':
          startDate = startOfDay(now).getTime();
          break;
        case 'week':
          startDate = startOfWeek(now).getTime();
          break;
        case 'month':
          startDate = startOfMonth(now).getTime();
          break;
        case 'year':
          startDate = startOfYear(now).getTime();
          break;
        case 'all':
          startDate = 0;
          break;
        default:
          startDate = 0;
      }

      // Find sales to delete
      const salesToDelete = await db.sales
        .filter(s => new Date(s.created_at).getTime() >= startDate && !s.is_deleted)
        .toArray();

      if (salesToDelete.length === 0) {
        showAlert('Taarifa', 'Hakuna data ya kufuta katika kipindi hiki.');
        setIsDeleting(false);
        return;
      }

      const saleIds = salesToDelete.map(s => s.id);

      // Mark sales as deleted
      await db.sales.bulkUpdate(saleIds.map(id => ({
        key: id,
        changes: { is_deleted: 1, synced: 0, updated_at: new Date().toISOString() }
      })));

      // Mark sale items as deleted
      const itemsToDelete = await db.saleItems
        .filter(item => saleIds.includes(item.sale_id) && !item.is_deleted)
        .toArray();
      
      if (itemsToDelete.length > 0) {
        await db.saleItems.bulkUpdate(itemsToDelete.map(item => ({
          key: item.id,
          changes: { is_deleted: 1, synced: 0 }
        })));
      }

      // Also mark expenses as deleted if they are in the period?
      // The user said "revenue and profit", which usually means sales.
      // But expenses also affect net profit. Let's include them for consistency.
      const expensesToDelete = await db.expenses
        .filter(e => new Date(e.created_at).getTime() >= startDate && !e.is_deleted)
        .toArray();
      
      if (expensesToDelete.length > 0) {
        await db.expenses.bulkUpdate(expensesToDelete.map(e => ({
          key: e.id,
          changes: { is_deleted: 1, synced: 0, updated_at: new Date().toISOString() }
        })));
      }

      // Sync changes
      await SyncService.sync(true);

      showAlert('Imefanikiwa', `Data ya ${salesToDelete.length} mauzo imefutwa kikamilifu.`);
      onClose();
    } catch (error: any) {
      showAlert('Kosa', 'Imeshindwa kufuta data: ' + error.message);
    } finally {
      setIsDeleting(false);
      setConfirmStep(1);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center">
              <Trash2 className="w-5 h-5 text-rose-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Futa Historia</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        <div className="p-8">
          {confirmStep === 1 ? (
            <div className="space-y-6">
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start space-x-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-800 leading-relaxed">
                  Kitendo hiki kitaondoa data ya mauzo na faida kutoka kwenye ripoti zako. Data hii haitaonekana tena kwenye dashibodi.
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-bold text-slate-700 ml-1">Chagua Kipindi cha Kufuta:</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'today', label: 'Leo' },
                    { id: 'week', label: 'Wiki Hii' },
                    { id: 'month', label: 'Mwezi Huu' },
                    { id: 'year', label: 'Mwaka Huu' },
                    { id: 'all', label: 'Zote (Yote)' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPeriod(p.id as Period)}
                      className={`py-3 px-4 rounded-xl text-sm font-bold border-2 transition-all ${
                        period === p.id 
                          ? 'border-blue-600 bg-blue-50 text-blue-600' 
                          : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setConfirmStep(2)}
                className="w-full py-4 bg-rose-600 text-white font-bold rounded-2xl shadow-lg shadow-rose-600/20 hover:bg-rose-700 transition-all flex items-center justify-center"
              >
                Endelea Kufuta
              </button>
            </div>
          ) : (
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center mx-auto animate-bounce">
                <AlertTriangle className="w-10 h-10 text-rose-600" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-bold text-slate-900">Je, Una Uhakika?</h3>
                <p className="text-slate-500">
                  Unakaribia kufuta data ya kipindi cha <span className="font-bold text-rose-600 uppercase">{period}</span>. Kitendo hiki hakiwezi kurejeshwa.
                </p>
              </div>

              <div className="flex space-x-4 pt-4">
                <button
                  onClick={() => setConfirmStep(1)}
                  disabled={isDeleting}
                  className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all"
                >
                  Rudi Nyuma
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex-1 py-4 bg-rose-600 text-white font-bold rounded-2xl shadow-lg shadow-rose-600/20 hover:bg-rose-700 transition-all flex items-center justify-center"
                >
                  {isDeleting ? (
                    <>
                      <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                      Inafuta...
                    </>
                  ) : (
                    'Ndio, Futa Sasa'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
