const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
let supabaseAdmin = null;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    console.log('[db] Supabase client initialized:', supabaseUrl);
  } catch (err) {
    console.error('[db] Failed to initialize Supabase client:', err.message);
  }
} else {
  console.log('[db] SUPABASE_URL or SUPABASE_KEY missing. Running in JSON file fallback mode.');
}

// Separate admin client (service-role) used ONLY for Storage uploads.
// Bypasses RLS so the server can write to buckets without a user JWT.
// Must never be exposed to the browser.
if (supabaseUrl && supabaseServiceKey) {
  try {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[db] Supabase admin (service-role) client initialized for Storage.');
  } catch (err) {
    console.error('[db] Failed to initialize Supabase admin client:', err.message);
  }
} else {
  console.log('[db] SUPABASE_SERVICE_ROLE_KEY missing — Storage uploads will fall back to local disk.');
}

module.exports = {
  supabase,
  supabaseAdmin,
  isSupabaseActive: () => !!supabase,
  isSupabaseAdminActive: () => !!supabaseAdmin,
};
