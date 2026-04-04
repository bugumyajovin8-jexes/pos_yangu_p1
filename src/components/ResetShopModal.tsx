import { useState } from 'react';
import { Trash2, AlertCircle, RefreshCw } from 'lucide-react';
import { db } from '../db';
import { SyncService } from '../services/sync';
import { useStore } from '../store';

interface ResetShopModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ResetShopModal({ isOpen, onClose }: ResetShopModalProps) {
  const [isResetting, setIsResetting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const showAlert = useStore(state => state.showAlert);

  if (!isOpen) return null;

  const handleReset = async () => {
    if (confirmText !== 'FUTA') return;
    
    setIsResetting(true);
    try {
      // Mark all products, sales, saleItems, and expenses as deleted
      const now = new Date().toISOString();
      
      const products = await db.products.toArray();
      await db.products.bulkPut(products.map(p => ({ ...p, is_deleted: 1, synced: 0, updated_at: now })));
      
      const sales = await db.sales.toArray();
      await db.sales.bulkPut(sales.map(s => ({ ...s, is_deleted: 1, synced: 0, updated_at: now })));
      
      const saleItems = await db.saleItems.toArray();
      await db.saleItems.bulkPut(saleItems.map(si => ({ ...si, is_deleted: 1, synced: 0, updated_at: now })));
      
      const expenses = await db.expenses.toArray();
      await db.expenses.bulkPut(expenses.map(e => ({ ...e, is_deleted: 1, synced: 0, updated_at: now })));

      await SyncService.sync(true);
      showAlert('Imefanikiwa', 'Duka limefutwa kikamilifu!');
      onClose();
    } catch (error: any) {
      showAlert('Kosa', 'Imeshindwa kufuta duka: ' + error.message);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200">
        <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center mb-6 mx-auto">
          <Trash2 className="w-8 h-8 text-rose-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">Futa Taarifa za Duka</h2>
        <p className="text-slate-500 mb-6 text-center text-sm">
          Kitendo hiki kitafuta bidhaa zote, mauzo, na matumizi. Hakiwezi kurejeshwa.
        </p>

        <div className="bg-rose-50 border border-rose-100 p-4 rounded-xl mb-6 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-rose-700 leading-relaxed">
            Tafadhali andika neno <span className="font-black">FUTA</span> hapa chini ili kuthibitisha.
          </p>
        </div>

        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
          placeholder="Andika FUTA"
          className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-rose-500 outline-none text-center font-black tracking-widest mb-6"
        />
        
        <div className="flex space-x-4">
          <button 
            onClick={onClose}
            disabled={isResetting}
            className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            Ghairi
          </button>
          <button 
            onClick={handleReset}
            disabled={confirmText !== 'FUTA' || isResetting}
            className="flex-1 py-4 bg-rose-600 text-white font-bold rounded-2xl shadow-lg shadow-rose-600/20 hover:bg-rose-700 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            {isResetting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
            <span>{isResetting ? 'Inafuta...' : 'Futa Zote'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
