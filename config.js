// =====================================================================
// Arcane Lead Solutions — app-site config
// Points at the Arcane Supabase project (cdctxwbkpjdkytwstvoq).
// Auth is Clerk (third-party auth); the anon key is public by design and
// RLS protects the data. NEVER put the service_role key here.
// =====================================================================
window.APP_CONFIG = {
  // portal mode for this deploy: "agent" (app.) | "admin" (admin.) | "dev" (dev.) | "tv" (tv.)
  // one codebase, deployed per subdomain with a different MODE. Locally override with ?mode=…
  MODE: "agent",
  SUPABASE_URL: "https://cdctxwbkpjdkytwstvoq.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkY3R4d2JrcGpka3l0d3N0dm9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NDExMjgsImV4cCI6MjA5ODQxNzEyOH0.va493TeFtkQzBddGH4l1rJDMrmSrTO0g4Vpxd6L8XsM"
};
