/* ------------------------------------------------------------------
 * Supabase connection (Step 3 of the setup guide).
 *
 * Paste your Project URL and your publishable key (starts with
 * sb_publishable_) — or the older "anon public" key — from
 * Supabase → Project Settings → API Keys, or the green "Connect" button.
 *
 * While these still say YOUR_..., the app runs in "this device only"
 * mode and keeps data in the browser.
 *
 * The publishable/anon key is designed to be public. NEVER paste the
 * secret / service_role key here. Your data stays private
 * because of the login + row-level security set up by schema.sql.
 * ------------------------------------------------------------------ */
window.APP_CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_PROJECT_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
};
