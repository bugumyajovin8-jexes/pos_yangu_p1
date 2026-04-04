import { useEffect, useState } from 'react';
import { LicenseService, LicenseStatus } from '../services/license';
import { AlertTriangle, Wifi, Lock, CalendarX } from 'lucide-react';
import { useStore } from '../store';

export default function LicenseGuard({ children }: { children: React.ReactNode }) {
  const user = useStore(state => state.user);
  const [status, setStatus] = useState<LicenseStatus>('VALID');
  const [daysRemaining, setDaysRemaining] = useState<number>(14);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const check = async (forceSync = false) => {
    try {
      if (forceSync) setSyncing(true);
      
      // 1. First check local status to unblock UI immediately
      const res = await LicenseService.checkStatus();
      setStatus(res.status);
      setDaysRemaining(res.daysRemaining);
      
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

  if (loading) return <div className="h-screen bg-gray-50 flex items-center justify-center">Inapakia...</div>;

  if (status !== 'VALID') {
    let icon = <Lock className="w-16 h-16 text-red-500 mb-4" />;
    let title = 'Akaunti Imefungwa';
    let message = 'Tafadhali wasiliana na msimamizi wako. 0787979273';

    if (status === 'EXPIRED') {
      icon = <CalendarX className="w-16 h-16 text-red-500 mb-4" />;
      title = 'Leseni Imeisha';
      message = 'Muda wa matumizi ya mfumo umeisha. Piga 0787979273 kuongeza muda.';
    } else if (status === 'SYNC_REQUIRED') {
      icon = <Wifi className="w-16 h-16 text-orange-500 mb-4" />;
      title = 'Unganisha Mtandao';
      message = 'Mfumo unahitaji mtandao kuhakiki leseni. Tafadhali washa data au WiFi.';
    } else if (status === 'DATE_MANIPULATED' || status === 'TAMPERED') {
      icon = <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />;
      title = status === 'TAMPERED' ? 'Hitilafu ya Usalama' : 'Tarehe Sio Sahihi';
      message = status === 'TAMPERED' 
        ? 'Data za leseni zimebadilishwa kinyume cha sheria. Tafadhali wasiliana na msimamizi.'
        : 'Tafadhali rekebisha tarehe na saa ya simu yako iwe sahihi.';
    }

    return (
      <div className="h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        {icon}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-600 mb-8 leading-relaxed">{message}</p>
        
        <button 
          onClick={() => check(true)}
          disabled={syncing}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-8 py-3 rounded-xl font-bold transition-colors flex items-center gap-2"
        >
          <Wifi className={`w-5 h-5 ${syncing ? 'animate-pulse' : ''}`} />
          {syncing ? 'Inahakiki...' : 'Hakiki Leseni Sasa'}
        </button>
      </div>
    );
  }

  return (
    <>
      {daysRemaining <= 5 && (
        <div className="bg-orange-500 text-white text-xs font-bold text-center py-1.5 px-4 z-50 relative shadow-sm">
          Siku {daysRemaining} zimebaki kabla ya leseni kuisha. Piga 0787979273 kupata leseni mapema.
        </div>
      )}
      {children}
    </>
  );
}
