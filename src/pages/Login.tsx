import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { Lock, Mail, Store, Eye, EyeOff } from 'lucide-react';
import { SyncService } from '../services/sync';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

export default function Login() {
  const setAuth = useStore(state => state.setAuth);
  const authError = useStore(state => state.authError);
  const setAuthError = useStore(state => state.setAuthError);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (authError) {
      setError(authError);
      setAuthError(null);
    }
  }, [authError, setAuthError]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        if (authError.message.includes('Email not confirmed')) {
          throw new Error('Barua pepe yako bado haijathibitishwa. Tafadhali angalia email yako na ubonyeze link ya kuthibitisha kabla ya kuingia.');
        }
        if (authError.message.includes('Invalid login credentials')) {
          throw new Error('Barua pepe au nenosiri si sahihi. Tafadhali jaribu tena.');
        }
        throw authError;
      }
      
      if (!authData.user) throw new Error('Kushindwa kuingia: Mtumiaji hakupatikana.');

      // Fetch user profile and shop status
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*, shop:shops!users_shop_id_fkey(status)')
        .eq('id', authData.user.id)
        .single();

      if (userError || !userData) {
        console.error('User profile missing. Please ensure the server-side trigger is configured.');
        throw new Error('Akaunti yako haijakamilika. Tafadhali wasiliana na msimamizi.');
      }

      // If user profile exists but shop_id is missing, try to recover it
      if (!userData.shop_id) {
        const { data: existingShops } = await supabase
          .from('shops')
          .select('id')
          .eq('created_by', authData.user.id)
          .limit(1);

        if (existingShops?.[0]?.id) {
          userData.shop_id = existingShops[0].id;
          // Update the profile in Supabase so it's fixed for next time
          await supabase.from('users').update({ shop_id: userData.shop_id }).eq('id', userData.id);
        }
      }

      const isShopBlocked = userData.shop_id ? (userData.shop as any)?.status === 'blocked' : false;

      if (userData.status !== 'active' || isShopBlocked) {
        await supabase.auth.signOut();
        throw new Error('Akaunti yako imezuiwa (Blocked). Tafadhali wasiliana na msimamizi wako ili kufunguliwa.');
      }

      // Redirect boss users
      if (userData.role === 'boss' || userData.role === 'admin' || userData.role === 'owner') {
        await supabase.auth.signOut();
        throw new Error('Hii ni App ya Wafanyakazi pekee. Tafadhali tumia App ya Bosi kusimamia biashara yako.');
      }

      const token = authData.session?.access_token || '';

      setAuth(token, {
        id: userData.id,
        email: authData.user.email || email,
        name: userData.name,
        role: userData.role,
        shop_id: userData.shop_id,
        shopId: userData.shop_id,
        status: userData.status,
        isActive: true,
        created_at: userData.created_at,
        updated_at: userData.updated_at,
        isDeleted: 0,
        synced: 1
      });

      SyncService.sync().catch(err => console.error('Login sync failed:', err));
      navigate('/');

    } catch (err: any) {
      console.error('Login error details:', err);
      setError(err.message || 'Kuna tatizo limetokea wakati wa kuingia');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">

      <div className="bg-white p-8 rounded-3xl shadow-lg w-full max-w-sm text-center">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Lock className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Karibu</h1>
        <p className="text-gray-500 mb-8">Ingiza barua pepe na nenosiri kuendelea</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Barua pepe (Email)"
              required
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              className="w-full pl-12 pr-12 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Nenosiri (Password)"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

          <button
            type="submit"
            disabled={!email || !password || loading}
            className="w-full bg-blue-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl shadow-md transition-colors mt-4"
          >
            {loading ? 'Inaingia...' : 'Ingia'}
          </button>
        </form>

        <div className="mt-6 text-sm text-gray-600">
          Hauna akaunti?{' '}
          <Link to="/register" className="text-blue-600 font-bold hover:underline">
            Tengeneza hapa
          </Link>
        </div>
      </div>

      {/* ✅ ADDED FOOTER TEXT HERE */}
      <p className="mt-6 text-xs text-gray-500 text-center">
        Made by Venics Software Company
      </p>

    </div>
  );
}