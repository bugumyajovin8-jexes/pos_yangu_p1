import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Store, Loader2, LogOut } from 'lucide-react';
import { supabase } from '../supabase';
import { SyncService } from '../services/sync';

export default function SetupShop() {
  const { user, setAuth, token, logout } = useStore();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || !token) return;

    let intervalId: NodeJS.Timeout;
    let isChecking = false;

    const checkInvitation = async () => {
      if (isChecking) return;
      isChecking = true;
      setError('');

      try {
        // 1. Check for invitation
        const { data: invitations, error: inviteError } = await supabase
          .from('shop_invitations')
          .select('*')
          .eq('email', user.email)
          .limit(1);

        if (inviteError) {
          console.error('Error checking invitations:', inviteError);
          return;
        }

        if (invitations && invitations.length > 0) {
          const invite = invitations[0];
          
          // 2. Update user profile with shop_id and role
          const { error: updateError } = await supabase
            .from('users')
            .update({
              shop_id: invite.shop_id,
              role: invite.role,
              updated_at: new Date().toISOString()
            })
            .eq('id', user.id);

          if (updateError) {
            throw new Error('Imeshindwa kusasisha taarifa zako. Tafadhali jaribu tena.');
          }

          // 3. Delete the invitation
          await supabase
            .from('shop_invitations')
            .delete()
            .eq('id', invite.id);

          // 4. Update local state
          const updatedUser = {
            ...user,
            shop_id: invite.shop_id,
            shopId: invite.shop_id,
            role: invite.role as any,
            isActive: true,
            status: 'active' as const
          };

          setAuth(token, updatedUser);
          
          // 5. Initial sync
          SyncService.sync().catch(console.error);
          
          // 6. Redirect to dashboard
          navigate('/');
        }
      } catch (err: any) {
        console.error('Invitation check error:', err);
        setError(err.message || 'Kuna tatizo limetokea wakati wa kukagua mwaliko.');
      } finally {
        isChecking = false;
      }
    };

    // Check immediately on mount
    checkInvitation();

    // Then check every 30 seconds
    intervalId = setInterval(checkInvitation, 30000);

    return () => {
      clearInterval(intervalId);
    };
  }, [user, token, navigate, setAuth]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    logout();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md text-center border border-gray-100">
        <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 relative">
          <Store className="w-10 h-10" />
          <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-1 shadow-sm">
            <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          </div>
        </div>
        
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Nasubiri Mwaliko</h1>
        <p className="text-gray-500 mb-6 leading-relaxed">
          Akaunti yako imetengenezwa kikamilifu. Tafadhali mwambie Bosi wako akutumie mwaliko kupitia barua pepe yako: <br/>
          <strong className="text-gray-800 mt-2 inline-block">{user?.email}</strong>
        </p>

        <div className="bg-blue-50 text-blue-700 p-4 rounded-2xl text-sm mb-8 flex items-start text-left">
          <Loader2 className="w-5 h-5 animate-spin mr-3 flex-shrink-0 mt-0.5" />
          <p>
            Mfumo unakagua mwaliko wako kila baada ya sekunde 30. Utaingia kwenye duka moja kwa moja mwaliko utakapopatikana.
          </p>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm mb-6">
            {error}
          </div>
        )}

        <button 
          onClick={handleLogout}
          className="w-full bg-white border-2 border-gray-200 text-gray-700 font-bold py-4 rounded-2xl hover:bg-gray-50 hover:border-gray-300 transition-all flex items-center justify-center gap-2"
        >
          <LogOut className="w-5 h-5" />
          Ondoka
        </button>
      </div>
    </div>
  );
}
