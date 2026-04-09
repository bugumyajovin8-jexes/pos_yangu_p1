import { useEffect, useState } from 'react';
import { LicenseService, LicenseStatus } from '../services/license';
import { AlertTriangle, Wifi, Lock, CalendarX, RefreshCw } from 'lucide-react';
import { useStore } from '../store';

export default function LicenseGuard({ children }: { children: React.ReactNode }) {
  const user = useStore(state => state.user);
  const [status, setStatus] = useState<LicenseStatus>('VALID');
  const [daysRemaining, setDaysRemaining] = useState<number>(14);
  const [expiryDate, setExpiryDate] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const check = async (forceSync = false) => {
    try {
      if (forceSync) setSyncing(true);
      
      // 1. First check local status to unblock UI immediately
      const res = await LicenseService.checkStatus();
      setStatus(res.status);
      setDaysRemaining(res.daysRemaining);
      setExpiryDate(res.expiryDate);
      
      // If we are already valid, we can stop loading early
      if (res.status === 'VALID' && !forceSync) {
        setLoading(false);
      }
      
      // 2. Then sync with server in background if online
      if (navigator.onLine) {
        try {
          await LicenseService.syncLicense();
          // Re-check after sync to update status if it changed on server
          const afterSync = await LicenseService.checkStatus();
          setStatus(afterSync.status);
          setDaysRemaining(afterSync.daysRemaining);
          setExpiryDate(afterSync.expiryDate);
        } catch (err: any) {
          // Ignore lock contention errors as they are handled by the service's internal retry/silence logic
          if (!err.message?.includes('AbortError') && !err.message?.includes('Lock broken')) {
            console.error('Background license sync failed:', err);
          }
        }
      }
    } catch (e: any) {
      if (!e.message?.includes('AbortError') && !e.message?.includes('Lock broken')) {
        console.error('License check failed:', e);
      }
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  useEffect(() => {
    // Add a small delay on mount to avoid contention with other auth-related calls
    const timeoutId = setTimeout(() => check(), 1000);
    
    // Check every 1 minute
    const interval = setInterval(() => check(), 1 * 60 * 1000);
    
    // Listen for real-time license updates
    const handleLicenseUpdate = () => {
      console.log('LicenseGuard: Re-checking status due to real-time update');
      check();
    };
    window.addEventListener('license-updated', handleLicenseUpdate);
    
    // Check when app becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(interval);
      window.removeEventListener('license-updated', handleLicenseUpdate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user]);

  if (loading) return <div className="h-screen bg-gray-50 flex items-center justify-center">{useStore.getState().t('loading')}</div>;

  if (status !== 'VALID') {
    const t = useStore.getState().t;
    let icon = <Lock className="w-16 h-16 text-red-500 mb-4" />;
    let title = t('accountLocked');
    let message = t('contactAdmin').replace('{phone}', '0787979273');
    let reason = '';

    if (status === 'EXPIRED') {
      icon = <CalendarX className="w-16 h-16 text-red-500 mb-4" />;
      title = t('licenseExpired');
      message = t('licenseExpiredDesc').replace('{phone}', '0787979273');
    } else if (status === 'SYNC_REQUIRED') {
      icon = <Wifi className="w-16 h-16 text-orange-500 mb-4" />;
      title = daysRemaining === 0 ? t('verifyingLicense') : t('connectInternet');
      message = daysRemaining === 0 
        ? t('licenseSyncRequiredDesc')
        : t('licenseSyncRequiredDescShort');
    } else if (status === 'DATE_MANIPULATED' || status === 'TAMPERED') {
      icon = <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />;
      title = status === 'TAMPERED' ? t('securityError') : t('invalidDate');
      message = status === 'TAMPERED' 
        ? t('tamperedDataDesc')
        : t('fixDateDesc');
    } else if (status === 'BLOCKED') {
      reason = expiryDate === -1 ? 'No license record found on server' : 'Shop status is blocked';
    } else if (status === 'SYNC_REQUIRED') {
      reason = 'License synchronization required';
    }

    return (
      <div className="h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        {icon}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-600 mb-4 leading-relaxed">{message}</p>
        
        <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-8 max-w-sm w-full text-left">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Debug Information</p>
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-slate-500">Shop ID:</p>
              <p className="text-xs font-mono text-slate-700 break-all">{user?.shop_id || user?.shopId || 'Not found'}</p>
            </div>
            {reason && (
              <div>
                <p className="text-[10px] text-slate-500">Reason:</p>
                <p className="text-xs font-medium text-red-600">{reason}</p>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <button 
            onClick={() => check(true)}
            disabled={syncing}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-8 py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
          >
            <Wifi className={`w-5 h-5 ${syncing ? 'animate-pulse' : ''}`} />
            {syncing ? t('verifying') : t('verifyLicenseNow')}
          </button>

          <button 
            onClick={() => {
              LicenseService.resetSync();
              check(true);
            }}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 px-8 py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            {t('resetSync')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {daysRemaining <= 5 && (
        <div className="bg-orange-500 text-white text-xs font-bold text-center py-1.5 px-4 z-50 relative shadow-sm">
          {useStore.getState().t('licenseDaysRemaining').replace('{days}', daysRemaining.toString()).replace('{phone}', '0787979273')}
        </div>
      )}
      {children}
    </>
  );
}
