import { useState } from 'react';
import { useStore } from '../store';
import { Lock, Mail, Store, Eye, EyeOff, User } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

export default function Register() {
  const t = useStore(state => state.t);
  const setAuth = useStore(state => state.setAuth);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch'));
      setLoading(false);
      return;
    }

    try {
      // 1. Sign up with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) {
        if (authError.message.includes('already registered')) {
          throw new Error(t('emailAlreadyRegistered'));
        }
        throw authError;
      }
      if (!authData.user) throw new Error(t('registrationFailed'));

      // Check if session exists (Supabase might require email confirmation)
      if (!authData.session) {
        setSuccess(t('registrationSuccess'));
        setLoading(false);
        return;
      }

      const token = authData.session.access_token;

      // 2. Create user profile in 'users' table
      const { error: profileError } = await supabase
        .from('users')
        .upsert({
          id: authData.user.id,
          email: authData.user.email || email,
          name: name || email.split('@')[0],
          role: 'employee',
          status: 'active'
        });

      if (profileError) {
        console.error('Profile creation error:', profileError);
      }

      // Local user without shop_id initially
      const localUser = {
        id: authData.user.id,
        email: authData.user.email || email,
        name: name || email.split('@')[0],
        role: 'employee' as const,
        shop_id: undefined,
        status: 'active' as const,
        isActive: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        isDeleted: 0,
        synced: 1
      };

      setAuth(token, localUser);
      navigate('/');
      
    } catch (err: any) {
      console.error('Registration error details:', err);
      setError(err.message || t('registrationError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-lg w-full max-w-sm text-center">
        <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 overflow-hidden">
          <img src="/logo.png" alt="Venics Sales" className="w-full h-full object-cover" onError={(e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.nextElementSibling?.classList.remove('hidden');
          }} />
          <Store className="w-10 h-10 hidden" />
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Venics Sales</h1>
        <p className="text-gray-500 mb-8">{t('registerAccount')}</p>
        
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type="text" 
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder={t('fullName')}
              required
            />
          </div>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type="email" 
              value={email}
              onChange={e => { setEmail(e.target.value); setError(''); }}
              className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder={t('email')}
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
              placeholder={t('password')}
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
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input 
              type={showConfirmPassword ? "text" : "password"} 
              value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
              className="w-full pl-12 pr-12 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder={t('confirmPassword')}
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
          {success && <p className="text-green-600 text-sm mt-2 bg-green-50 p-3 rounded-xl border border-green-200">{success}</p>}
          
          <button 
            type="submit" 
            disabled={!name || !email || !password || !confirmPassword || loading}
            className="w-full bg-blue-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl shadow-md transition-colors mt-4"
          >
            {loading ? t('signingUp') : t('registerButton')}
          </button>
          
          <p className="mt-4 text-xs text-gray-500">
            {t('agreeTo')}{' '}
            <a href="https://legal-peach-five.vercel.app" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              {t('termsOfService')}
            </a>{' '}
            {t('and')}{' '}
            <a href="https://legal-peach-five.vercel.app" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              {t('privacyPolicy')}
            </a>
          </p>
        </form>

        <div className="mt-6 text-sm text-gray-600">
          {t('alreadyHaveAccount')}{' '}
          <Link to="/" className="text-blue-600 font-bold hover:underline">
            {t('loginHere')}
          </Link>
        </div>
      </div>
    </div>
  );
}
