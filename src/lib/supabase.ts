import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const effectiveUrl = supabaseUrl && supabaseUrl.startsWith('http') ? supabaseUrl : 'https://placeholder.supabase.co';
const effectiveKey = supabaseAnonKey || 'placeholder';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Running in offline mode (Dexie).');
}

let supabaseClient;
try {
  supabaseClient = createClient(effectiveUrl, effectiveKey);
} catch (error) {
  console.error('Failed to initialize Supabase client:', error);
  supabaseClient = new Proxy({}, {
    get: () => () => ({ data: null, error: new Error('Supabase not initialized') })
  }) as any;
}

export const supabase = supabaseClient;

