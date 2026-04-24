import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store';
import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import BottomNav from './components/BottomNav';
import Dashibodi from './pages/Dashibodi';
import Bidhaa from './pages/Bidhaa';
import Kikapu from './pages/Kikapu';
import Madeni from './pages/Madeni';
import Historia from './pages/Historia';
import Matumizi from './pages/Matumizi';
import Expiry from './pages/Expiry';
import Zaidi from './pages/Zaidi';
import Login from './pages/Login';
import Register from './pages/Register';
import SetupShop from './pages/SetupShop';
import LicenseGuard from './components/LicenseGuard';
import NetworkStatus from './components/NetworkStatus';
import { supabase } from './supabase';
import { Lock, Store } from 'lucide-react';
import { SyncService } from './services/sync';
import { db } from './db';

import GlobalModal from './components/GlobalModal';

export default function App() {
  const isAuthenticated = useStore(state => state.isAuthenticated);
  const user = useStore(state => state.user);
  const setAuth = useStore(state => state.setAuth);
  const logout = useStore(state => state.logout);
  const setFeatures = useStore(state => state.setFeatures);

  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  // Load features from Dexie into store on mount/auth
  useEffect(() => {
    if (isAuthenticated && user?.shop_id) {
      db.features.where('shop_id').equals(user.shop_id).toArray().then(features => {
        setFeatures(features);
      });
    }
  }, [isAuthenticated, user?.shop_id, setFeatures]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        logout();
      } else if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        try {
          const { data: userData } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .single();
            
          if (userData) {
            // If shop_id is missing, try to recover it
            if (!userData.shop_id) {
              const { data: existingShops } = await supabase
                .from('shops')
                .select('id')
                .eq('created_by', session.user.id)
                .limit(1);

              if (existingShops?.[0]?.id) {
                userData.shop_id = existingShops[0].id;
                // Update the profile in Supabase so it's fixed for next time
                await supabase.from('users').update({ shop_id: userData.shop_id }).eq('id', userData.id);
              }
            }

            const localUser = {
              id: userData.id,
              email: session.user.email || '',
              name: userData.name,
              role: userData.role as any,
              shop_id: userData.shop_id,
              shopId: userData.shop_id,
              status: userData.status,
              isActive: userData.status === 'active',
              created_at: userData.created_at,
              updated_at: userData.updated_at,
              isDeleted: 0,
              synced: 1
            };
            setAuth(session.access_token, localUser);
          }
        } catch (e) {
          console.error('Failed to fetch user profile on auth state change', e);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setAuth, logout]);

  // Periodic check for user status (blocking mechanism)
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    let isChecking = false;
    let timeoutId: NodeJS.Timeout;

    const checkStatus = async () => {
      if (isChecking || !navigator.onLine) return;
      isChecking = true;
      try {
        // Master Switch: Check both user status and shop status in one query
        const { data: userData, error } = await supabase
          .from('users')
          .select('id, status, role, shop_id, shop:shops!users_shop_id_fkey(id, status)')
          .eq('id', user.id)
          .single();

        if (error) {
          if (error.message?.includes('AbortError') || error.message?.includes('Lock broken')) return;
          throw error;
        }

        if (userData) {
          const isUserActive = userData.status === 'active';
          
          // Check shop status from the joined data
          const shopStatus = (userData.shop as any)?.status;
          const isShopBlocked = shopStatus === 'blocked';
          const isBoss = userData.role === 'boss' || userData.role === 'admin' || userData.role === 'owner';
          
          // Force logout if user is blocked OR if the entire shop is blocked OR if user is a boss
          if (!isUserActive || isShopBlocked || isBoss) {
            const t = useStore.getState().t;
            const message = isBoss 
              ? t('staffAppOnly')
              : t('accountBlockedContact').replace('{phone}', '0787979273');
            
            logout(message);
            try { await supabase.auth.signOut(); } catch (e) {}
            return;
          }

          // Sync role to prevent local privilege escalation
          if (userData.role !== user.role) {
            useStore.getState().updateUser({ role: userData.role as any });
          }
        }
      } catch (e: any) {
        if (!e.message?.includes('AbortError') && !e.message?.includes('Lock broken')) {
          console.error('Failed to check user status', e);
        }
      } finally {
        isChecking = false;
      }
    };

    // Add a small delay on mount to avoid contention with onAuthStateChange
    timeoutId = setTimeout(checkStatus, 2000);

    // Check every 20 seconds as a fallback (increased from 10s to reduce load)
    const interval = setInterval(checkStatus, 20000);

    // Subscribe to realtime changes for instant block/unblock
    const userSubscription = supabase
      .channel(`user-status-${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${user.id}` }, () => {
        checkStatus();
      })
      .subscribe();

    const shopSubscription = user.shop_id ? supabase
      .channel(`shop-status-${user.shop_id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shops', filter: `id=eq.${user.shop_id}` }, () => {
        checkStatus();
      })
      .subscribe() : null;

    return () => {
      clearTimeout(timeoutId);
      clearInterval(interval);
      supabase.removeChannel(userSubscription);
      if (shopSubscription) supabase.removeChannel(shopSubscription);
    };
  }, [isAuthenticated, user?.id, user?.shop_id]); // Reduced dependencies to avoid frequent re-runs

  useEffect(() => {
    if (isAuthenticated && user?.shop_id) {
      // Run sync with a small delay to avoid contention with other auth-related calls on mount
      const initialSyncTimeout = setTimeout(() => {
        SyncService.sync(true).catch(err => {
          if (!err.message?.includes('AbortError') && !err.message?.includes('Lock broken')) {
            console.error('Initial sync failed:', err);
          }
        });
      }, 3000);

      // Run sync every 10-15 seconds with jitter (improved from 30s)
      // Jitter prevents "thundering herd" where many users hit the server at the exact same time
      const syncInterval = setInterval(() => {
        SyncService.sync().catch(err => {
          if (!err.message?.includes('AbortError') && !err.message?.includes('Lock broken')) {
            console.error('Periodic sync failed:', err);
          }
        });
      }, 10000 + Math.random() * 5000);

      // Run sync when coming online or when tab becomes visible
      const handleSyncTrigger = () => {
        if (navigator.onLine) {
          SyncService.sync().catch(err => {
            if (!err.message?.includes('AbortError') && !err.message?.includes('Lock broken')) {
              console.error('Triggered sync failed:', err);
            }
          });
        }
      };
      
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          handleSyncTrigger();
        }
      };

      window.addEventListener('online', handleSyncTrigger);
      window.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearTimeout(initialSyncTimeout);
        clearInterval(syncInterval);
        window.removeEventListener('online', handleSyncTrigger);
        window.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [isAuthenticated, user?.shop_id]);

  if (!isAuthenticated) {
    return (
      <BrowserRouter>
        <NetworkStatus />
        <GlobalModal />
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Login />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (isAuthenticated && user?.role === 'boss') {
    const t = useStore.getState().t;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center border border-slate-200">
          <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Store className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-4">{t('adminPage')}</h1>
          <p className="text-slate-600 mb-8 leading-relaxed">
            {t('adminFeaturesMobile')}
          </p>
          <button 
            onClick={async () => {
              await supabase.auth.signOut();
              logout();
            }}
            className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 transition-all"
          >
            {t('logout')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <LicenseGuard>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </LicenseGuard>
  );
}

function AppContent() {
  const user = useStore(state => state.user);
  const needsShopSetup = !user?.shop_id;
  const logout = useStore(state => state.logout);
  const location = useLocation();
  const isKikapu = location.pathname === '/kikapu';

  return (
    <>
      <NetworkStatus />
      <GlobalModal />
      <div className="flex h-screen bg-slate-50 overflow-hidden">
        {!needsShopSetup && !isKikapu && <Sidebar />}

        <main className={`flex-1 bg-slate-50 pb-20 md:pb-0 ${isKikapu ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {!needsShopSetup && (
            <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-40 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center overflow-hidden">
                  <img src="/logo.png" alt="Venics Sales" className="w-full h-full object-cover" onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.nextElementSibling?.classList.remove('hidden');
                  }} />
                  <Store className="w-5 h-5 text-white hidden" />
                </div>
                <h1 className="font-bold text-gray-900">Venics Sales</h1>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-600">
                  {user?.name?.charAt(0) || 'U'}
                </div>
              </div>
            </header>
          )}
          <div className={`${isKikapu ? 'max-w-none' : 'max-w-7xl'} mx-auto h-full`}>
            <Routes>
              {needsShopSetup ? (
                <>
                  <Route path="/setup-shop" element={<SetupShop />} />
                  <Route path="*" element={<Navigate to="/setup-shop" replace />} />
                </>
              ) : (
                <>
                  <Route path="/" element={<Dashibodi />} />
                  <Route path="/bidhaa" element={<Bidhaa />} />
                  <Route path="/kikapu" element={<Kikapu />} />
                  <Route path="/madeni" element={<Madeni />} />
                  <Route path="/historia" element={<Historia />} />
                  <Route path="/matumizi" element={<Matumizi />} />
                  <Route path="/expiry" element={<Expiry />} />
                  <Route path="/zaidi" element={<Zaidi />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </>
              )}
            </Routes>
          </div>
        </main>
        {!needsShopSetup && !isKikapu && <BottomNav />}
      </div>
    </>
  );
}

