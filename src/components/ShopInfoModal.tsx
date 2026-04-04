import { useState, useEffect } from 'react';
import { X, Save, Store, MapPin, Phone, User, Calendar, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react';
import { db } from '../db';
import { useStore } from '../store';
import { SyncService } from '../services/sync';

interface ShopInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  shopData: any;
  onUpdate: (updatedData: any) => void;
}

export default function ShopInfoModal({ isOpen, onClose, shopData, onUpdate }: ShopInfoModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    owner_name: '',
    enable_expiry: false
  });
  const [loading, setLoading] = useState(false);

  const showAlert = useStore(state => state.showAlert);

  useEffect(() => {
    if (shopData) {
      setFormData({
        name: shopData.name || '',
        phone: shopData.phone || '',
        owner_name: shopData.owner_name || '',
        enable_expiry: !!shopData.enable_expiry
      });
    }
  }, [shopData]);

  const handleSave = async () => {
    if (!shopData?.id) return;
    setLoading(true);
    try {
      const updatedShop = {
        ...shopData,
        ...formData,
        updated_at: new Date().toISOString(),
        synced: 0
      };
      await db.shops.update(shopData.id, updatedShop);
      onUpdate(updatedShop);
      await SyncService.sync(true);
      onClose();
    } catch (error) {
      console.error('Failed to update shop info', error);
      showAlert('Kosa', 'Imeshindwa kuhifadhi mabadiliko.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center mr-4">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Taarifa za Duka</h2>
              <p className="text-xs text-slate-500">Hariri maelezo ya biashara yako</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Jina la Duka</label>
              <div className="relative">
                <Store className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-all font-medium"
                  placeholder="Mf: Juma General Store"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Namba ya Simu</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={formData.phone}
                  onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-all font-medium"
                  placeholder="Mf: 0787979273"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Jina la Mmiliki</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={formData.owner_name}
                  onChange={e => setFormData({ ...formData, owner_name: e.target.value })}
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-all font-medium"
                  placeholder="Mf: John Doe"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between p-4 bg-blue-50 rounded-2xl border border-blue-100">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mr-4">
                    <Calendar className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Usimamizi wa Expiry</h4>
                    <p className="text-[10px] text-slate-500">Washa/Zima ufuatiliaji wa tarehe za kuisha</p>
                  </div>
                </div>
                <button 
                  onClick={() => setFormData({ ...formData, enable_expiry: !formData.enable_expiry })}
                  className={`p-1 rounded-full transition-colors ${formData.enable_expiry ? 'text-blue-600' : 'text-slate-300'}`}
                >
                  {formData.enable_expiry ? <ToggleRight className="w-10 h-10" /> : <ToggleLeft className="w-10 h-10" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 bg-slate-50 border-t border-slate-100 flex space-x-4">
          <button
            onClick={onClose}
            className="flex-1 py-4 bg-white border border-slate-200 text-slate-600 font-bold rounded-2xl hover:bg-slate-100 transition-colors"
          >
            Ghairi
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors flex items-center justify-center disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
            Hifadhi
          </button>
        </div>
      </div>
    </div>
  );
}
