// The one Supabase client for the app. Only the public URL and publishable key go here —
// both are meant to ship to every browser; the database's row-level security is what actually
// protects the data (see src/config.js and supabase/migrations/).
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
