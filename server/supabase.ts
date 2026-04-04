import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

let supabaseInstance: any = null;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase environment variables missing in backend. Real-time sync from backend to cloud will be disabled.');
  // Create a minimal proxy to prevent crashes if methods are called
  supabaseInstance = new Proxy({}, {
    get: () => () => ({ data: null, error: new Error('Supabase not initialized') })
  });
} else {
  try {
    // Ensure URL is valid format
    const effectiveUrl = supabaseUrl.startsWith('http') ? supabaseUrl : `https://${supabaseUrl}`;
    supabaseInstance = createClient(effectiveUrl, supabaseKey);
  } catch (err) {
    console.error('Failed to initialize Supabase client in backend:', err);
    supabaseInstance = new Proxy({}, {
      get: () => () => ({ data: null, error: new Error('Supabase initialization failed') })
    });
  }
}

export const supabase = supabaseInstance;
