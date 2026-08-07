/**
 * Same Supabase project as the Android app (anon key is public client config).
 * Leave URL/anon blank to disable the license gate for local offline testing.
 *
 * CATALOG_PUBLISH_KEY: full catalog publish (Estimate → Publish full catalog).
 * Leave as-is if already set in Supabase — do not overwrite for phone rules.
 *
 * SURVEY_RULES_PUBLISH_KEY: phone structure combinations only
 * (Desktop → Rates → Phone rules → Publish to app). Separate from catalog key.
 * Or leave blank to be prompted. Do not commit a real secret here.
 *
 * PHONE_APK_URL / PHONE_APK_DRIVE_URL: desk APK download (see docs/PHONE_APK_GITHUB_RELEASE.md).
 */
window.SLM_LICENSE_CONFIG = {
  SUPABASE_URL: "https://wkunyvomogeazjwtenck.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrdW55dm9tb2dlYXpqd3RlbmNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MDIwMDgsImV4cCI6MjA4MTA3ODAwOH0.iY8BjqhUn8rvOwul9a0625LQ_TGmauth5Ltml5mTcR0",
  CATALOG_PUBLISH_KEY: "",
  SURVEY_RULES_PUBLISH_KEY: "",
  PHONE_APK_URL: "",
  PHONE_APK_DRIVE_URL:
    "https://drive.google.com/file/d/16zdX8FruxR9ufo3tcLhyMGVbJ47jIcm1/view?usp=sharing",
};
