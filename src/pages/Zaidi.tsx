import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { LogOut, Phone, ShieldCheck, CreditCard, User, Store, Globe, HelpCircle, ChevronRight, Receipt, FileSpreadsheet, RefreshCw, Trash2, Clock, Zap, Wallet, AlertTriangle } from 'lucide-react';
import { supabase } from '../supabase';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import ImportExcelModal from '../components/ImportExcelModal';
import ShopInfoModal from '../components/ShopInfoModal';
import DeleteHistoryModal from '../components/DeleteHistoryModal';
import ResetShopModal from '../components/ResetShopModal';
import { SyncService } from '../services/sync';
import { LicenseService } from '../services/license';
import { formatDistanceToNow } from 'date-fns';
import { useFeatureToggles } from '../hooks/useFeatureToggles';

export default function Zaidi() {
  const logout = useStore(state => state.logout);
  const user = useStore(state => state.user);
  const showAlert = useStore(state => state.showAlert);
  const language = useStore(state => state.language);
  const setLanguage = useStore(state => state.setLanguage);
  const t = useStore(state => state.t);
  const navigate = useNavigate();
  const { isFeatureEnabled } = useFeatureToggles();
  const canManageExpenses = isFeatureEnabled('staff_expense_management');
  
  const [shopSettings, setShopSettings] = useState<any>(null);
  const [license, setLicense] = useState<any>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isShopModalOpen, setIsShopModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  const settings = useLiveQuery(() => db.settings.get(1));
  const lastSync = settings?.lastSync;

  useEffect(() => {
    if (user?.shop_id) {
      db.shops.get(user.shop_id).then(data => setShopSettings(data));
      
      // Fetch license from Supabase
      supabase
        .from('licenses')
        .select('*')
        .eq('shop_id', user.shop_id)
        .single()
        .then(({ data }) => {
          if (data) setLicense(data);
        });
    }
  }, [user?.shop_id]);

  const getTrialDaysLeft = () => {
    if (!license?.expiry_date) return null;
    const expiry = new Date(license.expiry_date);
    const now = new Date();
    const diff = expiry.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    logout();
  };

  const handleSync = async () => {
    setIsManualSyncing(true);
    try {
      await SyncService.sync(true);
      showAlert(t('success'), t('successSync'));
    } catch (e) {
      showAlert(t('error'), t('errorSync'));
    } finally {
      setIsManualSyncing(false);
    }
  };

  const handleResetSync = () => {
    SyncService.resetSync();
    LicenseService.resetSync();
    setIsManualSyncing(false);
    showAlert(t('success'), t('resetSyncSuccess'));
  };

  const toggleExpiry = async () => {
    if (!user?.shop_id || !shopSettings) return;
    try {
      const newValue = !shopSettings.enable_expiry;
      await db.shops.update(user.shop_id, { 
        enable_expiry: newValue,
        synced: 0,
        updated_at: new Date().toISOString()
      });
      setShopSettings({ ...shopSettings, enable_expiry: newValue });
      SyncService.sync(true).catch(console.error);
      showAlert(t('success'), newValue ? t('expiryEnabled') : t('expiryDisabled'));
    } catch (e) {
      showAlert(t('error'), t('error'));
    }
  };

  const toggleLanguage = () => {
    setLanguage(language === 'sw' ? 'en' : 'sw');
  };

  const menuItems = [
    { 
      icon: AlertTriangle, 
      label: t('expiryFeatures'), 
      desc: t('expiryFeaturesDesc'), 
      action: toggleExpiry,
      isToggle: true,
      enabled: shopSettings?.enable_expiry
    },
    { 
      icon: RefreshCw, 
      label: t('syncData'), 
      desc: lastSync ? `${t('lastSync')}: ${formatDistanceToNow(lastSync, { addSuffix: true })}` : t('syncDataDesc'), 
      action: handleSync, 
      loading: isManualSyncing 
    },
    { icon: RefreshCw, label: t('resetSync'), desc: t('resetSyncDesc'), action: handleResetSync },
    { icon: User, label: t('userProfile'), desc: t('userProfileDesc'), path: '#' },
    { icon: CreditCard, label: t('paymentsLicense'), desc: t('paymentsLicenseDesc'), path: '#' },
    { 
      icon: Globe, 
      label: t('language'), 
      desc: language === 'sw' ? 'Kiswahili' : 'English', 
      action: toggleLanguage 
    },
    { icon: HelpCircle, label: t('help'), desc: t('helpDesc'), path: '#' },
  ];

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{t('settings')}</h1>
          <p className="text-slate-500 mt-1 text-sm md:text-base">{t('userProfileDesc')}</p>
        </div>
        <button 
          onClick={handleLogout} 
          className="w-full md:w-auto bg-rose-50 text-rose-600 px-6 py-3 rounded-xl font-bold flex items-center justify-center hover:bg-rose-100 transition-colors border border-rose-100"
        >
          <LogOut className="w-5 h-5 mr-2" /> {t('logout')}
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        {/* Profile Card */}
        <div className="lg:col-span-1 space-y-4 md:space-y-6">
          <div className="bg-white p-6 md:p-8 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm text-center">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl md:text-3xl font-bold">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <h2 className="text-lg md:text-xl font-bold text-slate-900">{user?.name}</h2>
            <p className="text-slate-500 text-xs md:text-sm">{user?.email}</p>
            
            {license && (
              <div className={`mt-4 inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                license.status === 'trial' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
              }`}>
                {license.status === 'trial' ? `${t('freeTrial')}: ${getTrialDaysLeft()} ${t('daysRemaining')}` : t('paidAccount')}
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-slate-100 flex justify-center space-x-4">
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase">{t('role')}</p>
                <p className="text-xs md:text-sm font-bold text-slate-700 capitalize">{user?.role || 'Admin'}</p>
              </div>
              <div className="w-px h-8 bg-slate-100"></div>
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase">{t('status')}</p>
                <div className="flex items-center text-emerald-600 text-xs md:text-sm font-bold">
                  <ShieldCheck className="w-3 h-3 mr-1" /> {t('active')}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 text-white p-6 md:p-8 rounded-2xl md:rounded-3xl shadow-xl">
            <h3 className="text-base md:text-lg font-bold mb-3 md:mb-4">{t('customerService')}</h3>
            <p className="text-slate-400 text-xs md:text-sm mb-6 leading-relaxed">
              {t('customerServiceDesc')}
            </p>
            <a 
              href="tel:0787979273" 
              className="flex items-center justify-center space-x-3 bg-blue-600 hover:bg-blue-700 text-white py-3 md:py-4 rounded-xl md:rounded-2xl font-bold transition-all shadow-lg shadow-blue-600/20"
            >
              <Phone className="w-4 h-4 md:w-5 md:h-5" />
              <span className="text-sm md:text-base">0787979273</span>
            </a>
          </div>
        </div>

        {/* Menu Items */}
        <div className="lg:col-span-2 bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 md:p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="font-bold text-slate-900 text-sm md:text-base">{t('settings')}</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {menuItems.map((item, idx) => (
              <button 
                key={idx}
                disabled={(item as any).loading}
                onClick={() => {
                  if (item.action) item.action();
                  else if (item.path && item.path !== '#') navigate(item.path);
                }}
                className={`w-full flex items-center p-4 md:p-6 hover:bg-slate-50 transition-colors group text-left ${(item as any).loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="w-10 h-10 md:w-12 md:h-12 bg-slate-100 rounded-lg md:rounded-xl flex items-center justify-center mr-4 md:mr-6 group-hover:bg-blue-50 transition-colors">
                  <item.icon className={`w-5 h-5 md:w-6 md:h-6 text-slate-500 group-hover:text-blue-600 transition-colors ${(item as any).loading ? 'animate-spin' : ''}`} />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-slate-900 text-sm md:text-base">{item.label}</h4>
                  <p className="text-[10px] md:text-sm text-slate-500">{item.desc}</p>
                </div>
                {(item as any).isToggle ? (
                  <div className={`w-12 h-6 rounded-full transition-all relative ${(item as any).enabled ? 'bg-blue-600' : 'bg-slate-200'}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${(item as any).enabled ? 'left-7' : 'left-1'}`} />
                  </div>
                ) : (
                  <ChevronRight className="w-4 h-4 md:w-5 md:h-5 text-slate-300 group-hover:text-slate-900 transition-colors" />
                )}
              </button>
            ))}
          </div>
          <div className="p-6 md:p-8 bg-slate-50 text-center">
            <p className="text-[10px] text-slate-400 font-medium">Venics Sales Mobile Edition • {t('version')} 2.0.0</p>
            <p className="text-[10px] text-slate-300 mt-1">© 2026 Venics Sales. {t('rights')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}


