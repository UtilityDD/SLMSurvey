/**
 * Same Supabase project as the Android app (anon key is public client config).
 * Leave URL/anon blank to disable the license gate for local offline testing.
 *
 * CATALOG_PUBLISH_KEY: set to the same value as Supabase secret CATALOG_PUBLISH_KEY
 * (or leave blank to be prompted / read from supabase/.catalog_publish_key.local).
 * Never put the service-role key here.
 *
 * PHONE_APK_URL: preferred direct download URL (GitHub Release asset, Supabase Storage,
 * CDN, etc.). Use this for a true one-click APK download — Google Drive cannot do that
 * for large executables (virus-scan “Download anyway” wall).
 * Setup guide: docs/PHONE_APK_GITHUB_RELEASE.md
 *
 * PHONE_APK_DRIVE_URL: fallback Google Drive share/view link. Desk opens Drive’s download
 * page; the user must click “Download anyway”. Leave both blank to hide the button.
 */
window.SLM_LICENSE_CONFIG = {
  SUPABASE_URL: "https://wkunyvomogeazjwtenck.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrdW55dm9tb2dlYXpqd3RlbmNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MDIwMDgsImV4cCI6MjA4MTA3ODAwOH0.iY8BjqhUn8rvOwul9a0625LQ_TGmauth5Ltml5mTcR0",
  CATALOG_PUBLISH_KEY: "",
  PHONE_APK_URL: "",
  PHONE_APK_DRIVE_URL:
    "https://drive.google.com/file/d/16zdX8FruxR9ufo3tcLhyMGVbJ47jIcm1/view?usp=sharing",
};
