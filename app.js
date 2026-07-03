// =====================================================================
// Arcane Lead Solutions — new UI (shell + auth + live Dashboard)
// Standalone front-end hitting the same Supabase as the portal.
// =====================================================================
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// which portal this deploy is (one codebase, MODE per subdomain). ?mode= overrides locally.
// ?mode= (local/preview override) wins over the deploy's baked-in config.MODE
const REQ_MODE = new URLSearchParams(location.search).get("mode") || window.APP_CONFIG.MODE || "agent";
// effective mode, gated by the signed-in user's role (falls back to agent if not permitted)
function appMode() {
  if (REQ_MODE === "dev") return ME?.is_platform_admin ? "dev" : "agent";
  if (REQ_MODE === "tv") return (ME?.access_level === "admin" || ME?.is_platform_admin) ? "tv" : "agent";
  return "agent";  // agency-admin features live IN the agent app (role-gated), not a separate mode
}
function defaultRoute() { return appMode() === "dev" ? "agencies" : "dashboard"; }

let ME = null;
let TENANT = null;          // active tenant's branding + settings (white-label)
let VIEW_TENANT_ID = null;  // platform-admin "viewing as" tenant (context switch)
let ALL_TENANTS = [];       // platform admin only: all tenants, for the switcher
let DEV_MANAGING = null;    // dev console: tenant id being managed ("enter agency")
let HAS_DOWNLINE = false;   // current agent has agents below them → show the Team view
let WALLET_BAL = 0;         // current agent's wallet balance, shown in the nav
let ROUTE = "dashboard";
const $ = (s, r = document) => r.querySelector(s);
const money = n => "$" + Math.round(Number(n) || 0).toLocaleString();
const money2 = n => "$" + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = n => (Math.round(n * 10) / 10) === 100 ? "100%" : (Math.round(n * 10) / 10).toFixed(1) + "%";
const moneyK = n => { n = Number(n) || 0; return n >= 1000 ? "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "$" + Math.round(n); };
const initials = s => (s || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- count-up animation (preserves $, %, commas, decimals) ----
function countUp(el) {
  const raw = el.textContent.trim();
  const m = raw.match(/-?\d[\d,]*\.?\d*/);
  if (!m) return;
  const target = parseFloat(m[0].replace(/,/g, ""));
  if (!isFinite(target) || target === 0) return;
  const pre = raw.slice(0, m.index), suf = raw.slice(m.index + m[0].length);
  const dec = (m[0].split(".")[1] || "").length, dur = 680, t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  (function step(now) {
    const p = Math.min(1, (now - t0) / dur), v = target * ease(p);
    el.textContent = pre + Number(v.toFixed(dec)).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
    if (p < 1) requestAnimationFrame(step);
  })(performance.now());
}
// ---- skeleton loaders ----
const skelLine = (w = "100%", h = "12px", extra = "") => `<div class="skel" style="width:${w};height:${h};${extra}"></div>`;
function skelTable(n = 9) {
  return `<div class="tbl-wrap"><div style="overflow-x:auto"><table class="tbl"><tbody>${Array.from({ length: n }).map(() => `<tr>${[ "46%", "72%", "60%", "55%", "40%", "30%"].map(w => `<td>${skelLine(w, "11px")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
}
function skelCards(n = 5) {
  return `<div class="stat-grid">${Array.from({ length: n }).map(() => `<div class="stat">${skelLine("36px", "36px", "border-radius:9px;flex:none")}<div style="flex:1">${skelLine("62%", "9px", "margin-bottom:9px")}${skelLine("42%", "18px")}</div></div>`).join("")}</div>`;
}

// ---- notification center ----
function timeAgo(d) { const s = (Date.now() - d.getTime()) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago"; }
async function checkNotifDot() {
  try { const since = new Date(Date.now() - 86400000).toISOString();
    const { count } = await sb.from("lead_assignments").select("id", { count: "exact", head: true }).eq("agent_id", ME.id).gte("assigned_at", since);
    const dot = document.querySelector("#notif-dot"); if (dot && count > 0) dot.style.display = "block";
  } catch { }
}
async function toggleNotifications() {
  const ex = document.querySelector("#notif-pop"); if (ex) { ex.remove(); return; }
  const btn = document.querySelector("#notif-btn"); if (!btn) return;
  const pop = document.createElement("div"); pop.id = "notif-pop"; pop.className = "notif-pop";
  pop.innerHTML = `<div class="notif-h">Notifications</div><div class="notif-body"><div class="coming" style="padding:24px"><span class="spin"></span></div></div>`;
  btn.appendChild(pop);
  pop.addEventListener("click", e => e.stopPropagation());
  setTimeout(() => document.addEventListener("click", function h() { pop.remove(); document.removeEventListener("click", h); }), 0);
  const dot = document.querySelector("#notif-dot"); if (dot) dot.style.display = "none";
  const items = [];
  const nm = o => `${o?.first_name || ""} ${o?.last_name || ""}`.trim() || "Lead";
  try { (await sb.from("deals").select("client_name,annual_premium,sale_date,created_at").eq("agent_id", ME.id).order("created_at", { ascending: false }).limit(6)).data?.forEach(d => items.push({ t: new Date(d.created_at || d.sale_date), ic: "ti-rosette-discount-check", cl: "green", txt: `Deal logged — ${money(d.annual_premium)} AP`, sub: d.client_name || "" })); } catch { }
  try { (await sb.from("lead_appointments").select("starts_at,created_at,leads(first_name,last_name)").eq("agent_id", ME.id).order("created_at", { ascending: false }).limit(6)).data?.forEach(a => items.push({ t: new Date(a.created_at || a.starts_at), ic: "ti-calendar-event", cl: "blue", txt: `Appointment — ${nm(a.leads)}`, sub: new Date(a.starts_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })); } catch { }
  try { (await sb.from("lead_assignments").select("assigned_at,leads(first_name,last_name,state)").eq("agent_id", ME.id).order("assigned_at", { ascending: false }).limit(8)).data?.forEach(a => items.push({ t: new Date(a.assigned_at), ic: "ti-user-plus", cl: "gold", txt: `New lead — ${nm(a.leads)}`, sub: a.leads?.state || "" })); } catch { }
  items.sort((a, b) => b.t - a.t);
  const body = pop.querySelector(".notif-body");
  body.innerHTML = items.length ? items.slice(0, 14).map(i => `<div class="notif-item"><span class="notif-ic ${i.cl}"><i class="ti ${i.ic}"></i></span><div style="min-width:0"><div class="notif-txt">${esc(i.txt)}</div><div class="notif-sub">${[esc(i.sub), timeAgo(i.t)].filter(Boolean).join(" · ")}</div></div></div>`).join("") : `<div class="notif-empty">Nothing yet.</div>`;
}

// ---- toast notifications ----
function toast(msg, type = "ok") {
  let host = document.querySelector("#toast-host");
  if (!host) { host = document.createElement("div"); host.id = "toast-host"; document.body.appendChild(host); }
  const ic = type === "ok" ? "circle-check" : type === "err" ? "alert-circle" : "info-circle";
  const t = document.createElement("div"); t.className = `toast toast-${type}`;
  t.innerHTML = `<i class="ti ti-${ic}"></i><span>${esc(msg)}</span>`;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 260); }, 2600);
}
window.toast = toast;

// ---- lightweight confetti burst (no library) ----
function confetti(x, y) {
  const cv = document.createElement("canvas");
  cv.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
  cv.width = innerWidth; cv.height = innerHeight; document.body.appendChild(cv);
  const ctx = cv.getContext("2d");
  const cols = ["#c17d53", "#d9a25c", "#e3c08a", "#8f9a6b", "#c4704f", "#b78a86"];
  const N = 110, parts = Array.from({ length: N }, () => ({
    x: x ?? innerWidth / 2, y: y ?? innerHeight / 3,
    vx: (Math.cos(Math.random() * 6.28)) * (3 + Math.random() * 7),
    vy: -6 - Math.random() * 9, g: 0.28 + Math.random() * 0.15,
    s: 5 + Math.random() * 6, r: Math.random() * 6.28, vr: (Math.random() - .5) * .4,
    c: cols[(Math.random() * cols.length) | 0], life: 0,
  }));
  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach(p => { p.vy += p.g; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - p.life / 90);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore(); });
    if (++frame < 95) requestAnimationFrame(tick); else cv.remove();
  })();
}

const NAV_MAIN = [
  { id: "dashboard", icon: "ti-layout-dashboard", label: "Dashboard" },
  { id: "leads", icon: "ti-users", label: "Leads" },
  { id: "calls", icon: "ti-phone-incoming", label: "Inbound calls" },
  { id: "crm", icon: "ti-inbox", label: "CRM inbox", lock: true },
  { id: "billing", icon: "ti-receipt-2", label: "CRM billing", lock: true },
  { id: "orders", icon: "ti-shopping-cart", label: "Lead orders" },
  { id: "calendar", icon: "ti-calendar", label: "Calendar" },
  { id: "tasks", icon: "ti-checkbox", label: "Tasks" },
];
const NAV_TOOLS = [
  { id: "resources", icon: "ti-book", label: "Resources" },
  { id: "carrier", icon: "ti-building-bank", label: "Carrier info" },
  { id: "dialer", icon: "ti-phone", label: "Dialer", lock: true },
  { id: "drip", icon: "ti-droplet", label: "Drip builder", lock: true },
  { id: "import", icon: "ti-upload", label: "Import leads", lock: true },
];
const navItem = n => `<a class="nav-i${n.lock ? " lock" : ""}"${n.lock ? "" : ` data-route="${n.id}"`}><i class="ti ${n.icon}"></i>${n.label}${n.lock ? '<i class="ti ti-lock lk"></i>' : ""}</a>`;

// dev/platform-console nav (dev. subdomain) — Arcane company admin
const NAV_DEV = [
  { id: "agencies", icon: "ti-building-community", label: "Agencies" },
];
// the full sidebar nav for the current mode
function navFor(mode) {
  if (mode === "dev") {
    if (DEV_MANAGING) return `<a class="nav-i" id="dev-back"><i class="ti ti-arrow-left"></i> All agencies</a><div class="nav-sec">MANAGING</div><a class="nav-i" data-route="setup"><i class="ti ti-rocket"></i>Setup</a><a class="nav-i" data-route="agents"><i class="ti ti-users"></i>Agents</a><a class="nav-i" data-route="tenantsettings"><i class="ti ti-building"></i>Agency</a>`;
    return NAV_DEV.map(navItem).join("");
  }
  // agent app — agency-admin areas now live under Settings → Admin (not the sidebar)
  return NAV_MAIN.map(navItem).join("")
    + (HAS_DOWNLINE ? navItem({ id: "team", icon: "ti-sitemap", label: "Team" }) : "")
    + `<div class="nav-sec">TOOLS</div>` + NAV_TOOLS.map(navItem).join("");
}

// ---------------------------------------------------------------- boot (Supabase Auth)
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { await loadBrandPreview(); return showLogin(); }
  await loadMe();
}

async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email || null;
  // per-agency signup via invite code: ?invite=<CODE> lands NEW agents in that agency
  const urlInvite = new URLSearchParams(location.search).get("invite");
  if (urlInvite) localStorage.setItem("arcane_invite", urlInvite.trim());
  // invite can survive an email-confirm round-trip on a different device via auth metadata
  const inviteCode = localStorage.getItem("arcane_invite") || user?.user_metadata?.invite_code || null;
  let data = null;
  // find-or-create (or claim by email) this user's agent row
  try { data = (await sb.rpc("bootstrap_agent", { p_email: email, p_full_name: user?.user_metadata?.full_name || null, p_invite_code: inviteCode })).data; }
  catch (e) { console.warn("bootstrap_agent failed:", e?.message || e); }
  if (!data && user) { try { data = (await sb.from("agents").select("*").eq("user_id", user.id).maybeSingle()).data; } catch { } }
  ME = data || { id: user?.id, full_name: email, email };
  if (ME?.tenant_id) localStorage.removeItem("arcane_invite"); // placed — don't leak to a future signup
  VIEW_TENANT_ID = ME?.tenant_id || null;
  // Team view appears for admins (whole tenant) and anyone with a downline.
  HAS_DOWNLINE = ME?.access_level === "admin" || ME?.is_platform_admin || false;
  try { if (!HAS_DOWNLINE) HAS_DOWNLINE = (await sb.rpc("has_downline")).data === true; } catch { }
  try { const wb = (await sb.from("wallets").select("balance").eq("agent_id", ME.id).maybeSingle()).data; WALLET_BAL = wb ? +wb.balance : 0; } catch { }
  TENANT = null;
  if (ME?.tenant_id) {
    try { TENANT = (await sb.from("tenants").select("id,slug,name,brand_name,logo_url,settings,invite_code").eq("id", ME.tenant_id).maybeSingle()).data; } catch { }
  }
  // apply onboarding profile stashed during an email-confirm signup
  const _onb = localStorage.getItem("arcane_onb");
  if (_onb && ME?.id) {
    try { const o = JSON.parse(_onb); const p = {}; if (o.npn) p.npn = o.npn; if (o.states?.length) p.licensed_states = o.states; if (o.phone) { p.public_phone = o.phone; p.forward_number = o.phone; } if (Object.keys(p).length) await sb.from("agents").update(p).eq("id", ME.id); } catch { }
    localStorage.removeItem("arcane_onb");
  }
  renderApp();
  go(defaultRoute());
  // returning from Stripe checkout?
  const wp = new URLSearchParams(location.search).get("wallet");
  if (wp) {
    history.replaceState({}, "", location.pathname);
    if (wp === "success") { toast("Payment received — updating your balance…"); go("wallet"); setTimeout(() => { if (ROUTE === "wallet") loadWallet(); }, 2500); }
    else if (wp === "cancel") { toast("Payment canceled."); }
  }
}

// ---------------------------------------------------------------- login / onboarding (Supabase Auth)
let BRAND_PREVIEW = null;   // agency branding shown pre-auth (from ?tenant=)
async function loadBrandPreview() {
  const code = new URLSearchParams(location.search).get("invite") || localStorage.getItem("arcane_invite");
  if (!code) { BRAND_PREVIEW = null; return; }
  try { BRAND_PREVIEW = (await sb.rpc("resolve_invite", { p_code: code })).data?.[0] || null; } catch { BRAND_PREVIEW = null; }
}
function authBrandHTML() {
  const logo = BRAND_PREVIEW?.logo_url || "logo.svg?v=1";
  const name = BRAND_PREVIEW?.brand_name || "ARCANE";
  const sub = BRAND_PREVIEW ? "" : "LEAD SOLUTIONS";
  return `<img class="brand-x" src="${esc(logo)}" alt="${esc(name)}"><span class="brand-word">${esc(name)}${sub ? `<small>${sub}</small>` : ""}</span>`;
}

function showLogin() {
  const brand = BRAND_PREVIEW?.brand_name;
  $("#root").innerHTML = `
    <div class="auth">
      <div class="auth-l">
        <div class="brand">${authBrandHTML()}</div>
        <div class="auth-hero">
          <div class="kicker">Lead generation · Distribution · Real-time · Exclusive</div>
          <h1>Where leads go to get <span class="g">closed.</span></h1>
          <p>Premium, real-time mortgage-protection leads delivered straight to your CRM — exclusive to you, the moment they come in.</p>
          <div class="stats">
            <div><div class="v">&lt;60s</div><div class="l">Delivery</div></div>
            <div><div class="v">Exclusive</div><div class="l">One agent per lead</div></div>
            <div><div class="v">50</div><div class="l">State coverage</div></div>
          </div>
        </div>
      </div>
      <div class="auth-r">
        <form class="auth-form" id="auth-form">
          <h2>Welcome back</h2>
          <div class="sub">Sign in to ${brand ? esc(brand) : "your account"}</div>
          <div class="field"><label>Email</label><input class="in" type="email" id="au-email" autocomplete="email" placeholder="you@email.com" required></div>
          <div class="field"><label>Password</label><input class="in" type="password" id="au-pass" autocomplete="current-password" placeholder="••••••••" required></div>
          <div class="form-err" id="au-err"></div>
          <button class="btn-gold btn-block" id="au-btn" type="submit">Sign in</button>
          <div class="auth-foot">New here? <a href="#" id="to-signup" class="g">Create your account</a></div>
        </form>
      </div>
    </div>`;
  $("#auth-form").addEventListener("submit", doSignIn);
  $("#to-signup").addEventListener("click", e => { e.preventDefault(); showOnboarding(); });
}
async function doSignIn(e) {
  e.preventDefault();
  const btn = $("#au-btn"), err = $("#au-err");
  err.textContent = ""; btn.disabled = true; btn.textContent = "Signing in…";
  const { error } = await sb.auth.signInWithPassword({ email: $("#au-email").value.trim(), password: $("#au-pass").value });
  if (error) { err.textContent = error.message; btn.disabled = false; btn.textContent = "Sign in"; return; }
  boot();
}

// ---- Typeform-style onboarding ----
const ONB_STEPS = [
  { key: "welcome" },
  { key: "full_name", q: "What's your name?", type: "text", ph: "Jane Agent", req: true },
  { key: "email", q: "Your email", type: "email", ph: "you@email.com", req: true },
  { key: "password", q: "Create a password", sub: "At least 8 characters", type: "password", ph: "••••••••", req: true },
  { key: "npn", q: "Your NPN", sub: "National Producer Number — add it later if you don't have it handy", type: "text", ph: "e.g. 12345678" },
  { key: "states", q: "Which states are you licensed in?", type: "states" },
  { key: "phone", q: "Best number to reach you", sub: "We ring this for inbound calls", type: "tel", ph: "+1 254 555 0100" },
  { key: "finish" },
];
let ONB = { states: [] }, ONB_I = 0;
async function showOnboarding() {
  if (!BRAND_PREVIEW) await loadBrandPreview();
  ONB = { states: [] }; ONB_I = 0;
  renderOnbStep();
}
function renderOnbStep() {
  const step = ONB_STEPS[ONB_I], n = ONB_STEPS.length;
  const pct = Math.round(ONB_I / (n - 1) * 100);
  const brand = BRAND_PREVIEW?.brand_name || "Arcane";
  let inner = "";
  if (step.key === "welcome") {
    inner = `<div class="onb-brand">${authBrandHTML()}</div><h1 class="onb-h">Join ${esc(brand)}</h1><p class="onb-p">A few quick questions and you're in — about a minute.</p><button class="btn-gold btn-block" id="onb-start">Get started</button><div class="onb-foot" style="justify-content:center">Already have an account? <a href="#" id="onb-signin" class="g">Sign in</a></div>`;
  } else if (step.key === "finish") {
    inner = `<h1 class="onb-h">You're all set${ONB.full_name ? ", " + esc(ONB.full_name.split(" ")[0]) : ""} 🎉</h1><p class="onb-p">Create your account to jump in${BRAND_PREVIEW?.brand_name ? " to " + esc(BRAND_PREVIEW.brand_name) : ""}.</p><div class="form-err" id="onb-err"></div><button class="btn-gold btn-block" id="onb-finish">Create account</button><div class="onb-foot" style="justify-content:center"><a href="#" id="onb-back" class="g">← Back</a></div>`;
  } else if (step.type === "states") {
    inner = `<h1 class="onb-h">${step.q}</h1>${step.sub ? `<p class="onb-p">${step.sub}</p>` : ""}<div class="onb-states">${US_STATES.map(s => `<span class="pf-day ${ONB.states.includes(s) ? "on" : ""}" data-st="${s}">${s}</span>`).join("")}</div><button class="btn-gold btn-block" id="onb-next">Continue</button><div class="onb-foot"><a href="#" id="onb-back" class="g">← Back</a></div>`;
  } else {
    inner = `<h1 class="onb-h">${step.q}</h1>${step.sub ? `<p class="onb-p">${step.sub}</p>` : ""}<input class="in onb-in" id="onb-input" type="${step.type}" placeholder="${esc(step.ph || "")}" value="${esc(ONB[step.key] || "")}"><div class="form-err" id="onb-err"></div><button class="btn-gold btn-block" id="onb-next">Continue</button><div class="onb-foot"><a href="#" id="onb-back" class="g">← Back</a>${!step.req ? `<a href="#" id="onb-skip" class="g" style="margin-left:auto">Skip</a>` : ""}</div>`;
  }
  $("#root").innerHTML = `<div class="onb-wrap"><div class="onb-bar"><i style="width:${pct}%"></i></div><div class="onb-card">${inner}</div></div>`;
  $("#onb-start")?.addEventListener("click", () => { ONB_I++; renderOnbStep(); });
  $("#onb-signin")?.addEventListener("click", e => { e.preventDefault(); showLogin(); });
  $("#onb-back")?.addEventListener("click", e => { e.preventDefault(); ONB_I = Math.max(0, ONB_I - 1); renderOnbStep(); });
  $("#onb-skip")?.addEventListener("click", e => { e.preventDefault(); ONB[step.key] = null; ONB_I++; renderOnbStep(); });
  $("#onb-next")?.addEventListener("click", () => onbNext(step));
  $("#onb-finish")?.addEventListener("click", onbSubmit);
  const inp = $("#onb-input");
  if (inp) { inp.focus(); inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); onbNext(step); } }); }
  if (step.type === "states") $("#root").querySelectorAll(".pf-day[data-st]").forEach(x => x.addEventListener("click", () => x.classList.toggle("on")));
}
function onbNext(step) {
  if (step.type === "states") { ONB.states = US_STATES.filter(s => $(`.pf-day[data-st="${s}"]`)?.classList.contains("on")); ONB_I++; return renderOnbStep(); }
  const val = ($("#onb-input")?.value || "").trim();
  const err = $("#onb-err");
  if (step.req && !val) { if (err) err.textContent = "This one's required."; return; }
  if (step.key === "email" && val && !/^[^@]+@[^@]+\.[^@]+$/.test(val)) { if (err) err.textContent = "Enter a valid email."; return; }
  if (step.key === "password" && val.length < 8) { if (err) err.textContent = "At least 8 characters."; return; }
  ONB[step.key] = val; ONB_I++; renderOnbStep();
}
async function onbSubmit() {
  const btn = $("#onb-finish"), err = $("#onb-err");
  err.style.color = "var(--red)"; err.textContent = ""; btn.disabled = true; btn.textContent = "Creating…";
  const invite = (new URLSearchParams(location.search).get("invite") || localStorage.getItem("arcane_invite") || "").trim();
  if (invite) localStorage.setItem("arcane_invite", invite);
  const redir = window.location.origin + window.location.pathname + (invite ? `?invite=${encodeURIComponent(invite)}` : "");
  const { data, error } = await sb.auth.signUp({ email: ONB.email, password: ONB.password, options: { data: { full_name: ONB.full_name, invite_code: invite || null }, emailRedirectTo: redir } });
  if (error) { btn.disabled = false; btn.textContent = "Create account"; err.textContent = error.message; return; }
  if (!data.session) {
    localStorage.setItem("arcane_onb", JSON.stringify(ONB));
    err.style.color = "var(--green)"; err.textContent = "Check your email to confirm — you'll land right in.";
    btn.textContent = "Email sent ✓"; return;
  }
  await finishOnboarding();
}
async function finishOnboarding() {
  const invite = localStorage.getItem("arcane_invite") || null;
  let agent = null;
  try { agent = (await sb.rpc("bootstrap_agent", { p_email: ONB.email || null, p_full_name: ONB.full_name || null, p_invite_code: invite })).data; } catch (e) { console.warn(e); }
  if (agent?.id) {
    const patch = {};
    if (ONB.npn) patch.npn = ONB.npn;
    if (ONB.states?.length) patch.licensed_states = ONB.states;
    if (ONB.phone) { patch.public_phone = ONB.phone; patch.forward_number = ONB.phone; }
    if (Object.keys(patch).length) { try { await sb.from("agents").update(patch).eq("id", agent.id); } catch { } }
  }
  localStorage.removeItem("arcane_onb");
  boot();
}

async function signOut() { await sb.auth.signOut(); location.reload(); }

// ---- white-label branding (tenant logo + name in the header) ----
// the tenant currently being viewed/managed (platform admin can switch; everyone else = their own)
function activeTenantId() { return VIEW_TENANT_ID || ME?.tenant_id || null; }
function brandBits() {
  const name = TENANT?.brand_name || "ARCANE";
  const sub = (TENANT?.name && TENANT.name !== name) ? TENANT.name : (TENANT ? "" : "LEAD SOLUTIONS");
  const logo = TENANT?.logo_url || "logo.svg?v=1";
  return { name, sub, logo };
}
function brandHTML() {
  const b = brandBits();
  return `<img class="brand-x" src="${esc(b.logo)}" alt="${esc(b.name)}"><span class="brand-word">${esc(b.name)}${b.sub ? `<small>${esc(b.sub)}</small>` : ""}</span>`;
}
function applyBrand() { const el = document.querySelector(".side .brand"); if (el) el.innerHTML = brandHTML(); }

// dev console: drop INTO an agency's account (manage it as if you're their admin)
async function enterAgency(tid) {
  DEV_MANAGING = tid; VIEW_TENANT_ID = tid;
  try { TENANT = (await sb.from("tenants").select("id,slug,name,brand_name,logo_url,settings").eq("id", tid).maybeSingle()).data; } catch { }
  renderApp(); go("setup");
}
async function exitAgency() {
  DEV_MANAGING = null; VIEW_TENANT_ID = ME?.tenant_id || null;
  try { TENANT = ME?.tenant_id ? (await sb.from("tenants").select("id,slug,name,brand_name,logo_url,settings").eq("id", ME.tenant_id).maybeSingle()).data : null; } catch { }
  renderApp(); go("agencies");
}

// ---------------------------------------------------------------- shell
function renderApp() {
  $("#root").innerHTML = `
    <div class="app">
      <aside class="side">
        <div class="side-scroll">
          <div class="brand">${brandHTML()}</div>
          ${navFor(appMode())}
        </div>
        <div class="side-foot">
          ${appMode() === "agent" ? `<div class="av-toggle${ME.available_for_calls ? " on" : ""}" id="av-toggle">
            <span class="av-dot"></span>
            <span class="av-lbl">Available for calls</span>
            <label class="av-sw"><input type="checkbox" id="av-check" ${ME.available_for_calls ? "checked" : ""}><span class="av-track"></span></label>
          </div>
          <a class="nav-i" data-route="wallet"><i class="ti ti-wallet"></i>Wallet<span class="nav-bal" id="nav-bal">${money(WALLET_BAL)}</span></a>` : ""}
          <div class="agent-chip">
            <div class="av">${esc(initials(ME.full_name))}</div>
            <div><div class="nm">${esc((ME.full_name || "").split(" ")[0] || "Agent")}</div><div class="rl">${esc(ME.role_title || "Agent")}</div></div>
          </div>
          <a class="nav-i settings" data-route="settings"><i class="ti ti-settings"></i>Settings</a>
          <button class="signout" id="signout"><i class="ti ti-logout"></i> Sign out</button>
          <div class="ver">Arcane Lead Solutions · v0.1</div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <span class="chip">AP Today <b class="num" id="ap-today">$0</b> <span class="dim">/ <span id="ap-today-n">0</span> Closed</span></span>
          <span class="chip">AP MTD <b class="num" id="ap-mtd">$0</b> <span class="dim">/ <span id="ap-mtd-n">0</span> Closed</span></span>
          <span class="search"><i class="ti ti-search"></i>Search leads…</span>
          <span class="ic-btn notif-btn" id="notif-btn"><i class="ti ti-bell"></i><span class="notif-dot" id="notif-dot" style="display:none"></span></span>
          <span class="ic-btn cart-btn" id="cart-btn"><i class="ti ti-shopping-cart"></i><span class="cart-count" id="cart-count">0</span></span>
          <div class="ob-dd">
            <button class="btn-order" id="order-btn"><i class="ti ti-bolt"></i> Order leads <i class="ti ti-chevron-down"></i></button>
            <div class="ob-menu" id="ob-menu">
              <a data-ob="realtime"><i class="ti ti-bolt"></i> Real-time leads</a>
              <a data-ob="aged"><i class="ti ti-clock-hour-4"></i> Aged leads</a>
            </div>
          </div>
        </header>
        <div class="content" id="content"></div>
      </div>
    </div>`;
  document.querySelectorAll("[data-route]").forEach(el => el.addEventListener("click", () => go(el.dataset.route)));
  $("#signout").addEventListener("click", signOut);
  $("#av-check")?.addEventListener("change", toggleAvailability);
  $("#dev-back")?.addEventListener("click", exitAgency);
  $("#cart-btn").addEventListener("click", () => go("cart"));
  $("#notif-btn")?.addEventListener("click", e => { e.stopPropagation(); toggleNotifications(); });
  checkNotifDot();
  const obMenu = $("#ob-menu");
  $("#order-btn").addEventListener("click", e => { e.stopPropagation(); obMenu.classList.toggle("open"); });
  obMenu.querySelectorAll("[data-ob]").forEach(a => a.addEventListener("click", () => { obMenu.classList.remove("open"); go(a.dataset.ob === "aged" ? "aged" : "order"); }));
  document.addEventListener("click", () => obMenu.classList.remove("open"));
  updateCartCount();
}
function updateCartCount() { const el = $("#cart-count"); if (!el) return; el.textContent = CART.length; el.style.display = CART.length ? "flex" : "none"; }

function go(route) {
  ROUTE = route;
  closeLeadPanel();
  document.querySelectorAll(".nav-i").forEach(el => el.classList.toggle("active", el.dataset.route === route));
  const c = $("#content");
  if (route === "dashboard") return loadDashboard();
  if (route === "order") return loadOrder();
  if (route === "cart") return loadCart();
  if (route === "leads") return loadLeads();
  if (route === "calls") return loadCalls();
  if (route === "team") return loadTeam();
  if (route === "wallet") return loadWallet();
  if (route === "orders") return loadOrdersList();
  if (route === "aged") return loadAged();
  if (route === "calendar") return loadCalendar();
  if (route === "tasks") return loadTasks();
  if (route === "settings") return loadProfile();
  if (route === "agencies") return loadAgencies();
  if (route === "agents") return loadAgents();
  if (route === "setup") return loadSetup();
  if (route === "tenantsettings") { PF_TAB = "tenant"; return loadProfile(); }
  if (route === "admintiers") return loadAdminTiers();
  if (route === "catalog") return loadCatalogAdmin();
  const labels = { resources: "Resources", carrier: "Carrier info" };
  c.innerHTML = `<div class="coming"><div class="badge"><i class="ti ti-tools"></i></div><b>${labels[route] || "Page"}</b><div>Coming soon.</div></div>`;
}

// ---------------------------------------------------------------- dashboard
const COUNTABLE = new Set(["underwriting", "approved", "issued"]);
const DASH_PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["last7", "Last 7 days"], ["last30", "Last 30 days"], ["thismonth", "This month"], ["lastmonth", "Last month"]];
let DASH_RANGE = { preset: "last30", from: null, to: null, useCreated: false };
let DASH_PERF = "all", DASH_ASN = [], DASH_DEALS = [], DASH_OPENTASKS = 0, DASH_TYPENAME = {};   // Lead Performance channel toggle (all/realtime/aged) scopes the whole lead panel
function rangeFor(preset) {
  const iso = x => x.toISOString().slice(0, 10);
  const d = new Date(), today = iso(d);
  if (preset === "today") return [today, today];
  if (preset === "yesterday") { const y = new Date(); y.setDate(d.getDate() - 1); return [iso(y), iso(y)]; }
  if (preset === "last7") { const s = new Date(); s.setDate(d.getDate() - 6); return [iso(s), today]; }
  if (preset === "last30") { const s = new Date(); s.setDate(d.getDate() - 29); return [iso(s), today]; }
  if (preset === "thismonth") return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), today];
  if (preset === "lastmonth") return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))];
  return [null, null];
}
const dashRange = () => DASH_RANGE.preset === "custom" ? [DASH_RANGE.from, DASH_RANGE.to] : rangeFor(DASH_RANGE.preset);
const dashLabel = () => { const m = Object.fromEntries(DASH_PRESETS); return DASH_RANGE.preset === "custom" ? `${DASH_RANGE.from || "…"} → ${DASH_RANGE.to || "…"}` : (m[DASH_RANGE.preset] || "Date filter"); };

async function loadDashboard() {
  const c = $("#content");
  const first = esc((ME.full_name || "").split(" ")[0] || "");
  const head = `<div class="dash-head"><div><div class="page-title">Dashboard</div><div class="page-sub">Welcome back, ${first}! Here's a quick overview of your account.</div></div><div class="dash-filter-wrap"><button class="btn-ghost" id="dash-filter-btn"><i class="ti ti-calendar"></i> Date filter</button><button class="btn-ghost" id="dash-filters-btn"><i class="ti ti-filter"></i> Filters</button></div></div>`;
  c.innerHTML = head + skelCards(5) + skelCards(4);
  wireDashFilter();

  let asn = [], deals = [], openTasks = 0;
  // prefer the unified per-assignment lead_cost (realtime + aged); fall back if the column isn't deployed yet
  try { asn = (await sb.from("lead_assignments").select("lead_id,tier_at_assignment,disposition,assigned_at,source,realtime_cost,lead_cost,leads(created_at,lead_type_id,state)").eq("agent_id", ME.id)).data || []; } catch {}
  if (!asn.length) { try { asn = (await sb.from("lead_assignments").select("lead_id,tier_at_assignment,disposition,assigned_at,source,realtime_cost,leads(created_at,lead_type_id,state)").eq("agent_id", ME.id)).data || []; } catch {} }
  if (!asn.length) { try { asn = (await sb.from("lead_assignments").select("lead_id,tier_at_assignment,disposition,assigned_at,source,realtime_cost,leads(created_at)").eq("agent_id", ME.id)).data || []; } catch {} }
  try { deals = (await sb.from("deals").select("id,lead_id,annual_premium,status,sale_date").eq("agent_id", ME.id)).data || []; } catch {}
  let typeName = {};
  try { (await sb.from("lead_types").select("id,name")).data?.forEach(t => { typeName[t.id] = t.name; }); } catch {}
  DASH_ASN = asn; DASH_DEALS = deals;
  try { const tk = (await sb.from("tasks").select("status").eq("agent_id", ME.id)).data || []; openTasks = tk.filter(x => !["completed", "done", "cancelled"].includes((x.status || "").toLowerCase())).length; } catch {}
  let calls = [];
  try { calls = (await sb.from("calls").select("id,status,connected,billable,price,started_at,deal_id").eq("agent_id", ME.id).eq("direction", "inbound")).data || []; } catch { }

  // topbar AP today / MTD — always real, NOT affected by the dashboard filter
  const today = new Date().toISOString().slice(0, 10), mStart = today.slice(0, 8) + "01";
  const closedToday = deals.filter(d => COUNTABLE.has(d.status) && d.sale_date === today);
  const closedMtd = deals.filter(d => COUNTABLE.has(d.status) && d.sale_date >= mStart);
  const apToday = closedToday.reduce((s, d) => s + (+d.annual_premium || 0), 0);
  const apMtd = closedMtd.reduce((s, d) => s + (+d.annual_premium || 0), 0);
  if ($("#ap-today")) $("#ap-today").textContent = money(apToday);
  if ($("#ap-mtd")) $("#ap-mtd").textContent = money(apMtd);
  if ($("#ap-today-n")) $("#ap-today-n").textContent = closedToday.length;
  if ($("#ap-mtd-n")) $("#ap-mtd-n").textContent = closedMtd.length;

  DASH_OPENTASKS = openTasks; DASH_TYPENAME = typeName;

  // apply the dashboard date range (inbound-call sub-group is independent of the lead-channel toggle)
  const [rFrom, rTo] = dashRange();
  const inR = ds => ds && (!rFrom || ds >= rFrom) && (!rTo || ds <= rTo);

  // ---- inbound-call sub-group (same date range) ----
  const fcalls = calls.filter(cl => inR((cl.started_at || "").slice(0, 10)));
  const cReceived = fcalls.length;
  const cConnected = fcalls.filter(cl => cl.connected || cl.status === "connected" || cl.status === "completed").length;
  const cBillable = fcalls.filter(cl => cl.billable);
  const cMissed = fcalls.filter(cl => cl.status === "missed" || cl.status === "no_agent").length;
  const cSpend = cBillable.reduce((s, cl) => s + (+cl.price || 0), 0);
  const cConnRate = cReceived ? cConnected / cReceived * 100 : 0;
  const dealById = Object.fromEntries(deals.map(d => [d.id, d]));
  const cClosedDeals = fcalls.filter(cl => cl.deal_id && dealById[cl.deal_id] && COUNTABLE.has(dealById[cl.deal_id].status));
  const cDealsClosed = cClosedDeals.length;
  const cAp = cClosedDeals.reduce((s, cl) => s + (+dealById[cl.deal_id].annual_premium || 0), 0);
  const cCac = cDealsClosed ? cSpend / cDealsClosed : 0;   // cost to acquire a customer = call spend per closed deal
  const callsSection = `
    <div class="perf-top"><span class="perf-title">Inbound Calls</span></div>
    <div class="perf-note">Live inbound-call performance for the selected range.</div>
    <div class="stat-grid">
      <div class="stat"><span class="ic ic-blue"><i class="ti ti-phone-incoming"></i></span><div><div class="lab">Received</div><div class="val num">${cReceived.toLocaleString()}</div></div></div>
      <div class="stat"><span class="ic ic-green"><i class="ti ti-phone-check"></i></span><div><div class="lab">Connected</div><div class="val num">${cConnected.toLocaleString()}</div></div></div>
      <div class="stat"><span class="ic ic-amber"><i class="ti ti-coin"></i></span><div><div class="lab">Billable</div><div class="val num">${cBillable.length.toLocaleString()}</div></div></div>
      <div class="stat"><span class="ic ic-pink"><i class="ti ti-phone-off"></i></span><div><div class="lab">Missed</div><div class="val num">${cMissed.toLocaleString()}</div></div></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><span class="ic ic-blue"><i class="ti ti-percentage"></i></span><div><div class="lab">Connect rate</div><div class="val num">${pct1(cConnRate)}</div></div></div>
      <div class="stat"><span class="ic ic-amber"><i class="ti ti-receipt"></i></span><div><div class="lab">Call spend</div><div class="val num">${money(cSpend)}</div></div></div>
      <div class="stat"><span class="ic ic-pink"><i class="ti ti-target-arrow"></i></span><div><div class="lab">CAC</div><div class="val num">${money(cCac)}</div></div></div>
      <div class="stat"><span class="ic ic-green"><i class="ti ti-circle-check"></i></span><div><div class="lab">Deals closed</div><div class="val num">${cDealsClosed.toLocaleString()}</div></div></div>
      <div class="stat"><span class="ic ic-purple"><i class="ti ti-coin"></i></span><div><div class="lab">AP generated</div><div class="val num" style="color:var(--gold)">${money(cAp)}</div></div></div>
    </div>`;

  const seg = `<div class="seg" id="perf-seg">${[["all", "All"], ["realtime", "Real-Time"], ["aged", "Aged"]].map(([v, l]) => `<span data-perf="${v}" class="${DASH_PERF === v ? "on" : ""}">${l}</span>`).join("")}</div>`;
  c.innerHTML = head + `
    <div class="perf-top" style="margin-top:2px"><span class="perf-title">Lead Performance</span>${seg}</div>
    <div class="perf-note" id="perf-note">${perfNoteText()}</div>
    <div id="dash-lead">${dashLeadHTML()}</div>
    ${callsSection}`;
  wireDashFilter();
  document.querySelectorAll("#perf-seg span").forEach(s => s.addEventListener("click", () => dashSetPerf(s.dataset.perf)));
  c.querySelectorAll(".stat .val").forEach(countUp);
}

// Lead-channel toggle (All = every source, Real-Time / Aged = that source only) scopes the whole lead panel.
function dashMetrics() {
  const [rFrom, rTo] = dashRange();
  const inR = ds => ds && (!rFrom || ds >= rFrom) && (!rTo || ds <= rTo);
  let fasn = DASH_ASN.filter(a => inR(((DASH_RANGE.useCreated ? a.leads?.created_at : a.assigned_at) || "").slice(0, 10)));
  if (DASH_PERF !== "all") fasn = fasn.filter(a => a.source === DASH_PERF);
  const leadIds = new Set(fasn.map(a => a.lead_id));
  let fdeals = DASH_DEALS.filter(d => inR(d.sale_date));
  if (DASH_PERF !== "all") fdeals = fdeals.filter(d => d.lead_id && leadIds.has(d.lead_id));
  const totalLeads = fasn.length;
  const contacts = fasn.filter(a => a.disposition && a.disposition !== "new_lead").length;
  const appts = fasn.filter(a => a.disposition === "appt_booked").length;
  const closed = fdeals.filter(d => COUNTABLE.has(d.status));
  const ap = closed.reduce((s, d) => s + (Number(d.annual_premium) || 0), 0);
  // spend = per-assignment lead cost (realtime + aged), legacy realtime_cost as fallback
  const spend = fasn.reduce((s, a) => s + (Number(a.lead_cost ?? a.realtime_cost) || 0), 0);
  const cpa = closed.length ? spend / closed.length : 0;
  const roi = spend > 0 ? ((ap - spend) / spend) * 100 : 0;
  const salesPct = totalLeads ? (closed.length / totalLeads) * 100 : 0;
  const byType = {};
  fasn.forEach(a => { const t = DASH_TYPENAME[a.leads?.lead_type_id] || "Unspecified"; byType[t] = (byType[t] || 0) + 1; });
  return { totalLeads, contacts, appts, closedN: closed.length, ap, cpa, roi, salesPct, byType };
}
function dashLeadHTML() {
  const m = dashMetrics();
  const { totalLeads, contacts, appts } = m;
  const tierList = Object.entries(m.byType).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const tierTotal = tierList.reduce((s, e) => s + e[1], 0) || 1;
  const tierColors = ["#c17d53", "#d9a25c", "#b8845a", "#8f9a6b", "#a76a4a", "#c9a36a"];
  let off = 25, donut = `<circle cx="21" cy="21" r="15.9" fill="none" stroke="#2a201a" stroke-width="6"></circle>`;
  tierList.forEach(([, n], i) => { const pct = Math.round(n / tierTotal * 100); donut += `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${tierColors[i]}" stroke-width="6" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="${off}"></circle>`; off = (off - pct + 100) % 100; });
  const legend = tierList.map(([t, n], i) => `<span><i style="background:${tierColors[i]}"></i>${esc(t)} ${Math.round(n / tierTotal * 100)}%</span>`).join("") || `<span style="color:var(--tx3)">No leads in range</span>`;
  const fbar = (v, col) => `<div class="bar"><i style="width:${Math.round((v / (totalLeads || 1)) * 100)}%;background:${col}"></i></div>`;
  const frow = (lab, v, col) => `<div><div class="r"><span>${lab}</span><b class="num">${v.toLocaleString()} (${pct1(totalLeads ? v / totalLeads * 100 : 0)})</b></div>${fbar(v, col)}</div>`;
  return `
    <div class="stat-grid">
      <div class="stat"><span class="ic ic-purple"><i class="ti ti-users"></i></span><div><div class="lab">Total leads</div><div class="val num">${totalLeads.toLocaleString()}</div></div></div>
      <div class="stat"><span class="ic ic-blue"><i class="ti ti-phone"></i></span><div><div class="lab">Contacts</div><div class="val num">${contacts.toLocaleString()}</div></div></div>
      <div class="stat"><span class="ic ic-amber"><i class="ti ti-calendar-event"></i></span><div><div class="lab">Appointments</div><div class="val num">${appts.toLocaleString()}</div></div></div>
      <div class="stat"><span class="ic ic-blue"><i class="ti ti-checkbox"></i></span><div><div class="lab">Open tasks</div><div class="val num">${DASH_OPENTASKS.toLocaleString()}</div></div></div>
      <div class="stat"><span class="ic ic-green"><i class="ti ti-circle-check"></i></span><div><div class="lab">Sales</div><div class="val num">${m.closedN.toLocaleString()}</div></div></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><span class="ic ic-purple"><i class="ti ti-coin"></i></span><div><div class="lab">Annual premium</div><div class="val num" style="color:var(--gold)">${money(m.ap)}</div></div></div>
      <div class="stat"><span class="ic ic-amber"><i class="ti ti-receipt"></i></span><div><div class="lab">CPA</div><div class="val num">${money(m.cpa)}</div></div></div>
      <div class="stat"><span class="ic ic-pink"><i class="ti ti-chart-line"></i></span><div><div class="lab">ROI</div><div class="val num" style="color:${m.roi >= 0 ? "var(--green)" : "var(--red)"}">${pct1(m.roi)}</div></div></div>
      <div class="stat"><span class="ic ic-blue"><i class="ti ti-percentage"></i></span><div><div class="lab">Sales %</div><div class="val num">${pct1(m.salesPct)}</div></div></div>
    </div>
    <div class="two">
      <div class="panel"><div class="panel-h">Lead Types</div><div class="panel-b"><div class="donut-row">
        <svg viewBox="0 0 42 42" width="140" height="140" role="img" aria-label="Lead types by tier">${donut}</svg>
        <div class="legend">${legend}</div>
      </div></div></div>
      <div class="panel"><div class="panel-h">Sales Funnel</div><div class="panel-b"><div class="funnel">
        ${frow("Leads", totalLeads, "#c17d53")}
        ${frow("Contacts", contacts, "#d9a25c")}
        ${frow("Appointments", appts, "#b8845a")}
        ${frow("Sales", m.closedN, "#8f9a6b")}
      </div></div></div>
    </div>`;
}
const perfNoteText = () => DASH_PERF === "realtime" ? "Real-time leads only." : DASH_PERF === "aged" ? "Aged leads only." : "All lead sources.";
function dashSetPerf(ch) {
  DASH_PERF = ch;
  document.querySelectorAll("#perf-seg span").forEach(s => s.classList.toggle("on", s.dataset.perf === ch));
  const note = $("#perf-note"); if (note) note.textContent = perfNoteText();
  const box = $("#dash-lead"); if (box) { box.innerHTML = dashLeadHTML(); box.querySelectorAll(".stat .val").forEach(countUp); }
}

function wireDashFilter() {
  const btn = $("#dash-filter-btn");
  if (btn) btn.addEventListener("click", e => { e.stopPropagation(); toggleDashFilter(); });
  const fb = $("#dash-filters-btn");
  if (fb) fb.addEventListener("click", e => { e.stopPropagation(); toggleDashFilters(); });
}
function toggleDashFilters() {
  const open = document.querySelector("#dash-filters-pop");
  if (open) { open.remove(); return; }
  const wrap = document.querySelector(".dash-filter-wrap"); if (!wrap) return;
  const pop = document.createElement("div");
  pop.id = "dash-filters-pop"; pop.className = "dash-filter-pop"; pop.style.width = "260px";
  pop.innerHTML = `<div class="np-lab" style="margin-bottom:10px">Filters</div>
    <div class="muted2" style="font-size:12.5px;line-height:1.5">Lead type, channel, and status filters are coming with the analytics build.</div>`;
  wrap.appendChild(pop);
  pop.addEventListener("click", e => e.stopPropagation());
  const outside = ev => { if (!wrap.contains(ev.target)) { pop.remove(); document.removeEventListener("click", outside); } };
  setTimeout(() => document.addEventListener("click", outside), 0);
}
function toggleDashFilter() {
  const open = document.querySelector("#dash-filter-pop");
  if (open) { open.remove(); return; }
  const wrap = document.querySelector(".dash-filter-wrap"); if (!wrap) return;
  const [from, to] = dashRange();
  const pop = document.createElement("div");
  pop.id = "dash-filter-pop"; pop.className = "dash-filter-pop";
  pop.innerHTML = `
    <div class="dfp-presets">${DASH_PRESETS.map(([id, lab]) => `<span class="dfp-pill ${DASH_RANGE.preset === id ? "on" : ""}" data-preset="${id}">${lab}</span>`).join("")}</div>
    <div class="field"><label>From</label><input class="in" type="date" id="dfp-from" value="${from || ""}"></div>
    <div class="field"><label>To</label><input class="in" type="date" id="dfp-to" value="${to || ""}"></div>
    <label class="cbx ${DASH_RANGE.useCreated ? "on" : ""}" id="dfp-created"><span class="box"><i class="ti ti-check"></i></span>Use created date</label>
    <div style="display:flex;justify-content:space-between;margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
      <button class="btn-ghost" id="dfp-clear"><i class="ti ti-x"></i> Clear</button>
      <div style="display:flex;gap:8px"><button class="btn-ghost" id="dfp-apply">Apply</button><button class="btn-gold" id="dfp-done">Done</button></div>
    </div>`;
  wrap.appendChild(pop);
  pop.addEventListener("click", e => e.stopPropagation());
  const closePop = () => { pop.remove(); document.removeEventListener("click", outside); };
  const outside = ev => { if (!wrap.contains(ev.target)) closePop(); };
  pop.querySelectorAll(".dfp-pill").forEach(p => p.addEventListener("click", () => {
    DASH_RANGE.preset = p.dataset.preset; const [f, t] = rangeFor(p.dataset.preset);
    $("#dfp-from").value = f || ""; $("#dfp-to").value = t || "";
    pop.querySelectorAll(".dfp-pill").forEach(x => x.classList.toggle("on", x.dataset.preset === DASH_RANGE.preset));
  }));
  $("#dfp-created").addEventListener("click", () => { DASH_RANGE.useCreated = !DASH_RANGE.useCreated; $("#dfp-created").classList.toggle("on", DASH_RANGE.useCreated); });
  $("#dfp-clear").addEventListener("click", () => {
    DASH_RANGE = { preset: "last30", from: null, to: null, useCreated: false };
    const [f, t] = rangeFor("last30"); $("#dfp-from").value = f; $("#dfp-to").value = t; $("#dfp-created").classList.remove("on");
    pop.querySelectorAll(".dfp-pill").forEach(x => x.classList.toggle("on", x.dataset.preset === "last30"));
  });
  const apply = () => {
    const f = $("#dfp-from").value, t = $("#dfp-to").value, [pf, pt] = rangeFor(DASH_RANGE.preset);
    if (f && t && (f !== pf || t !== pt)) { DASH_RANGE.preset = "custom"; DASH_RANGE.from = f; DASH_RANGE.to = t; }
    closePop(); loadDashboard();
  };
  $("#dfp-apply").addEventListener("click", apply);
  $("#dfp-done").addEventListener("click", apply);
  setTimeout(() => document.addEventListener("click", outside), 0);
}

// ---------------------------------------------------------------- order funnel
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MIN_QTY = 20;
let CATALOG = null;
const CART = [];
let ORDER = null;

async function loadOrder() {
  const c = $("#content");
  c.innerHTML = `<div class="page-title">Order leads</div><div class="page-sub">Real-time leads, delivered the moment they come in.</div><div class="coming"><span class="spin"></span></div>`;
  if (!CATALOG) { try { CATALOG = (await sb.from("lead_types").select("*, lead_verticals(name)").eq("is_active", true).order("sort_order")).data || []; } catch { CATALOG = []; } }
  const lt = CATALOG[0];
  if (!lt) { c.innerHTML = `<div class="coming"><div class="badge"><i class="ti ti-alert-triangle"></i></div><b>No lead types configured</b><div>Add one in Admin → Pricing &amp; tiers (and make sure migrations 161–163 ran on this environment).</div></div>`; return; }
  // every REALTIME tier is a purchasable option in the realtime funnel
  let rtTiers = [];
  try { rtTiers = (await sb.from("lead_tiers").select("id,name,price").eq("lead_type_id", lt.id).eq("channel", "realtime").order("max_age_days")).data || []; } catch { }
  if (!rtTiers.length) rtTiers = [{ id: null, name: lt.name, price: Number(lt.realtime_price) || 0 }];
  const licensed = (ME.licensed_states || []).map(s => String(s).toUpperCase()).filter(s => US_STATES.includes(s));
  let sheets = [];
  try { sheets = (await sb.from("lead_sheets").select("id,name,lead_type_id").eq("agent_id", ME.id).eq("active", true).order("created_at", { ascending: false })).data || []; } catch { }
  ORDER = {
    lt, rtTiers, sel: 0, states: new Set(licensed), days: new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]),
    maxPerDay: 10, qty: MIN_QTY, sub: false, sheets,
    notif: { agentEmail: true, agentSms: true, agentApp: true, pdf: false, leadEmail: true, leadSms: true },
    delivery: { ghl: !!ME.ghl_api_key, webhook: "", sheet_id: "" },
  };
  renderOrder();
}

const curTier = () => ORDER.rtTiers[ORDER.sel] || {};
const ltPrice = () => Number(curTier().price) || 0;
const ordTotal = () => ORDER.qty * ltPrice();

function renderOrder() {
  const c = $("#content"), lt = ORDER.lt;
  c.innerHTML = `
    <div class="page-title">Order leads</div>
    <div class="page-sub">Real-time · ${esc(lt.lead_verticals?.name || "")} — delivered the moment they come in.</div>
    <div class="order-grid">
      <div>
        <div class="ord-sec first">1 · Lead type</div>
        <div class="lt-cards">${ORDER.rtTiers.map((t, i) => `<div class="lt-card ${i === ORDER.sel ? "on" : ""}" data-sel="${i}" style="cursor:pointer"><div class="lt-name">${esc(t.name)}</div><div class="lt-price">${money(Number(t.price) || 0)}<span>/lead</span></div></div>`).join("")}</div>
        <div class="ord-sec">2 · States <span class="muted">(<span id="st-count">${ORDER.states.size}</span> selected)</span></div>
        <div class="state-grid" id="state-grid">${US_STATES.map(s => `<span class="st ${ORDER.states.has(s) ? "on" : ""}" data-st="${s}">${s}</span>`).join("")}</div>
        <div class="ord-sec">3 · Delivery days &amp; cap</div>
        <div class="day-row" id="day-row">${DAYS.map(d => `<span class="day ${ORDER.days.has(d) ? "on" : ""}" data-day="${d}">${d}</span>`).join("")}</div>
        <div class="cap-row"><span>Max per day</span><input class="in" id="cap-in" type="number" min="1" value="${ORDER.maxPerDay}" style="width:90px"></div>

        <div class="ord-sec">4 · Thank-you page &amp; notifications</div>
        <div class="collapse open" data-cl>
          <div class="collapse-h"><span><i class="ti ti-bell lead"></i>Thank-you page &amp; notification preferences</span><i class="ti ti-chevron-down ch"></i></div>
          <div class="collapse-b">
            <button class="btn-soft" id="ty-defaults" type="button" style="margin-bottom:16px"><i class="ti ti-user-check"></i> Apply defaults from my profile</button>
            <div class="np-grid">
              <div><div class="np-lab">To agent</div><div class="cbx-row">
                <span class="cbx on" data-np="agentEmail"><span class="box"><i class="ti ti-check"></i></span>Email</span><span class="cbx on" data-np="agentSms"><span class="box"><i class="ti ti-check"></i></span>SMS</span><span class="cbx on" data-np="agentApp"><span class="box"><i class="ti ti-check"></i></span>In-app</span><span class="cbx" data-np="pdf"><span class="box"><i class="ti ti-check"></i></span>Incl. PDF</span>
              </div></div>
              <div><div class="np-lab">To lead</div><div class="cbx-row">
                <span class="cbx on" data-np="leadEmail"><span class="box"><i class="ti ti-check"></i></span>Email</span><span class="cbx on" data-np="leadSms"><span class="box"><i class="ti ti-check"></i></span>SMS</span>
              </div></div>
            </div>
            <div class="ty-grid">
              <div class="field"><label>Display name</label><input class="in" id="ty-name" value="${esc(ME.full_name || "")}"></div>
              <div class="field"><label>Title</label><input class="in" id="ty-title" value="${esc(ME.role_title || "")}"></div>
              <div class="field"><label>Phone</label><input class="in" id="ty-phone" value="${esc(ME.public_phone || "")}"></div>
              <div class="field"><label>Email</label><input class="in" id="ty-email" value="${esc(ME.email || "")}"></div>
              <div class="field"><label>NPN</label><input class="in" id="ty-npn" value="${esc(ME.npn || "")}"></div>
              <div class="field"><label>Calendar link</label><input class="in" id="ty-cal" placeholder="https://calendly.com/…"></div>
            </div>
            <div class="ord-note">Defaults come from your Profile — the lead sees these on the thank-you page.</div>
          </div>
        </div>

        <div class="ord-sec">5 · Lead delivery integration</div>
        <div class="collapse open" data-cl>
          <div class="collapse-h"><span><i class="ti ti-plug lead"></i>Where should these leads be delivered?</span><i class="ti ti-chevron-down ch"></i></div>
          <div class="collapse-b">
            <div class="int-row"><div><b>GoHighLevel</b><div class="muted2">${ME.ghl_api_key ? "Connected on your profile" : "Not connected"}</div></div><span class="cbx ${ORDER.delivery.ghl ? "on" : ""}" data-dv="ghl"><span class="box"><i class="ti ti-check"></i></span>Deliver to GHL</span></div>
            <div class="field" style="margin:14px 0"><label>Webhook URL</label><input class="in" id="dv-webhook" placeholder="https://hook.…"></div>
            <div class="field" style="margin:14px 0"><label>Google Sheet</label>
              ${ORDER.sheets?.length
    ? `<select class="in" id="dv-sheet"><option value="">— Don't deliver to a sheet —</option>${ORDER.sheets.map(s => `<option value="${s.id}" ${ORDER.delivery.sheet_id === s.id ? "selected" : ""}>${esc(s.name || "Untitled sheet")}</option>`).join("")}</select>`
    : `<div class="muted2">No Google Sheets yet — create one on the Integrations page, then it'll show here.</div>`}</div>
            <div class="ord-note">Set your default integrations on the Integrations page.</div>
          </div>
        </div>
      </div>
      <aside class="ord-summary">
        <div class="ord-sec first">Your order</div>
        <div class="sum-row"><span>Quantity <span class="muted">(min ${MIN_QTY})</span></span><span class="qstep"><button data-q="-1">−</button><b class="num" id="ord-qty">${ORDER.qty}</b><button data-q="1">+</button></span></div>
        <div class="sum-row"><span>Per lead</span><span class="num" id="per-lead">${money(ltPrice())}</span></div>
        <div class="sum-total"><span>Total</span><b class="num" id="ord-total">${money(ordTotal())}</b></div>
        <label class="sub-toggle"><span>Weekly subscription</span><button type="button" class="toggle ${ORDER.sub ? "" : "off"}" id="ord-sub"><b></b></button></label>
        <button class="btn-gold btn-block" id="ord-add">Add to cart</button>
        <div class="ord-note"><i class="ti ti-shield-check"></i> Replacement guarantee on invalid leads.</div>
      </aside>
    </div>`;
  $("#state-grid").addEventListener("click", e => {
    const s = e.target.dataset.st; if (!s) return;
    if (ORDER.states.has(s)) { ORDER.states.delete(s); e.target.classList.remove("on"); }
    else { ORDER.states.add(s); e.target.classList.add("on"); }
    $("#st-count").textContent = ORDER.states.size;
  });
  $("#day-row").addEventListener("click", e => {
    const d = e.target.dataset.day; if (!d) return;
    if (ORDER.days.has(d)) { ORDER.days.delete(d); e.target.classList.remove("on"); }
    else { ORDER.days.add(d); e.target.classList.add("on"); }
  });
  $("#cap-in").addEventListener("change", e => { ORDER.maxPerDay = Math.max(1, parseInt(e.target.value) || 1); e.target.value = ORDER.maxPerDay; });
  c.querySelectorAll(".qstep button").forEach(b => b.addEventListener("click", () => {
    ORDER.qty = Math.max(MIN_QTY, ORDER.qty + parseInt(b.dataset.q));
    $("#ord-qty").textContent = ORDER.qty; $("#ord-total").textContent = money(ordTotal());
  }));
  $("#ord-sub").addEventListener("click", () => { ORDER.sub = !ORDER.sub; $("#ord-sub").classList.toggle("off", !ORDER.sub); });
  c.querySelectorAll(".lt-card[data-sel]").forEach(el => el.addEventListener("click", () => {
    ORDER.sel = +el.dataset.sel;
    c.querySelectorAll(".lt-card").forEach((card, i) => card.classList.toggle("on", i === ORDER.sel));
    $("#per-lead").textContent = money(ltPrice());
    $("#ord-total").textContent = money(ordTotal());
  }));
  c.querySelectorAll(".collapse-h").forEach(h => h.addEventListener("click", () => h.parentElement.classList.toggle("open")));
  c.querySelectorAll(".cbx[data-np]").forEach(el => el.addEventListener("click", () => { const k = el.dataset.np; ORDER.notif[k] = !ORDER.notif[k]; el.classList.toggle("on", ORDER.notif[k]); }));
  c.querySelectorAll(".cbx[data-dv]").forEach(el => el.addEventListener("click", () => { ORDER.delivery.ghl = !ORDER.delivery.ghl; el.classList.toggle("on", ORDER.delivery.ghl); }));
  $("#dv-sheet")?.addEventListener("change", e => { ORDER.delivery.sheet_id = e.target.value; });
  $("#ty-defaults").addEventListener("click", () => {
    $("#ty-name").value = ME.full_name || ""; $("#ty-title").value = ME.role_title || "";
    $("#ty-phone").value = ME.public_phone || ""; $("#ty-email").value = ME.email || ""; $("#ty-npn").value = ME.npn || "";
  });
  $("#ord-add").addEventListener("click", addToCart);
}

function addToCart() {
  if (!ORDER.states.size) { alert("Select at least one state to receive leads from."); return; }
  const webhook = ($("#dv-webhook")?.value || "").trim();
  const sheetId = ORDER.delivery.sheet_id || "";
  const sheetName = ORDER.sheets?.find(s => s.id === sheetId)?.name;
  const deliver = [ORDER.delivery.ghl ? "GoHighLevel" : "", webhook ? "Webhook" : "", sheetName ? "Sheet" : ""].filter(Boolean).join(" + ") || "Portal only";
  if (deliver === "Portal only" && !confirm("No delivery integration selected — leads will only show in the portal. Continue?")) return;
  CART.push({
    name: curTier().name || ORDER.lt.name, vertical: ORDER.lt.lead_verticals?.name || "", channel: "Real-time",
    qty: ORDER.qty, price: ltPrice(), total: ordTotal(),
    states: [...ORDER.states], days: [...ORDER.days], maxPerDay: ORDER.maxPerDay, sub: ORDER.sub,
    deliver, delivery: { ghl: ORDER.delivery.ghl, webhook, sheet_id: sheetId },
    notif: { ...ORDER.notif },
    thankyou: {
      name: $("#ty-name")?.value || "", title: $("#ty-title")?.value || "", phone: $("#ty-phone")?.value || "",
      email: $("#ty-email")?.value || "", npn: $("#ty-npn")?.value || "", calendar: $("#ty-cal")?.value || "",
    },
  });
  updateCartCount();
  go("cart");
}

function bindRoutes(scope) { scope.querySelectorAll("[data-route]").forEach(el => el.addEventListener("click", () => go(el.dataset.route))); }

function initSigPad(canvas) {
  if (!canvas) return { isSigned: () => false, clear: () => {}, dataURL: () => null };
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width; canvas.height = rect.height;
  ctx.strokeStyle = "#f0c878"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
  let drawing = false, signed = false;
  const pos = e => { const r = canvas.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
  const start = e => { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
  const move = e => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); signed = true; e.preventDefault(); };
  const end = () => { drawing = false; };
  canvas.addEventListener("mousedown", start); canvas.addEventListener("mousemove", move); window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start, { passive: false }); canvas.addEventListener("touchmove", move, { passive: false }); canvas.addEventListener("touchend", end);
  return { isSigned: () => signed, clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); signed = false; }, dataURL: () => canvas.toDataURL("image/png") };
}

function loadCart() {
  const c = $("#content");
  updateCartCount();
  if (!CART.length) {
    c.innerHTML = `<div class="page-title">Your cart</div><div class="coming"><div class="badge"><i class="ti ti-shopping-cart"></i></div><b>Your cart is empty</b><div>Add a lead order to get started.</div><button class="btn-gold" data-route="order" style="margin-top:6px"><i class="ti ti-bolt"></i> Order leads</button></div>`;
    bindRoutes(c); return;
  }
  const totalLeads = CART.reduce((s, i) => s + i.qty, 0);
  const total = CART.reduce((s, i) => s + i.total, 0);
  c.innerHTML = `
    <div class="cart-banner"><div class="cb-ic"><i class="ti ti-shopping-cart"></i></div><div><div style="font-size:18px;font-weight:600">Your cart</div><div class="muted2">Review your selections and complete checkout to start receiving leads.</div></div></div>
    <div class="cart-2">
      <div>
        <div class="panel"><div class="panel-h">Cart items</div><div style="overflow-x:auto"><table class="tbl">
          <thead><tr><th>Lead package</th><th>Bucket</th><th>Quality</th><th>Frequency</th><th>Integration</th><th class="num">Leads</th><th class="num">Price</th><th></th></tr></thead>
          <tbody>${CART.map((i, ix) => `<tr>
            <td><b>${esc(i.vertical)} · ${esc(i.name)}</b><div class="muted2">${i.states.join(", ") || "—"}</div></td>
            <td><span class="badge2 ${i.channel === "Aged" ? "b-green" : "b-new"}">${i.channel === "Aged" ? "AGED" : "FRESH"}</span></td>
            <td>${esc(i.name)}</td>
            <td>${i.sub ? "Weekly" : "One-time"}</td>
            <td>${esc(i.deliver || "Portal only")}</td>
            <td class="num">${i.qty}</td>
            <td class="num" style="color:var(--gold);font-weight:600">${money(i.total)}</td>
            <td><i class="ti ti-trash" data-rm="${ix}" style="cursor:pointer;color:var(--tx3)"></i></td>
          </tr>`).join("")}</tbody>
        </table></div></div>
        <div class="panel" style="margin-top:14px"><div class="panel-h">Lead replacement policy</div><div class="panel-b">
          <label class="cbx" id="agree"><span class="box"><i class="ti ti-check"></i></span>I have read and agree to the Lead Replacement Policy</label>
          <div class="warn-bar"><i class="ti ti-alert-triangle"></i> If you do not agree with our Lead Replacement Policy, do not proceed with your order.</div>
          <div class="muted2" style="line-height:1.6;margin-bottom:12px">All sales are final and you waive your right to dispute charges. You agree to a $500 recovery fee should you choose to dispute a charge. The remedy for any lead issue is to contact the support desk.</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span class="muted2">Sign below to confirm your order</span><span class="lk" id="sig-clear" style="font-size:12px"><i class="ti ti-eraser"></i> Clear</span></div>
          <canvas id="sigpad" style="width:100%;height:96px;background:#0e1014;border:1px solid var(--line-2);border-radius:9px;cursor:crosshair;touch-action:none;display:block;margin-bottom:8px"></canvas>
          <div class="muted2">Your IP address: 99.101.175.119</div>
          <div style="display:flex;justify-content:space-between;margin-top:16px"><button class="btn-ghost" id="abandon">Abandon</button><button class="btn-gold" id="checkout-btn"><i class="ti ti-lock"></i> Checkout</button></div>
        </div></div>
      </div>
      <aside class="panel" style="align-self:start"><div class="panel-h">Order summary</div><div class="panel-b">
        <div style="display:flex;gap:8px;margin-bottom:16px"><input class="in" placeholder="Coupon code"><button class="btn-ghost">Apply</button></div>
        <div class="sum-row"><span>Items</span><span class="num">${CART.length}</span></div>
        <div class="sum-row"><span>Total leads</span><span class="num">${totalLeads}</span></div>
        <div class="sum-total"><span>Total</span><b class="num">${money(total)}</b></div>
        <div class="ord-note" style="text-align:center"><i class="ti ti-info-circle"></i> Stripe checkout connects once your account is set up.</div>
      </div></aside>
    </div>`;
  c.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { CART.splice(+b.dataset.rm, 1); updateCartCount(); loadCart(); }));
  $("#agree").addEventListener("click", () => $("#agree").classList.toggle("on"));
  $("#abandon").addEventListener("click", () => { CART.length = 0; updateCartCount(); loadCart(); });
  const sig = initSigPad($("#sigpad"));
  $("#sig-clear").addEventListener("click", () => sig.clear());
  $("#checkout-btn").addEventListener("click", () => {
    if (!$("#agree").classList.contains("on")) { alert("Please agree to the Lead Replacement Policy first."); return; }
    if (!sig.isSigned()) { alert("Please sign in the box to confirm your order."); return; }
    alert("Stripe checkout is wired in the next phase — your account setup gates it.");
  });
  bindRoutes(c);
}

// ---------------------------------------------------------------- dispositions (GOAT-style)
const DISPO_DEFS = [
  { v: "new_lead", label: "New Lead", sl: "new_lead", badge: "b-grey" },
  { v: "called", label: "Called", sl: "called", badge: "b-yellow" },
  { v: "follow_up", label: "Follow-Up", sl: "follow_up", badge: "b-blue" },
  { v: "appt_booked", label: "Appointment Booked", sl: "appointments", badge: "b-blue" },
  { v: "appt_no_show", label: "Appointment No Show", sl: "no_show", badge: "b-blue" },
  { v: "pitched_not_sold", label: "Pitched - Not Sold", sl: "not_sold", badge: "b-blue" },
  { v: "sold", label: "Sold", sl: "sold", badge: "b-green" },
  { v: "nurture", label: "Nurture", sl: "nurture", badge: "b-blue" },
  { v: "not_interested", label: "Not Interested", sl: "not_interested", badge: "b-red" },
  { v: "bad_number", label: "Bad Number", sl: "bad_number", badge: "b-red" },
];
const DISPO_MAP = Object.fromEntries(DISPO_DEFS.map(d => [d.v, d]));
const LEGACY_DISP = { no_answer: "called", callback: "follow_up", dnc: "bad_number" }; // old enum → new bucket
const dispDef = v => DISPO_MAP[v] || DISPO_MAP[LEGACY_DISP[v]] || DISPO_MAP.new_lead;
const dispLabel = v => dispDef(v).label;
const smartlistOf = v => dispDef(v).sl;

// ---------------------------------------------------------------- leads
const LEAD_TABS = [
  { id: "all", label: "All", sl: null },
  { id: "inbound", label: "Inbound", sl: null, ch: "inbound_call" },
  { id: "new_lead", label: "New", sl: "new_lead" },
  { id: "called", label: "Called", sl: "called" },
  { id: "follow_up", label: "Follow-Up", sl: "follow_up" },
  { id: "appointments", label: "Appointments", sl: "appointments" },
  { id: "no_show", label: "No Show", sl: "no_show" },
  { id: "not_sold", label: "Not Sold", sl: "not_sold" },
  { id: "sold", label: "Sold", sl: "sold" },
  { id: "nurture", label: "Nurture", sl: "nurture" },
  { id: "not_interested", label: "Not Interested", sl: "not_interested" },
  { id: "bad_number", label: "Bad Number", sl: "bad_number" },
];
let LEADS_DATA = [], LEADS_TAB = "all";
async function loadLeads() {
  const c = $("#content");
  c.innerHTML = `<div class="page-title">Leads</div><div class="page-sub">Your assigned leads.</div>${skelTable(10)}`;
  try { LEADS_DATA = (await sb.rpc("agent_leads_smartlisted", { p_agent: ME.id })).data || []; } catch { LEADS_DATA = []; }
  renderLeads();
}
function renderLeads() {
  const c = $("#content");
  const tabOf = id => LEAD_TABS.find(t => t.id === id) || LEAD_TABS[0];
  const inTab = (l, t) => t.ch ? l.channel === t.ch : (t.sl === null || l.smartlist === t.sl);   // channel tab (Inbound) or disposition smartlist; "all" (sl=null) shows everything
  const counts = {}; LEAD_TABS.forEach(t => counts[t.id] = LEADS_DATA.filter(l => inTab(l, t)).length);
  const rows = LEADS_DATA.filter(l => inTab(l, tabOf(LEADS_TAB)))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));   // newest first
  c.innerHTML = `
    <div class="pagehead"><div><div class="page-title">Leads</div><div class="page-sub">${LEADS_DATA.length.toLocaleString()} assigned leads.</div></div><div style="flex:1"></div><button class="btn-ghost"><i class="ti ti-download"></i> CSV</button></div>
    <div class="lead-pills">${LEAD_TABS.map(t => `<div class="lead-pill ${LEADS_TAB === t.id ? "on" : ""}" data-lt="${t.id}"><div class="lp-lab">${t.label}</div><div class="lp-n num">${counts[t.id].toLocaleString()}</div></div>`).join("")}</div>
    <div class="tbl-wrap"><div style="overflow-x:auto"><table class="tbl">
      <thead><tr><th>Date/Time</th><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>State</th></tr></thead>
      <tbody>${rows.length ? rows.map(l => `<tr class="lead-row tint-${dispDef(l.disposition).badge.replace("b-", "")}" data-view="${l.lead_id}">
        <td class="num" style="color:var(--tx3);white-space:nowrap">${l.created_at ? new Date(l.created_at).toLocaleString(undefined, { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" }) : "—"}</td>
        <td style="font-weight:500;white-space:nowrap"><span class="av-sm">${esc(initials((l.first_name || "") + " " + (l.last_name || "")))}</span>${esc(l.first_name || "")} ${esc(l.last_name || "")}</td>
        <td style="color:var(--tx2)">${esc(l.email || "—")}</td>
        <td class="num" style="color:var(--tx2);white-space:nowrap">${l.phone ? `${esc(l.phone)}<i class="ti ti-copy phone-copy" data-copy="${esc(l.phone)}" title="Copy"></i>` : "—"}</td>
        <td><span class="status-chip badge2 ${dispDef(l.disposition).badge}" data-disp="${l.assignment_id}" data-lead="${l.lead_id}">${esc(dispLabel(l.disposition))}<i class="ti ti-chevron-down"></i></span></td>
        <td>${esc(l.state || "—")}</td>
      </tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--tx3);padding:34px">No leads in this list.</td></tr>`}</tbody>
    </table></div></div>`;
  c.querySelectorAll(".lead-pill").forEach(t => t.addEventListener("click", () => { LEADS_TAB = t.dataset.lt; renderLeads(); }));
  c.querySelectorAll(".lead-row").forEach(r => r.addEventListener("click", () => openLeadPanel(r.dataset.view)));
  c.querySelectorAll(".status-chip").forEach(s => s.addEventListener("click", e => { e.stopPropagation(); openStatusMenu(s, s.dataset.disp, s.dataset.lead); }));
  c.querySelectorAll(".phone-copy").forEach(p => p.addEventListener("click", e => {
    e.stopPropagation();
    navigator.clipboard?.writeText(p.dataset.copy);
    const o = p.className; p.className = "ti ti-check phone-copy ok"; setTimeout(() => { p.className = o; }, 1100);
    toast(`Copied ${p.dataset.copy}`);
  }));
}

// inline disposition picker shared by the Leads table + lead panel
function openStatusMenu(anchor, assignmentId, leadId) {
  document.querySelector("#disp-menu")?.remove();
  if (!assignmentId) return;
  const row = LEADS_DATA.find(x => x.assignment_id === assignmentId);
  const cur = dispDef(row?.disposition).v;
  const menu = document.createElement("div");
  menu.id = "disp-menu"; menu.className = "disp-menu";
  menu.innerHTML = DISPO_DEFS.map(d => `<div class="disp-opt ${d.v === cur ? "on" : ""}" data-v="${d.v}"><span class="dot ${d.badge}"></span>${d.label}${d.v === cur ? `<i class="ti ti-check" style="margin-left:auto"></i>` : ""}</div>`).join("");
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = 220; let left = r.left + window.scrollX;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  menu.style.top = (r.bottom + window.scrollY + 5) + "px";
  menu.style.left = left + "px";
  menu.querySelectorAll(".disp-opt").forEach(o => o.addEventListener("click", e => { e.stopPropagation(); menu.remove(); applyDisposition(assignmentId, leadId, o.dataset.v); }));
  setTimeout(() => document.addEventListener("click", function h() { menu.remove(); document.removeEventListener("click", h); }), 0);
}

// set a disposition from anywhere, keep table + panel in sync, open the deal modal on "sold"
async function applyDisposition(assignmentId, leadId, disp) {
  if (!assignmentId) return;
  try { await sb.rpc("set_disposition", { p_assignment: assignmentId, p_disp: disp }); }
  catch (e) { alert(e.message); return; }
  const row = LEADS_DATA.find(x => x.assignment_id === assignmentId);
  if (row) { row.disposition = disp; row.smartlist = smartlistOf(disp); }
  if (LEAD_PANEL && LEAD_PANEL.id === leadId) {
    if (LEAD_PANEL._asn) LEAD_PANEL._asn.disposition = disp;
    const sel = document.querySelector("#lp-status"); if (sel) sel.value = disp;
    const p = document.querySelector(".lead-panel"); if (p) p.className = "lead-panel ptint-" + dispDef(disp).badge.replace("b-", "");
  }
  if (ROUTE === "leads") renderLeads();
  if (disp === "sold") {
    let leadObj = (LEAD_PANEL && LEAD_PANEL.id === leadId) ? LEAD_PANEL : null;
    if (!leadObj && row) leadObj = { id: row.lead_id, first_name: row.first_name, last_name: row.last_name, phone: row.phone, email: row.email, _asn: { id: assignmentId } };
    if (!leadObj) { try { leadObj = (await sb.from("leads").select("*").eq("id", leadId).single()).data; } catch { } }
    if (leadObj) openDealModal(leadObj);
  }
}

// ---------------------------------------------------------------- profile (9 tabs)
const PF_TABS = [
  ["profile", "Profile", "ti-user"], ["lead_settings", "Lead Settings", "ti-settings"],
  ["inbound", "Inbound calls", "ti-phone-incoming"],
  ["integrations", "Integrations", "ti-plug"], ["tags", "Tags", "ti-tag"],
  ["receipts", "Lead Receipts", "ti-receipt"], ["subscriptions", "Subscriptions", "ti-refresh"],
  ["preferences", "Preferences", "ti-adjustments"], ["notes", "Notes", "ti-note"],
  ["admin", "Admin", "ti-shield-lock"],
];
const PF_META = {
  profile: ["Profile", "Manage your account preferences"], lead_settings: ["Lead Settings", "Manage your account preferences"],
  inbound: ["Inbound calls", "How live inbound calls route to you"],
  tenant: ["Agency", "White-label branding & inbound billing"],
  integrations: ["Integrations", "Manage your account preferences"], tags: ["Tags", "Organize leads and orders with reusable tags"],
  receipts: ["Lead Receipts", "Your per-lead purchase history"], subscriptions: ["Subscriptions", "Manage your account preferences"],
  preferences: ["Preferences", "Manage your account preferences"], notes: ["Notes", "Private notes for your account"],
  admin: ["Admin", "Agency settings, agents, pricing & carriers"],
};
// every IANA time zone (with GMT offset label); falls back to a core list if the runtime lacks supportedValuesOf
const PF_TZ = (() => {
  const fallback = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "UTC"];
  let zones; try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = fallback; }
  const off = z => { try { const p = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "shortOffset" }).formatToParts(new Date()).find(x => x.type === "timeZoneName"); return p ? p.value.replace("GMT", "GMT") : ""; } catch { return ""; } };
  return zones.map(z => [z, `${off(z) ? "(" + off(z) + ") " : ""}${z.replace(/_/g, " ")}`]);
})();
const PF_SYSTEM_TAGS = ["fex lead", "gen life lead", "goat leads", "health lead", "iul lead", "mp lead", "new lead", "spanish lead", "trucker lead", "vet lead"];
const PF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PF_LEAD_FIELDS = ["Final Expense", "Mortgage Protection", "Veteran"];
// the field names we send per lead type through integrations (click a pill to view)
const LEAD_TYPE_FIELDS = {
  "Final Expense": [
    ["date_time", "Date and time of lead"], ["first_name", "Lead's first name"], ["last_name", "Lead's last name"],
    ["email", "Email address"], ["phone", "Contact phone number"], ["state", "State"], ["dob", "Date of birth"],
    ["age", "Age"], ["gender", "Gender"], ["otp_code", "OTP code"],
    ["ip_address", "IP address"], ["trusted_form_url", "Trusted Form URL"], ["needed_coverage", "Coverage amount needed"],
    ["beneficiary", "Beneficiary relationship"], ["beneficiary_name", "Beneficiary name"],
    ["health_history", "History of heart attack, stroke, cancer"], ["has_life_insurance", "Has life insurance"], ["favorite_hobby", "Favorite hobby"],
  ],
  "Mortgage Protection": [
    ["date_time", "Date and time of lead"], ["first_name", "Lead's first name"], ["last_name", "Lead's last name"],
    ["email", "Email address"], ["phone", "Contact phone number"], ["state", "State"], ["dob", "Date of birth"],
    ["age", "Age"], ["gender", "Gender"], ["otp_code", "OTP code"],
    ["ip_address", "IP address"], ["trusted_form_url", "Trusted Form URL"],
    ["health_history", "History of cancer, heart attack, diabetes, or stroke"], ["beneficiary", "Beneficiary relationship"],
    ["beneficiary_name", "Beneficiary name"], ["mortgage_balance", "Mortgage balance"], ["mortgage_payment", "Monthly mortgage payment"],
  ],
  "Veteran": [
    ["date_time", "Date and time of lead"], ["first_name", "Lead's first name"], ["last_name", "Lead's last name"],
    ["email", "Email address"], ["phone", "Contact phone number"], ["state", "State"], ["dob", "Date of birth"],
    ["age", "Age"], ["gender", "Gender"], ["otp_code", "OTP code"],
    ["ip_address", "IP address"], ["trusted_form_url", "Trusted Form URL"], ["marital_status", "Marital status"],
    ["military_status", "Military status"], ["needed_coverage", "How much coverage do you need?"], ["contact_time", "Best time of day to contact"],
    ["military_branch", "Military branch"], ["beneficiary", "Beneficiary relationship"], ["beneficiary_name", "Beneficiary name"],
  ],
};
function pfFieldsModal(type) {
  const fields = LEAD_TYPE_FIELDS[type] || [];
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal" style="width:480px;max-height:86vh;display:flex;flex-direction:column">
    <div class="modal-h"><span><i class="ti ti-list-details" style="color:var(--gold)"></i> ${esc(type)} Required Fields</span><i class="ti ti-x" id="ff-x" style="cursor:pointer;color:var(--tx3)"></i></div>
    <div class="modal-b" style="overflow:auto">
      <div class="muted2" style="margin-bottom:12px">These are the field names we send for this lead type through your integrations.</div>
      <table class="tbl ff-tbl"><thead><tr><th>Field Name</th><th>Description</th></tr></thead>
        <tbody>${fields.map(([f, d]) => `<tr><td><code class="ff-field">${esc(f)}</code></td><td>${esc(d)}</td></tr>`).join("")}</tbody></table>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $("#ff-x").addEventListener("click", close);
}
let PF_TAB = "profile";
// admin views render into the Admin tab's sub-body when open, else the settings body, else the page
const adminHost = () => document.getElementById("admin-body") || document.getElementById("pf-body") || $("#content");
const hourLabel = h => { const ap = h < 12 ? "AM" : "PM"; const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}:00 ${ap}`; };
const PF_HOURS = Array.from({ length: 24 }, (_, h) => [String(h), hourLabel(h)]);
// small builders
const _i = (id, val, ph = "", type = "text") => `<input class="in" id="${id}" type="${type}" value="${esc(val ?? "")}" placeholder="${esc(ph)}">`;
const _f = (lab, inner) => `<div class="field"><label>${lab}</label>${inner}</div>`;
const _sel = (id, opts, cur) => `<select class="in" id="${id}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(cur ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`; }).join("")}</select>`;

async function pfPersist(core, settingsPatch, btn) {
  if (btn) { btn.disabled = true; btn._t = btn.textContent; btn.textContent = "Saving…"; }
  const settings = { ...(ME.settings || {}), ...(settingsPatch || {}) };
  const { error } = await sb.from("agents").update({ ...(core || {}), settings }).eq("id", ME.id);
  if (!error) { Object.assign(ME, core || {}); ME.settings = settings; }
  if (btn) { btn.disabled = false; btn.textContent = error ? "Retry" : "Saved ✓"; setTimeout(() => { btn.textContent = btn._t; }, 1500); }
  if (error) alert(error.message);
  return !error;
}

function loadProfile() {
  const c = $("#content"); const [title, sub] = PF_META[PF_TAB] || ["Settings", ""];
  const heroIc = (PF_TABS.find(t => t[0] === PF_TAB) || [, , "ti-settings"])[2];
  c.innerHTML = `
    <div class="pf-hero"><div class="pf-hero-ic"><i class="ti ${heroIc}"></i></div><div><div class="pf-hero-t">${title}</div><div class="pf-hero-s">${sub}</div></div></div>
    <div class="pf-tabs">${PF_TABS.filter(t => t[0] !== "admin" || ME.access_level === "admin" || ME.is_platform_admin).map(([id, lab, ic]) => `<span class="pf-tab ${PF_TAB === id ? "on" : ""}" data-pf="${id}"><i class="ti ${ic}"></i> ${lab}</span>`).join("")}</div>
    <div id="pf-body"></div>`;
  c.querySelectorAll(".pf-tab").forEach(t => t.addEventListener("click", () => { PF_TAB = t.dataset.pf; loadProfile(); }));
  pfRenderTab();
}
function pfRenderTab() {
  ({ profile: pfProfile, lead_settings: pfLeadSettings, inbound: pfInbound, tenant: pfTenant, admin: pfAdmin, integrations: pfIntegrations, tags: pfTags, receipts: pfReceipts, subscriptions: pfSubscriptions, preferences: pfPreferences, notes: pfNotes })[PF_TAB]();
}
// Admin hub — one Settings tab, sub-nav for every agency-admin area (renders into #admin-body)
const ADMIN_SUBS = [
  ["tenant",     "Agency",              "ti-building",           () => pfTenant()],
  ["setup",      "Setup",               "ti-rocket",             () => loadSetup()],
  ["agents",     "Agents",              "ti-users",              () => loadAgents()],
  ["admintiers", "Pricing & tiers",     "ti-adjustments-dollar", () => loadAdminTiers()],
  ["catalog",    "Carriers & products", "ti-building-bank",      () => loadCatalogAdmin()],
];
let ADMIN_TAB = "tenant";
function pfAdmin() {
  const body = $("#pf-body");
  body.innerHTML = `<div class="pf-tabs" style="margin-bottom:14px">${ADMIN_SUBS.map(([id, lab, ic]) => `<span class="pf-tab ${ADMIN_TAB === id ? "on" : ""}" data-adm="${id}"><i class="ti ${ic}"></i> ${lab}</span>`).join("")}</div><div id="admin-body"></div>`;
  body.querySelectorAll("[data-adm]").forEach(t => t.addEventListener("click", () => { ADMIN_TAB = t.dataset.adm; pfAdmin(); }));
  (ADMIN_SUBS.find(s => s[0] === ADMIN_TAB) || ADMIN_SUBS[0])[3]();
}
// upload a profile picture / insurance card to Supabase storage, save its URL to settings
async function pfUpload(file, kind) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { alert("Please choose an image file."); return; }
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${ME.id}/${kind}.${ext}`;
  const up = await sb.storage.from("agent-media").upload(path, file, { upsert: true, cacheControl: "3600" });
  if (up.error) { alert(up.error.message); return; }
  const url = sb.storage.from("agent-media").getPublicUrl(path).data.publicUrl + "?t=" + Date.now();
  await pfPersist(null, kind === "avatar" ? { avatar_url: url } : { insurance_card_url: url });
  pfProfile();
}

// ---- Profile ----
function pfProfile() {
  const m = ME, S = m.settings || {}, home = S.home || {}, biz = S.biz || {};
  const first = (m.full_name || "").split(" ")[0] || "", last = (m.full_name || "").split(" ").slice(1).join(" ");
  const stateSel = (id, cur) => _sel(id, [["", "Select state"], ...US_STATES.map(s => [s, s])], cur);
  $("#pf-body").innerHTML = `
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-id"></i> Personal Information</b><span>Your personal information and address</span></div>
      <div style="padding:16px 16px 0;display:flex;align-items:center;gap:13px">
        <div class="pf-av-wrap" id="pf-av-wrap" title="Upload profile picture">
          ${S.avatar_url ? `<img class="pf-av-img" src="${esc(S.avatar_url)}" alt="">` : `<div class="pf-av">${esc(initials(m.full_name || ""))}</div>`}
          <span class="pf-av-edit"><i class="ti ti-camera"></i></span>
        </div>
        <div style="flex:1"><div style="font-weight:600;font-size:15px">${esc(m.full_name || "")}</div><div class="muted2">${esc(m.email || "")}</div><div class="muted2">${esc(m.role_title || "Insurance Agent")}${S.imo ? " · " + esc(S.imo) : ""}</div></div>
        <div class="pf-idcard">
          ${S.insurance_card_url ? `<a href="${esc(S.insurance_card_url)}" target="_blank" class="pf-idcard-thumb" style="background-image:url('${esc(S.insurance_card_url)}')"></a>` : `<div class="pf-idcard-empty"><i class="ti ti-id-badge-2"></i></div>`}
          <button class="btn-ghost" id="pf-idcard-btn" style="padding:7px 11px;font-size:12px"><i class="ti ti-upload"></i> ${S.insurance_card_url ? "Replace" : "Insurance card"}</button>
        </div>
      </div>
      <input type="file" id="pf-av-file" accept="image/*" hidden>
      <input type="file" id="pf-idcard-file" accept="image/*" hidden>
      <div class="pf-grid">
        ${_f("First Name", _i("pf-first", first))}${_f("Last Name", _i("pf-last", last))}
        ${_f("Phone", _i("pf-phone", m.public_phone))}${_f("Email", `<input class="in" value="${esc(m.email || "")}" disabled>`)}
        ${_f("Date of Birth", _i("pf-dob", S.dob, "", "date"))}${_f("Time Zone", _sel("pf-tz", PF_TZ, S.tz || "America/Chicago"))}
      </div>
      <div style="padding:0 16px 6px"><div class="np-lab" style="margin-bottom:8px">Home Address</div></div>
      <div class="pf-grid" style="padding-top:0">
        ${_f("Street Address", _i("pf-h-street", home.street))}${_f("City", _i("pf-h-city", home.city))}
        ${_f("State", stateSel("pf-h-state", home.state))}${_f("Zip Code", _i("pf-h-zip", home.zip))}
        ${_f("Country", _i("pf-h-country", home.country || "United States"))}<div></div>
      </div>
    </div>
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-briefcase"></i> Business Information</b><span>Your professional details and business address</span></div>
      <div class="pf-grid">
        ${_f("Title", _i("pf-title", S.title || m.role_title))}${_f("NPN ID", _i("pf-npn", m.npn))}
        ${_f("IMO", _i("pf-imo", S.imo))}${_f("Agency", _i("pf-agency", S.agency))}
        ${_f("Agent Website", _i("pf-website", S.website, "https://example.com"))}<div></div>
      </div>
      <div style="padding:0 16px 6px;display:flex;justify-content:space-between;align-items:center"><div class="np-lab" style="margin-bottom:0">Business Address</div><label class="cbx ${biz.same_as_home ? "on" : ""}" id="pf-same"><span class="box"><i class="ti ti-check"></i></span>Same as home</label></div>
      <div class="pf-grid" style="padding-top:8px">
        ${_f("Street Address", _i("pf-b-street", biz.street))}${_f("City", _i("pf-b-city", biz.city))}
        ${_f("State", stateSel("pf-b-state", biz.state))}${_f("Zip Code", _i("pf-b-zip", biz.zip))}
        ${_f("Country", _i("pf-b-country", biz.country || "United States"))}<div></div>
      </div>
      <div style="padding:2px 16px 14px"><div class="np-lab">Licensed States <span class="muted2">(<span id="pf-lst-count">${(m.licensed_states || []).length}</span> selected)</span></div>
        <div class="muted2" style="margin:-2px 0 10px">These states apply to <b>all</b> lead types — lead orders and live inbound calls.</div>
        <div class="pf-days" id="pf-lstates">${US_STATES.map(s => `<span class="pf-day ${(m.licensed_states || []).includes(s) ? "on" : ""}" data-lst="${s}">${s}</span>`).join("")}</div>
      </div>
    </div>
    <div class="pf-actions"><button class="btn-ghost" onclick="loadProfile()">Cancel</button><button class="btn-gold" id="pf-save"><i class="ti ti-check"></i> Save Settings</button></div>`;
  $("#pf-same").addEventListener("click", () => $("#pf-same").classList.toggle("on"));
  $("#pf-body").querySelectorAll('.pf-day[data-lst]').forEach(x => x.addEventListener("click", () => {
    x.classList.toggle("on");
    const c = $("#pf-lst-count"); if (c) c.textContent = $("#pf-body").querySelectorAll('.pf-day[data-lst].on').length;
  }));
  $("#pf-av-wrap").addEventListener("click", () => $("#pf-av-file").click());
  $("#pf-av-file").addEventListener("change", e => pfUpload(e.target.files[0], "avatar"));
  $("#pf-idcard-btn").addEventListener("click", () => $("#pf-idcard-file").click());
  $("#pf-idcard-file").addEventListener("change", e => pfUpload(e.target.files[0], "insurance"));
  $("#pf-save").addEventListener("click", e => {
    const full = [$("#pf-first").value.trim(), $("#pf-last").value.trim()].filter(Boolean).join(" ");
    const same = $("#pf-same").classList.contains("on");
    const v = id => $(id).value.trim() || null;
    const homeObj = { street: v("#pf-h-street"), city: v("#pf-h-city"), state: $("#pf-h-state").value, zip: v("#pf-h-zip"), country: v("#pf-h-country") };
    const bizObj = same ? { ...homeObj, same_as_home: true } : { street: v("#pf-b-street"), city: v("#pf-b-city"), state: $("#pf-b-state").value, zip: v("#pf-b-zip"), country: v("#pf-b-country"), same_as_home: false };
    // licensed states are the single source of truth for all lead types; clearing call_states makes routing fall back to them
    const lstates = US_STATES.filter(s => $(`.pf-day[data-lst="${s}"]`)?.classList.contains("on"));
    pfPersist({ full_name: full, public_phone: v("#pf-phone"), npn: v("#pf-npn"), licensed_states: lstates, call_states: [] },
      { dob: v("#pf-dob"), tz: $("#pf-tz").value, home: homeObj, title: v("#pf-title"), imo: v("#pf-imo"), agency: v("#pf-agency"), website: v("#pf-website"), biz: bizObj }, e.target);
  });
}

// ---- Lead Settings ----
function pfLeadSettings() {
  const S = ME.settings || {}, L = S.lead_settings || {}, d = L.display || {}, sc = L.schedule || {}, nt = L.notify || {}, na = nt.agent || {}, nl = nt.lead || {};
  const days = new Set(sc.days || ["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const cbx = (id, on, lab) => `<label class="cbx ${on ? "on" : ""}" data-cb="${id}"><span class="box"><i class="ti ti-check"></i></span>${lab}</label>`;
  $("#pf-body").innerHTML = `
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-database"></i> Lead Defaults</b><span>Choose how new lead orders inherit profile data</span></div>
      <div class="pf-banner">Changes here apply to new lead orders only.</div>
      <div style="padding:14px 16px"><div class="np-lab">Default sources</div><div class="cbx-row">${cbx("ls-use-profile", L.use_profile, "Use profile info for lead defaults")}${cbx("ls-use-typ", L.use_typ, "Use profile info on thank-you page")}</div></div>
    </div>
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-user-cog"></i> Displayed Agent Info</b><span>Agent details shown on leads and thank-you pages</span></div>
      <div class="pf-grid">
        ${_f("Display Agent Title", _i("ls-title", d.title))}<div></div>
        ${_f("Display Agent Name", _i("ls-name", d.name || ME.full_name))}${_f("Display Agent NPN", _i("ls-npn", d.npn || ME.npn))}
        ${_f("Display Agent Email", _i("ls-email", d.email || ME.email))}${_f("Display Agent Phone", _i("ls-phone", d.phone || ME.public_phone))}
        ${_f("Display Agent Website", _i("ls-website", d.website, "https://example.com"))}${_f("Display Calendar Link", _i("ls-cal", d.calendar, "https://calendar.example.com"))}
      </div>
    </div>
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-calendar"></i> Schedule</b><span>Default schedule for new lead orders</span></div>
      <div style="padding:14px 16px">
        <div class="np-lab">Default days per week</div>
        <div class="pf-days">${PF_WEEK.map(d2 => `<span class="pf-day ${days.has(d2) ? "on" : ""}" data-day="${d2}">${d2}</span>`).join("")}</div>
        <div class="np-lab" style="margin-top:16px">Lead volume</div>
        ${_f("Daily Lead Cap", _i("ls-cap", sc.cap, "e.g. 10", "number"))}
        <div class="muted2" style="margin-top:-6px">Leave blank to match lead order amount (minimum).</div>
      </div>
    </div>
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-bell"></i> Notification Preferences</b><span>Default notification preferences for new lead orders</span></div>
      <div class="pf-grid">
        <div><div class="np-lab">To agent</div><div class="cbx-row">${cbx("ls-na-email", na.email !== false, "Email")}${cbx("ls-na-sms", na.sms !== false, "SMS")}${cbx("ls-na-app", na.in_app !== false, "In App")}${cbx("ls-na-pdf", na.pdf, "Incl PDF")}</div></div>
        <div><div class="np-lab">To lead</div><div class="cbx-row">${cbx("ls-nl-email", nl.email !== false, "Email")}${cbx("ls-nl-sms", nl.sms, "SMS")}</div></div>
      </div>
    </div>
    <div class="pf-actions"><button class="btn-ghost" onclick="loadProfile()">Cancel</button><button class="btn-gold" id="pf-save"><i class="ti ti-check"></i> Save Settings</button></div>`;
  $("#pf-body").querySelectorAll("[data-cb]").forEach(x => x.addEventListener("click", () => x.classList.toggle("on")));
  $("#pf-body").querySelectorAll(".pf-day").forEach(x => x.addEventListener("click", () => x.classList.toggle("on")));
  $("#pf-save").addEventListener("click", e => {
    const on = id => $(`[data-cb="${id}"]`).classList.contains("on");
    const v = id => $(id).value.trim() || null;
    pfPersist(null, {
      lead_settings: {
        use_profile: on("ls-use-profile"), use_typ: on("ls-use-typ"),
        display: { title: v("#ls-title"), name: v("#ls-name"), npn: v("#ls-npn"), email: v("#ls-email"), phone: v("#ls-phone"), website: v("#ls-website"), calendar: v("#ls-cal") },
        schedule: { days: PF_WEEK.filter(d2 => $(`.pf-day[data-day="${d2}"]`).classList.contains("on")), cap: v("#ls-cap") },
        notify: { agent: { email: on("ls-na-email"), sms: on("ls-na-sms"), in_app: on("ls-na-app"), pdf: on("ls-na-pdf") }, lead: { email: on("ls-nl-email"), sms: on("ls-nl-sms") } },
      }
    }, e.target);
  });
}

// ---- Inbound calls ----
function pfInbound() {
  const m = ME, hrs = m.call_hours || {};
  const days = new Set(hrs.days || ["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const cbx = (id, on, lab) => `<label class="cbx ${on ? "on" : ""}" data-cb="${id}"><span class="box"><i class="ti ti-check"></i></span>${lab}</label>`;
  $("#pf-body").innerHTML = `
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-phone-incoming"></i> Availability</b><span>Live inbound calls route to you only when you're available</span></div>
      <div style="padding:14px 16px 4px"><div class="cbx-row">${cbx("in-avail", m.available_for_calls, "Available for inbound calls")}</div></div>
      <div class="pf-grid" style="padding-top:8px">
        ${_f("Forwarding number", _i("in-fwd", m.forward_number, "+1 254 555 0100", "tel"))}<div></div>
        ${_f("Max simultaneous calls", _i("in-conc", m.call_max_concurrent ?? 1, "1", "number"))}${_f("Daily call cap", _i("in-cap", m.call_daily_cap, "Uncapped", "number"))}
      </div>
      <div style="padding:0 16px 14px"><div class="muted2">The forwarding number is where Trackdrive rings you (your cell or office line). Leave the daily cap blank for uncapped.</div></div>
    </div>
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-clock"></i> Call hours</b><span>When you'll accept inbound calls</span></div>
      <div style="padding:14px 16px">
        <div class="np-lab">Days</div>
        <div class="pf-days">${PF_WEEK.map(d => `<span class="pf-day ${days.has(d) ? "on" : ""}" data-day="${d}">${d}</span>`).join("")}</div>
        <div class="pf-grid" style="padding:14px 0 0">
          ${_f("Start", _i("in-start", hrs.start || "09:00", "", "time"))}${_f("End", _i("in-end", hrs.end || "18:00", "", "time"))}
        </div>
      </div>
    </div>
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-map-pin"></i> Call states</b><span>Which states you'll take calls for</span></div>
      <div style="padding:14px 16px"><div class="muted2">Inbound calls route by your <b>Licensed States</b> (${(m.licensed_states || []).length} set). Manage them in <a href="#" data-goto-profile class="g">Profile</a> — one list now covers lead orders and calls.</div></div>
    </div>
    <div class="pf-actions"><button class="btn-ghost" onclick="loadProfile()">Cancel</button><button class="btn-gold" id="pf-save"><i class="ti ti-check"></i> Save Settings</button></div>`;
  $("#pf-body").querySelectorAll("[data-cb]").forEach(x => x.addEventListener("click", () => x.classList.toggle("on")));
  $("#pf-body").querySelectorAll(".pf-day[data-day]").forEach(x => x.addEventListener("click", () => x.classList.toggle("on")));
  $("#pf-body").querySelector("[data-goto-profile]")?.addEventListener("click", e => { e.preventDefault(); PF_TAB = "profile"; loadProfile(); });
  $("#pf-save").addEventListener("click", async e => {
    const on = id => $(`[data-cb="${id}"]`).classList.contains("on");
    const numOrNull = id => { const val = $(id).value.trim(); return val === "" ? null : Number(val); };
    const avail = on("in-avail");
    const ok = await pfPersist({
      available_for_calls: avail,
      forward_number: $("#in-fwd").value.trim() || null,
      call_max_concurrent: numOrNull("#in-conc") ?? 1,
      call_daily_cap: numOrNull("#in-cap"),
      call_hours: { days: PF_WEEK.filter(d => $(`.pf-day[data-day="${d}"]`).classList.contains("on")), start: $("#in-start").value || null, end: $("#in-end").value || null },
    }, null, e.target);
    if (ok) {  // keep the nav availability toggle in sync
      const navChk = document.getElementById("av-check");
      if (navChk) { navChk.checked = avail; document.getElementById("av-toggle")?.classList.toggle("on", avail); }
    }
  });
}

// ---- Tenant (white-label branding + inbound billing) ----
async function pfTenant() {
  const tid = activeTenantId();
  let t = (TENANT && TENANT.id === tid) ? TENANT : null;
  if (!t && tid) { try { t = (await sb.from("tenants").select("id,slug,name,brand_name,logo_url,settings").eq("id", tid).maybeSingle()).data; } catch { } }
  t = t || {};
  const s = t.settings || {};
  const who = ME.is_platform_admin ? `<div class="muted2" style="padding:0 16px 4px">Editing <b>${esc(t.brand_name || t.name || t.slug || "tenant")}</b> — switch tenants from the sidebar.</div>` : "";
  adminHost().innerHTML = `
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-building"></i> Branding</b><span>Your logo and name shown in the portal header</span></div>
      ${who}
      <div style="padding:14px 16px">
        <div style="display:flex;align-items:center;gap:16px;margin:0 0 14px">
          <div class="tn-logo">${t.logo_url ? `<img src="${esc(t.logo_url)}" alt="">` : `<i class="ti ti-photo"></i>`}</div>
          <div><button class="btn-ghost" id="tn-logo-btn"><i class="ti ti-upload"></i> ${t.logo_url ? "Replace logo" : "Upload logo"}</button><div class="muted2" style="margin-top:6px">PNG or SVG · square works best.</div></div>
          <input type="file" id="tn-logo-file" accept="image/*" hidden>
        </div>
        <div class="pf-grid" style="padding:0">
          ${_f("Brand name", _i("tn-name", t.brand_name))}${_f("Company name", _i("tn-legal", t.name))}
        </div>
      </div>
    </div>
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-coin"></i> Inbound call billing</b><span>What a billable inbound call costs an agent</span></div>
      <div class="pf-grid">
        ${_f("Call price ($)", _i("tn-price", s.call_price, "e.g. 30", "number"))}${_f("Billable after (seconds)", _i("tn-threshold", s.billable_threshold_sec ?? 90, "90", "number"))}
      </div>
      <div style="padding:0 16px 12px"><div class="muted2">A call becomes billable once connected talk time crosses this many seconds; the agent's wallet is then charged the call price. Leave price blank to track calls without charging yet.</div></div>
    </div>
    <div class="pf-actions"><button class="btn-ghost" onclick="loadProfile()">Cancel</button><button class="btn-gold" id="tn-save"><i class="ti ti-check"></i> Save</button></div>`;
  $("#tn-logo-btn").addEventListener("click", () => $("#tn-logo-file").click());
  $("#tn-logo-file").addEventListener("change", e => tnUploadLogo(e.target.files[0], t.id));
  $("#tn-save").addEventListener("click", e => tnSave(t.id, s, e.target));
}
async function tnUploadLogo(file, tenantId) {
  if (!file || !tenantId) return;
  if (!/^image\//.test(file.type)) { alert("Please choose an image file."); return; }
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${tenantId}/logo.${ext}`;
  const up = await sb.storage.from("branding").upload(path, file, { upsert: true, cacheControl: "3600" });
  if (up.error) { alert(up.error.message); return; }
  const urlv = sb.storage.from("branding").getPublicUrl(path).data.publicUrl + "?t=" + Date.now();
  const { error } = await sb.from("tenants").update({ logo_url: urlv }).eq("id", tenantId);
  if (error) { alert(error.message); return; }
  if (tenantId === activeTenantId()) { if (TENANT) TENANT.logo_url = urlv; const at = ALL_TENANTS.find(x => x.id === tenantId); if (at) at.logo_url = urlv; applyBrand(); }
  toast("Logo updated"); pfTenant();
}
async function tnSave(tenantId, curSettings, btn) {
  const priceRaw = $("#tn-price").value.trim(), thrRaw = $("#tn-threshold").value.trim();
  const settings = { ...(curSettings || {}),
    call_price: priceRaw === "" ? null : Number(priceRaw),
    billable_threshold_sec: thrRaw === "" ? 90 : Number(thrRaw) };
  btn.disabled = true; btn.textContent = "Saving…";
  const { error } = await sb.from("tenants").update({
    brand_name: $("#tn-name").value.trim() || null,
    name: $("#tn-legal").value.trim() || null,
    settings,
  }).eq("id", tenantId);
  btn.disabled = false; btn.textContent = error ? "Retry" : "Saved ✓";
  if (error) { alert(error.message); return; }
  if (tenantId === activeTenantId()) {
    try {
      TENANT = (await sb.from("tenants").select("id,slug,name,brand_name,logo_url,settings").eq("id", tenantId).maybeSingle()).data;
      const i = ALL_TENANTS.findIndex(x => x.id === tenantId); if (i >= 0 && TENANT) ALL_TENANTS[i] = TENANT;
      applyBrand();
    } catch { }
  }
  setTimeout(() => { btn.textContent = "Save"; }, 1500);
}

// ---- Agencies (platform / dev console: white-label tenant onboarding) ----
async function loadAgencies() {
  const c = $("#content");
  const head = `<div class="dash-head"><div><div class="page-title">Agencies</div><div class="page-sub">White-label tenants on the platform.</div></div><div class="dash-filter-wrap"><button class="btn-gold" id="new-agency"><i class="ti ti-plus"></i> New agency</button></div></div>`;
  c.innerHTML = head + skelTable(6);
  $("#new-agency")?.addEventListener("click", openCreateAgency);
  let list = [], counts = {};
  try { list = (await sb.from("tenants").select("id,slug,name,brand_name,logo_url,settings,created_at").order("created_at")).data || []; } catch { }
  try { (await sb.from("agents").select("tenant_id")).data?.forEach(r => { counts[r.tenant_id] = (counts[r.tenant_id] || 0) + 1; }); } catch { }
  const rows = list.map(t => {
    const s = t.settings || {};
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px"><div class="tn-logo" style="width:34px;height:34px;border-radius:8px">${t.logo_url ? `<img src="${esc(t.logo_url)}" alt="">` : `<i class="ti ti-building" style="font-size:15px"></i>`}</div><div><b>${esc(t.brand_name || t.name || t.slug)}</b><div class="muted2">${esc(t.name || "")}</div></div></div></td>
      <td>${esc(t.slug)}</td>
      <td>${counts[t.id] || 0}</td>
      <td>${s.call_price != null && s.call_price !== "" ? money(s.call_price) : '<span class="muted2">— not set</span>'}</td>
      <td>${esc(s.admin_email || "—")}</td>
      <td style="text-align:right"><button class="btn-ghost sm" data-manage="${t.id}"><i class="ti ti-login-2"></i> Manage</button> <button class="btn-ghost sm" data-link="${esc(t.slug)}"><i class="ti ti-link"></i> Link</button></td>
    </tr>`;
  }).join("");
  c.innerHTML = head + `<table class="data-tbl"><thead><tr><th>Agency</th><th>Slug</th><th>Agents</th><th>Call price</th><th>Admin</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  $("#new-agency")?.addEventListener("click", openCreateAgency);
  c.querySelectorAll("[data-link]").forEach(b => b.addEventListener("click", () => {
    const link = `${location.origin}${location.pathname}?tenant=${b.dataset.link}`;
    navigator.clipboard?.writeText(link); toast("Signup link copied — share with the agency");
  }));
  c.querySelectorAll("[data-manage]").forEach(b => b.addEventListener("click", () => enterAgency(b.dataset.manage)));
}
function openCreateAgency() {
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal" style="width:460px"><div class="modal-h"><span><i class="ti ti-building-plus" style="color:var(--gold)"></i> New agency</span><i class="ti ti-x" id="ag-x" style="cursor:pointer;color:var(--tx3)"></i></div>
    <div class="modal-b">
      <div class="pf-grid" style="padding:0">
        ${_f("Agency name *", _i("ag-name", "", "Acme Insurance Group"))}${_f("Slug *", _i("ag-slug", "", "acme"))}
        ${_f("Brand name", _i("ag-brand", "", "Acme"))}${_f("Admin email *", _i("ag-email", "", "admin@acme.com", "email"))}
      </div>
      <div class="muted2" style="padding:2px 0 8px">The slug goes in their signup link + Trackdrive URL (lowercase, no spaces). The admin email becomes the agency's admin when they sign up.</div>
      <div id="ag-err" style="color:var(--red);font-size:12px;min-height:14px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn-ghost" id="ag-cancel">Cancel</button><button class="btn-gold" id="ag-save"><i class="ti ti-check"></i> Create agency</button></div>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $("#ag-x").addEventListener("click", close); $("#ag-cancel").addEventListener("click", close);
  $("#ag-slug").addEventListener("input", e => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""); });
  $("#ag-save").addEventListener("click", async () => {
    const name = $("#ag-name").value.trim(), slug = $("#ag-slug").value.trim(), email = $("#ag-email").value.trim();
    if (!name || !slug) { $("#ag-err").textContent = "Agency name and slug are required."; return; }
    const btn = $("#ag-save"); btn.disabled = true; btn.textContent = "Creating…";
    const { error } = await sb.rpc("create_tenant", { p_slug: slug, p_name: name, p_brand_name: $("#ag-brand").value.trim() || null, p_admin_email: email || null });
    if (error) { btn.disabled = false; btn.textContent = "Create agency"; $("#ag-err").textContent = error.message; return; }
    close(); confetti(); toast("Agency created 🎉"); loadAgencies();
  });
}

// ---- Agents roster (admin console: the agency's agents) ----
async function loadAgents() {
  const c = adminHost();
  const brand = TENANT?.brand_name || "your agency";
  const head = `<div class="dash-head"><div><div class="page-title">Agents</div><div class="page-sub">Agents in ${esc(brand)}.</div></div><div class="dash-filter-wrap"><button class="btn-gold" id="invite-agent"><i class="ti ti-link"></i> Invite link</button></div></div>`;
  c.innerHTML = head + skelTable(8);
  const tid = activeTenantId();
  let list = [], wallets = {};
  try { list = (await sb.from("agents").select("id,full_name,email,access_level,available_for_calls,forward_number,is_active,licensed_states,last_call_at").eq("tenant_id", tid).order("full_name")).data || []; } catch { }
  try { (await sb.from("wallets").select("agent_id,balance").eq("tenant_id", tid)).data?.forEach(w => { wallets[w.agent_id] = w.balance; }); } catch { }
  const rows = list.map(a => `<tr>
      <td><b>${esc(a.full_name || a.email)}</b><div class="muted2">${esc(a.email)}</div></td>
      <td>${esc(a.access_level)}</td>
      <td>${a.available_for_calls ? '<span class="pill green">Available</span>' : '<span class="pill grey">Off</span>'}</td>
      <td>${esc(a.forward_number || "—")}</td>
      <td>${money(wallets[a.id] || 0)}</td>
      <td>${(a.licensed_states || []).length}</td>
      <td>${a.is_active ? '<span class="pill green">Active</span>' : '<span class="pill red">Inactive</span>'}</td>
      <td style="text-align:right">${a.id === ME.id ? '<span class="muted2">you</span>' : (a.access_level === "admin" ? `<button class="btn-ghost sm" data-agent="${a.id}" data-role="producer">Remove admin</button>` : `<button class="btn-ghost sm" data-agent="${a.id}" data-role="admin">Make admin</button>`)}</td>
    </tr>`).join("");
  c.innerHTML = head + (list.length
    ? `<table class="data-tbl"><thead><tr><th>Agent</th><th>Role</th><th>Inbound</th><th>Forward #</th><th>Wallet</th><th>States</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="coming"><div class="badge"><i class="ti ti-users"></i></div><b>No agents yet</b><div>Share your signup link to onboard agents.</div></div>`);
  $("#invite-agent")?.addEventListener("click", async () => {
    let code = TENANT?.invite_code;
    if (!code) { try { code = (await sb.rpc("agency_invite_code")).data; } catch { } }
    const link = code ? `${location.origin}${location.pathname}?invite=${code}` : `${location.origin}${location.pathname}`;
    navigator.clipboard?.writeText(link); toast("Agent signup link copied");
  });
  c.querySelectorAll("[data-role]").forEach(b => b.addEventListener("click", () => setAgentRole(b.dataset.agent, b.dataset.role, b.textContent.trim())));
}
async function setAgentRole(agentId, role, label) {
  if (!confirm(`${label}?`)) return;
  const { error } = await sb.from("agents").update({ access_level: role }).eq("id", agentId);
  if (error) { alert(error.message); return; }
  toast("Role updated"); loadAgents();
}

// ---- Setup / onboarding checklist (admin console) ----
async function loadSetup() {
  const c = adminHost();
  const tid = activeTenantId();
  let t = (TENANT && TENANT.id === tid) ? TENANT : null;
  if (!t && tid) { try { t = (await sb.from("tenants").select("*").eq("id", tid).maybeSingle()).data; } catch { } }
  t = t || {}; const s = t.settings || {};
  const FN = "https://cdctxwbkpjdkytwstvoq.supabase.co/functions/v1";
  const routeUrl = `${FN}/trackdrive-inbound-route?tenant=${t.slug || ""}`;
  const postbackUrl = `${FN}/trackdrive-inbound-postback?tenant=${t.slug || ""}`;
  const inviteCode = t.invite_code || "";
  const inviteUrl = inviteCode ? `${location.origin}${location.pathname}?invite=${inviteCode}` : `${location.origin}${location.pathname}`;
  const brandOk = !!(t.logo_url && t.brand_name);
  const priceOk = s.call_price != null && s.call_price !== "";
  const stripeOk = !!t.stripe_account;
  const tdOk = !!t.trackdrive_ref;
  const pill = ok => ok ? `<span class="pill green">Done</span>` : `<span class="pill yellow">To do</span>`;
  const hdr = (icon, title, ok) => `<div class="pf-card-h2" style="display:flex;align-items:center;justify-content:space-between"><b><i class="ti ${icon}"></i> ${title}</b>${pill(ok)}</div>`;
  const done = [brandOk, priceOk, stripeOk, tdOk].filter(Boolean).length;
  c.innerHTML = `
    <div class="page-title">Setup</div><div class="page-sub">Get ${esc(t.brand_name || "your agency")} live — ${done}/4 essentials done.</div>
    <div class="setup-list">
      <div class="pf-card">${hdr("ti-photo", "Branding", brandOk)}
        <div class="setup-b"><div class="muted2">Your logo + name in the portal header.</div><button class="btn-ghost" data-goto="tenantsettings">Open branding</button></div></div>
      <div class="pf-card">${hdr("ti-coin", "Call price", priceOk)}
        <div class="setup-b"><div class="muted2">${priceOk ? "Charging " + money(s.call_price) + " per billable call." : "Set what a billable inbound call costs an agent."}</div><button class="btn-ghost" data-goto="tenantsettings">${priceOk ? "Edit price" : "Set price"}</button></div></div>
      <div class="pf-card">${hdr("ti-credit-card", "Payments (Stripe)", stripeOk)}
        <div class="setup-b"><div class="muted2">Connect your Stripe so agent wallets can be funded and charged. ${stripeOk ? "Connected." : "Set up together during onboarding — self-serve connect coming."}</div><button class="btn-gold" id="setup-stripe">${stripeOk ? "Reconnect Stripe" : "Connect Stripe"}</button></div></div>
      <div class="pf-card">${hdr("ti-phone", "Trackdrive routing", tdOk)}
        <div class="setup-b">
          <div class="muted2">Point your Trackdrive at these URLs (we'll wire this together on your onboarding call):</div>
          <div class="url-row"><span class="url-lab">Routing</span><code>${esc(routeUrl)}</code><button class="btn-ghost sm" data-copy="${esc(routeUrl)}"><i class="ti ti-copy"></i></button></div>
          <div class="url-row"><span class="url-lab">Call end</span><code>${esc(postbackUrl)}</code><button class="btn-ghost sm" data-copy="${esc(postbackUrl)}"><i class="ti ti-copy"></i></button></div>
          <div class="pf-grid" style="padding:8px 0 0"><div class="field"><label>Trackdrive account label</label><input class="in" id="setup-tdref" value="${esc(t.trackdrive_ref || "")}" placeholder="e.g. 1010-td"></div><div class="field" style="align-self:flex-end"><button class="btn-gold" id="setup-tdsave"><i class="ti ti-check"></i> Save &amp; mark configured</button></div></div>
        </div></div>
      <div class="pf-card">${hdr("ti-user-plus", "Invite agents", false).replace('class="pill yellow">To do', 'class="pill grey">Anytime')}
        <div class="setup-b">
          <div class="muted2" style="margin-bottom:6px">Share this link — anyone who signs up through it joins <b>${esc(t.brand_name || "your agency")}</b>. The code is what routes them to you, so keep it private.</div>
          <div class="url-row"><code>${esc(inviteUrl)}</code><button class="btn-ghost sm" data-copy="${esc(inviteUrl)}"><i class="ti ti-copy"></i></button></div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:8px"><span class="muted2">Invite code: <b>${esc(inviteCode || "—")}</b></span><button class="btn-ghost sm" id="setup-regen"><i class="ti ti-refresh"></i> Regenerate</button></div>
        </div></div>
    </div>`;
  c.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => go(b.dataset.goto)));
  c.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", () => { navigator.clipboard?.writeText(b.dataset.copy); toast("Copied"); }));
  $("#setup-stripe")?.addEventListener("click", () => toast("Stripe Connect — set up with the Arcane team during onboarding (self-serve connect coming)"));
  $("#setup-regen")?.addEventListener("click", async () => {
    if (!confirm("Regenerate the invite code? The old link will stop working.")) return;
    try { const code = (await sb.rpc("regenerate_invite_code")).data; if (TENANT && TENANT.id === tid) TENANT.invite_code = code; toast("New invite code generated"); loadSetup(); }
    catch (e) { toast(e.message || "Couldn't regenerate"); }
  });
  $("#setup-tdsave")?.addEventListener("click", async e => {
    const ref = $("#setup-tdref").value.trim() || null;
    e.target.disabled = true; e.target.textContent = "Saving…";
    const { error } = await sb.from("tenants").update({ trackdrive_ref: ref }).eq("id", tid);
    e.target.disabled = false;
    if (error) { e.target.textContent = "Retry"; alert(error.message); return; }
    if (TENANT && TENANT.id === tid) TENANT.trackdrive_ref = ref;
    toast("Saved"); loadSetup();
  });
}

// ---- Integrations ----
async function connectGoogle() {
  const { data } = await sb.auth.getSession();
  const tok = data?.session?.access_token;
  if (!tok) { alert("Please sign in again."); return; }
  window.location.href = `${SUPABASE_URL}/functions/v1/google-oauth-start?token=${encodeURIComponent(tok)}`;
}
async function connectGHL() {
  const { data } = await sb.auth.getSession();
  const tok = data?.session?.access_token;
  if (!tok) { alert("Please sign in again."); return; }
  window.location.href = `${SUPABASE_URL}/functions/v1/crm-oauth-start?token=${encodeURIComponent(tok)}`;
}
async function pfIntegrations() {
  const S = ME.settings || {}, ig = S.integrations || {};
  const ghlOn = !!(ME.ghl_api_key || ME.ghl_location_id);
  let sheets = [], typeName = {}, gEmail = null, gConnected = false, ghlConn = false;
  try { ghlConn = !!(await sb.rpc("ghl_connection_status")).data?.[0]?.connected; } catch { }
  try { sheets = (await sb.from("lead_sheets").select("*").eq("agent_id", ME.id).eq("active", true).order("created_at", { ascending: false })).data || []; } catch {}
  try { (await sb.from("lead_types").select("id,name")).data?.forEach(t => { typeName[t.id] = t.name; }); } catch {}
  try { const st = (await sb.rpc("google_calendar_status")).data?.[0]; gConnected = !!st?.connected; gEmail = st?.google_email || null; } catch {}
  const sheetRows = sheets.length ? sheets.map(s => `<div class="pf-int-row" style="align-items:flex-start">
      <div><a href="${esc(s.spreadsheet_url || "#")}" target="_blank" class="lp-link">${esc(s.name || "Untitled sheet")}</a>
        <span class="pf-pill-status">${esc(typeName[s.lead_type_id] || "Any type")}</span>${s.is_default ? ` <span class="pf-pill-status ok">Default</span>` : ""}
        <div class="muted2" style="margin-top:3px">Shared: ${esc((s.shared_emails || []).join(", ") || "—")}</div></div>
    </div>`).join("") : `<div class="pf-int-row muted2">No sheets yet — add one to auto-deliver leads.</div>`;
  $("#pf-body").innerHTML = `
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-forms"></i> Fields Provided By Lead Type</b><span>Manage your custom integration options</span></div>
      <div class="pf-fieldpills">${PF_LEAD_FIELDS.map(f => `<span class="pf-fieldpill" data-lt="${esc(f)}">${f} Lead Fields <i class="ti ti-eye"></i></span>`).join("")}</div>
    </div>
    <div class="pf-card"><div class="pf-int-h"><div><b><i class="ti ti-table"></i> Google Sheets Integration</b><span>Auto-create a sheet, share it, and deliver leads to it</span></div><button class="btn-gold pf-int-btn" id="sh-add"><i class="ti ti-plus"></i> Add Google Sheet</button></div>
      ${sheetRows}</div>
    <div class="pf-card"><div class="pf-int-h"><div><b><i class="ti ti-webhook"></i> Webhook URL Integration</b><span>Send lead data to your custom endpoint</span></div><button class="btn-ghost pf-int-btn" id="pf-wh-save">Update Webhook</button></div>
      <div class="pf-int-row" style="display:block"><input class="in" id="pf-wh" value="${esc(ig.webhook || "")}" placeholder="https://hook.example.com/..."></div></div>
    <div class="pf-card"><div class="pf-int-h"><div><b><i class="ti ti-bolt"></i> Go High Level Integration</b><span>Sync leads with Go High Level CRM</span></div><button class="btn-gold pf-int-btn" id="ghl-connect">${ghlConn || ghlOn ? "Reconnect GHL" : "Connect GHL"}</button></div>
      <div class="pf-int-row">Status <span class="pf-pill-status ${ghlConn || ghlOn ? "ok" : ""}">${ghlConn ? "Connected via OAuth" : (ME.ghl_api_key ? "Connected (legacy API key)" : "Not connected")}</span></div></div>
    <div class="pf-card"><div class="pf-int-h"><div><b><i class="ti ti-brand-google"></i> Google (Calendar + Sheets)</b><span>${gConnected ? "Connected" + (gEmail ? " as " + esc(gEmail) : "") : "Connect to enable calendar sync + sheet delivery"}</span></div><button class="btn-gold pf-int-btn" id="g-connect">${gConnected ? "Reconnect" : "Connect Google"}</button></div>
      <div class="pf-int-row">Status <span class="pf-pill-status ${gConnected ? "ok" : ""}">${gConnected ? "Connected" : "Not connected"}</span></div></div>`;
  $("#sh-add").addEventListener("click", openSheetModal);
  $("#g-connect").addEventListener("click", connectGoogle);
  $("#ghl-connect")?.addEventListener("click", connectGHL);
  $("#pf-wh-save").addEventListener("click", e => pfPersist(null, { integrations: { ...ig, webhook: $("#pf-wh").value.trim() || null } }, e.target));
  $("#pf-body").querySelectorAll(".pf-fieldpill").forEach(p => p.addEventListener("click", () => pfFieldsModal(p.dataset.lt)));
}
function openSheetModal() {
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal" style="width:430px"><div class="modal-h"><span><i class="ti ti-table" style="color:var(--gold)"></i> New Google Sheet</span><i class="ti ti-x" id="sh-x" style="cursor:pointer;color:var(--tx3)"></i></div>
    <div class="modal-b">
      <div class="field"><label>Sheet name</label><input class="in" id="sh-name" placeholder="e.g. Sydney – MP Leads"></div>
      <div class="field"><label>Lead type</label>${_sel("sh-type", PF_LEAD_FIELDS, "Mortgage Protection")}</div>
      <div class="field"><label>Share with (emails, comma-separated)</label><input class="in" id="sh-emails" placeholder="client@x.com, buyer@x.com"></div>
      <label class="cbx" id="sh-default" style="margin-top:4px"><span class="box"><i class="ti ti-check"></i></span>Make this the default sheet for this lead type</label>
      <div id="sh-err" style="color:var(--red);font-size:12px;min-height:14px;margin-top:8px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn-ghost" id="sh-cancel">Cancel</button><button class="btn-gold" id="sh-create"><i class="ti ti-plus"></i> Create &amp; share</button></div>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $("#sh-x").addEventListener("click", close); $("#sh-cancel").addEventListener("click", close);
  $("#sh-default").addEventListener("click", () => $("#sh-default").classList.toggle("on"));
  $("#sh-create").addEventListener("click", async e => {
    const btn = e.target; btn.disabled = true; const o = btn.textContent; btn.textContent = "Creating…";
    const emails = $("#sh-emails").value.split(",").map(s => s.trim()).filter(Boolean);
    let res;
    try { res = await sb.functions.invoke("create-lead-sheet", { body: { name: $("#sh-name").value.trim(), lead_type: $("#sh-type").value, share_emails: emails, is_default: $("#sh-default").classList.contains("on") } }); }
    catch (err) { res = { error: err }; }
    btn.disabled = false; btn.textContent = o;
    if (res?.error || !res?.data?.ok) {
      let msg = res?.data?.error || res?.error?.message || "unknown error";
      try { if (res?.error?.context?.json) { const b = await res.error.context.json(); if (b?.error) msg = b.error; } } catch {}
      $("#sh-err").textContent = "Failed: " + msg;
      return;
    }
    close(); pfIntegrations();
  });
}

// ---- Tags ----
function pfTags() {
  const S = ME.settings || {}, custom = Array.isArray(S.custom_tags) ? S.custom_tags : [];
  $("#pf-body").innerHTML = `
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-tag"></i> Tag Library</b><span>System tags are shared. Your tags are editable.</span></div>
      <div style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="np-lab" style="margin-bottom:0">Your Tags</div><span class="muted2">${custom.length} custom tag${custom.length !== 1 ? "s" : ""}</span></div>
        <div class="pf-tag-add"><input class="in" id="pf-tag-in" placeholder="New tag name"><button class="btn-gold" id="pf-tag-add"><i class="ti ti-plus"></i> Add Tag</button></div>
        <div id="pf-tag-list">${custom.length ? custom.map(t => `<div class="pf-tagrow"><span class="lp-tag">${esc(t)}</span><i class="ti ti-trash" data-del="${esc(t)}"></i></div>`).join("") : `<div class="muted2" style="padding:10px 0">No custom tags yet.</div>`}</div>
        <div class="np-lab" style="margin-top:20px">System Tags <span class="muted2" style="font-weight:400;text-transform:none;letter-spacing:0">— standard tags available across the account</span></div>
        <div id="pf-systags">${PF_SYSTEM_TAGS.map(t => `<div class="pf-tagrow"><span class="lp-tag">${esc(t)}</span><span class="pf-sys">System</span></div>`).join("")}</div>
      </div>
    </div>`;
  const addTag = async () => { const t = $("#pf-tag-in").value.trim(); if (!t) return; if (custom.some(x => x.toLowerCase() === t.toLowerCase())) { $("#pf-tag-in").value = ""; return; } await pfPersist(null, { custom_tags: [...custom, t] }); pfTags(); };
  $("#pf-tag-add").addEventListener("click", addTag);
  $("#pf-tag-in").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } });
  $("#pf-body").querySelectorAll("[data-del]").forEach(x => x.addEventListener("click", async () => { await pfPersist(null, { custom_tags: custom.filter(t => t !== x.dataset.del) }); pfTags(); }));
}

// ---- Lead Receipts ----
async function pfReceipts() {
  const b = $("#pf-body"); b.innerHTML = `<div class="coming"><span class="spin"></span></div>`;
  let rows = [];
  try { rows = (await sb.from("lead_sales").select("sold_at,tier_name,price_paid,lead_id,channel,receipt_url,leads(first_name,last_name)").eq("agent_id", ME.id).order("sold_at", { ascending: false })).data || []; }
  catch { try { rows = (await sb.from("lead_sales").select("sold_at,tier_name,price_paid,lead_id,channel,leads(first_name,last_name)").eq("agent_id", ME.id).order("sold_at", { ascending: false })).data || []; } catch { rows = []; } }
  const total = rows.reduce((s, r) => s + (Number(r.price_paid) || 0), 0);
  b.innerHTML = `
    <div class="pf-numgrid">
      <div class="pf-num"><span class="ic ic-green"><i class="ti ti-receipt"></i></span><div><div class="lab">Total receipts</div><div class="val num">${money2(total)}</div></div></div>
      <div class="pf-num"><span class="ic ic-blue"><i class="ti ti-list"></i></span><div><div class="lab">Count</div><div class="val num">${rows.length}</div></div></div>
    </div>
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-receipt"></i> Lead Receipts</b><span>One row per lead you've purchased</span></div>
      <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Received</th><th>Lead</th><th>Type</th><th>Channel</th><th class="num">Amount</th><th>Receipt</th></tr></thead>
        <tbody>${rows.length ? rows.map(r => `<tr>
          <td class="num" style="color:var(--tx3);white-space:nowrap">${r.sold_at ? new Date(r.sold_at).toLocaleString() : "—"}</td>
          <td style="white-space:nowrap">${esc(`${r.leads?.first_name || ""} ${r.leads?.last_name || ""}`.trim() || "—")}</td>
          <td>${esc(r.tier_name || "—")}</td><td style="text-transform:capitalize">${esc(r.channel || "—")}</td>
          <td class="num">${money2(r.price_paid)}</td>
          <td>${r.receipt_url ? `<a href="${esc(r.receipt_url)}" target="_blank" class="lp-link"><i class="ti ti-external-link"></i> View</a>` : `<span class="muted2">—</span>`}</td></tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--tx3);padding:34px">No lead receipts yet.</td></tr>`}</tbody>
      </table></div></div>`;
}

// ---- Subscriptions ----
async function pfSubscriptions() {
  const b = $("#pf-body");
  const banner = `<div class="pf-banner amber"><b>Important:</b> Pausing billing stops future charges until the selected resume date. It does not pause lead delivery for leads already owed. Canceling stops future renewals, but owed leads can continue until the order is fulfilled.</div>`;
  b.innerHTML = banner + `<div class="coming"><span class="spin"></span></div>`;
  let subs = [];
  try { subs = (await sb.from("subscriptions").select("*").eq("agent_id", ME.id).order("created_at", { ascending: false })).data || []; } catch { subs = []; }
  const active = subs.filter(s => s.status === "active").length;
  const paused = subs.filter(s => s.status === "paused").length;
  const weekly = subs.filter(s => s.status !== "canceled").reduce((a, s) => a + (Number(s.weekly_amount) || 0), 0);
  const sBadge = st => { const c = st === "active" ? "b-green" : st === "paused" ? "b-amber" : "b-red"; return `<span class="badge2 ${c}" style="text-transform:capitalize">${esc(st || "—")}</span>`; };
  b.innerHTML = banner + `
    <div class="pf-numgrid four">
      <div class="pf-num"><span class="ic ic-blue"><i class="ti ti-refresh"></i></span><div><div class="lab">Active subscriptions</div><div class="val num">${active}</div><div class="muted2">${active} billing active, ${paused} billing paused</div></div></div>
      <div class="pf-num"><span class="ic ic-green"><i class="ti ti-coin"></i></span><div><div class="lab">Weekly commitment</div><div class="val num">${money2(weekly)}</div></div></div>
      <div class="pf-num"><span class="ic ic-purple"><i class="ti ti-shield"></i></span><div><div class="lab">Renewal gate</div><div class="val num">3</div><div class="muted2">3 renewals before pause or cancel</div></div></div>
      <div class="pf-num"><span class="ic ic-amber"><i class="ti ti-truck"></i></span><div><div class="lab">Lead delivery</div><div class="val num">On</div><div class="muted2">Billing pause does not stop owed leads</div></div></div>
    </div>
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-refresh"></i> Subscriptions</b><span>${subs.length} subscription${subs.length !== 1 ? "s" : ""}</span></div>
      <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Date</th><th>Subscription</th><th class="num">Weekly amount</th><th>Renewals</th><th>Status</th></tr></thead>
        <tbody>${subs.length ? subs.map(s => `<tr>
          <td class="num" style="color:var(--tx3);white-space:nowrap">${s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}</td>
          <td style="white-space:nowrap">${esc(s.name || "Weekly lead subscription")}</td>
          <td class="num">${money2(s.weekly_amount)}</td><td class="num">${s.renewals ?? 0}</td>
          <td>${sBadge(s.status)}</td></tr>`).join("") : `<tr><td colspan="5" style="text-align:center;color:var(--tx3);padding:44px"><i class="ti ti-filter" style="font-size:22px;display:block;margin-bottom:8px;opacity:.5"></i>No data to display<div class="muted2" style="margin-top:4px">Your weekly subscriptions appear here once you have them.</div></td></tr>`}</tbody>
      </table></div></div>`;
}

// ---- Preferences ----
function pfPreferences() {
  const S = ME.settings || {}, pr = S.preferences || {};
  $("#pf-body").innerHTML = `
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-clock"></i> Messaging and Calling Preferences</b><span>Set reasonable hours to contact leads based on their local time zone</span></div>
      <div class="pf-grid">
        ${_f("Earliest (Lead's Time)", _sel("pr-early", PF_HOURS, pr.earliest ?? "9"))}
        ${_f("Latest (Lead's Time)", _sel("pr-late", PF_HOURS, pr.latest ?? "21"))}
      </div>
    </div>
    <div class="pf-actions"><button class="btn-gold" id="pf-save"><i class="ti ti-check"></i> Save</button></div>`;
  $("#pf-save").addEventListener("click", e => pfPersist(null, { preferences: { earliest: $("#pr-early").value, latest: $("#pr-late").value } }, e.target));
}

// ---- Notes ----
function pfNotes() {
  const S = ME.settings || {};
  $("#pf-body").innerHTML = `
    <div class="pf-card"><div class="pf-card-h2"><b><i class="ti ti-note"></i> Notes</b><span>Private notes for your account</span></div>
      <div style="padding:16px"><textarea class="in" id="pf-notes" rows="8" placeholder="Jot anything you want to remember…">${esc(S.notes || "")}</textarea></div>
    </div>
    <div class="pf-actions"><button class="btn-gold" id="pf-save"><i class="ti ti-check"></i> Save</button></div>`;
  $("#pf-save").addEventListener("click", e => pfPersist(null, { notes: $("#pf-notes").value.trim() || null }, e.target));
}

// ---------------------------------------------------------------- calendar
async function loadCalendar() {
  const c = $("#content"), now = new Date(), y = now.getFullYear(), mo = now.getMonth();
  c.innerHTML = `<div class="page-title">My calendar</div><div class="coming"><span class="spin"></span></div>`;
  let appts = [], gConnected = false;
  try { appts = (await sb.from("lead_appointments").select("id,title,starts_at,notes,lead_id,leads(first_name,last_name)").eq("agent_id", ME.id).order("starts_at", { ascending: true })).data || []; } catch { }
  try { gConnected = !!(await sb.rpc("google_calendar_status")).data?.[0]?.connected; } catch { }
  // appointments in the current month, keyed by day
  const byDay = {};
  appts.forEach(a => { const d = new Date(a.starts_at); if (d.getFullYear() === y && d.getMonth() === mo) (byDay[d.getDate()] = byDay[d.getDate()] || []).push(a); });
  const first = new Date(y, mo, 1).getDay(), days = new Date(y, mo + 1, 0).getDate(), today = now.getDate();
  const evName = a => { const n = `${a.leads?.first_name || ""} ${(a.leads?.last_name || "").slice(0, 1)}`.trim(); return n || a.title || "Appt"; };
  const evTime = a => new Date(a.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  let cells = "";
  for (let i = 0; i < first; i++) cells += `<div class="cal-cell out"></div>`;
  for (let d = 1; d <= days; d++) {
    const da = (byDay[d] || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const chips = da.slice(0, 3).map(a => `<div class="cal-ev" data-appt="${a.lead_id}" title="${esc(evTime(a) + " · " + ((a.leads?.first_name || "") + " " + (a.leads?.last_name || "")).trim() + (a.title ? " — " + a.title : ""))}"><b>${esc(evTime(a))}</b> ${esc(evName(a))}</div>`).join("");
    const more = da.length > 3 ? `<div class="cal-more">+${da.length - 3} more</div>` : "";
    cells += `<div class="cal-cell ${d === today ? "today" : ""}"><div class="cal-num">${d}</div>${chips}${more}</div>`;
  }
  const upcoming = appts.filter(a => new Date(a.starts_at) >= new Date(Date.now() - 3600000)).slice(0, 12);
  const apptName = a => `${a.leads?.first_name || ""} ${a.leads?.last_name || ""}`.trim() || a.title || "Appointment";
  c.innerHTML = `
    <div class="page-title">My calendar</div><div class="page-sub">${now.toLocaleString(undefined, { month: "long", year: "numeric" })}</div>
    <div class="cal">
      <div class="tbl-wrap" style="padding:16px">
        <div class="cal-dow">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<span>${d}</span>`).join("")}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="tbl-wrap" style="padding:14px;align-self:start">
        <div class="np-lab">Upcoming</div>
        ${upcoming.length ? upcoming.map(a => `<div class="cal-appt"><div class="cal-appt-d">${new Date(a.starts_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div><div>${esc(apptName(a))}</div>${a.title && a.title !== "Appointment" ? `<div class="muted2">${esc(a.title)}</div>` : ""}</div>`).join("") : `<div class="muted2" style="padding:6px 0 12px">No upcoming appointments.</div>`}
        <button class="btn-soft btn-block" id="cal-connect" style="justify-content:center;margin-top:10px"><i class="ti ti-${gConnected ? "circle-check" : "calendar-plus"}"></i> ${gConnected ? "Google Calendar connected" : "Connect calendar"}</button>
      </div>
    </div>`;
  $("#cal-connect").addEventListener("click", () => { if (!gConnected) connectGoogle(); });
  c.querySelectorAll(".cal-ev[data-appt]").forEach(el => el.addEventListener("click", () => { if (el.dataset.appt) openLeadPanel(el.dataset.appt); }));
}

// ---------------------------------------------------------------- tasks
async function loadTasks() {
  const c = $("#content");
  c.innerHTML = `<div class="page-title">Tasks</div><div class="page-sub">Your open tasks.</div><div class="coming"><span class="spin"></span></div>`;
  let tasks = [];
  try { tasks = (await sb.from("tasks").select("*").eq("agent_id", ME.id).order("due_at", { ascending: true })).data || []; } catch { tasks = []; }
  renderTasks(tasks);
}
function renderTasks(tasks) {
  const c = $("#content");
  c.innerHTML = `
    <div class="pagehead"><div><div class="page-title">Tasks</div><div class="page-sub">${tasks.length} task${tasks.length !== 1 ? "s" : ""}.</div></div><div style="flex:1"></div><button class="btn-gold" id="new-task"><i class="ti ti-plus"></i> New task</button></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Due</th><th>Task</th><th>Priority</th><th>Status</th></tr></thead>
      <tbody>${tasks.length ? tasks.map(t => `<tr>
        <td class="num" style="color:var(--tx3)">${t.due_at ? new Date(t.due_at).toLocaleDateString() : "—"}</td>
        <td style="font-weight:500">${esc(t.title || t.task || "—")}</td>
        <td style="text-transform:capitalize">${esc(t.priority || "normal")}</td>
        <td style="text-transform:capitalize">${esc(t.status || "open")}</td>
      </tr>`).join("") : `<tr><td colspan="4" style="text-align:center;color:var(--tx3);padding:32px">No tasks yet.</td></tr>`}</tbody>
    </table></div>`;
  $("#new-task").addEventListener("click", openTaskModal);
}
let TASK_LEAD = null;
function openTaskModal(presetLead = null) {
  TASK_LEAD = presetLead;
  const m = document.createElement("div");
  m.className = "modal-bg";
  m.innerHTML = `<div class="modal" style="width:390px"><div class="modal-h"><span><i class="ti ti-checkbox" style="color:var(--gold)"></i> New task</span><i class="ti ti-x" id="tm-x" style="cursor:pointer;color:var(--tx3)"></i></div>
    <div class="modal-b">
      <div class="field"><label>Task</label><input class="in" id="tm-title" placeholder="What needs to be done?"></div>
      <div class="field"><label>Due</label><input class="in" id="tm-due" type="date"></div>
      <div class="field"><label>Priority</label><select class="in" id="tm-pri"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div>
      <div class="field"><label>Notifications</label><div class="cbx-row" id="tm-notif">
        <span class="cbx" data-tn="sms"><span class="box"><i class="ti ti-check"></i></span>SMS</span>
        <span class="cbx on" data-tn="email"><span class="box"><i class="ti ti-check"></i></span>Email</span>
        <span class="cbx on" data-tn="app"><span class="box"><i class="ti ti-check"></i></span>In-app</span>
      </div></div>
      <div class="field"><label>Notes</label><textarea class="in" id="tm-notes" placeholder="Optional details…"></textarea></div>
      <div class="field lead-res"><label>Link a lead</label><input class="in" id="tm-lead" placeholder="Type to search name, phone, email…" autocomplete="off"><div class="lead-res-list" id="tm-lead-res"></div><div id="tm-lead-sel"></div></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px"><button class="btn-ghost" id="tm-cancel">Cancel</button><button class="btn-gold" id="tm-create">Create task</button></div>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $("#tm-x").addEventListener("click", close); $("#tm-cancel").addEventListener("click", close);
  m.querySelectorAll(".cbx[data-tn]").forEach(el => el.addEventListener("click", () => el.classList.toggle("on")));
  if (presetLead) {
    $("#tm-lead-sel").innerHTML = `<span class="lead-sel">${esc(presetLead.name)} <i class="ti ti-x" id="tm-lead-clear"></i></span>`;
    $("#tm-lead-clear").addEventListener("click", () => { TASK_LEAD = null; $("#tm-lead-sel").innerHTML = ""; });
  }

  const res = $("#tm-lead-res");
  $("#tm-lead").addEventListener("input", async e => {
    const q = e.target.value.trim().toLowerCase();
    if (q.length < 2) { res.classList.remove("open"); return; }
    if (!LEADS_DATA.length) { try { LEADS_DATA = (await sb.rpc("agent_leads_smartlisted", { p_agent: ME.id })).data || []; } catch { } }
    const matches = LEADS_DATA.filter(l => `${l.first_name || ""} ${l.last_name || ""} ${l.phone || ""} ${l.email || ""}`.toLowerCase().includes(q)).slice(0, 6);
    res.innerHTML = matches.length ? matches.map(l => `<div class="lead-res-item" data-lid="${l.lead_id}" data-nm="${esc((l.first_name || "") + " " + (l.last_name || ""))}">${esc(l.first_name || "")} ${esc(l.last_name || "")} <span class="muted2">${esc(l.phone || "")}</span></div>`).join("") : `<div class="lead-res-item muted2">No matching leads</div>`;
    res.classList.add("open");
  });
  res.addEventListener("click", e => {
    const it = e.target.closest(".lead-res-item"); if (!it || !it.dataset.lid) return;
    TASK_LEAD = { id: it.dataset.lid, name: it.dataset.nm };
    res.classList.remove("open"); $("#tm-lead").value = "";
    $("#tm-lead-sel").innerHTML = `<span class="lead-sel">${esc(TASK_LEAD.name)} <i class="ti ti-x" id="tm-lead-clear"></i></span>`;
    $("#tm-lead-clear").addEventListener("click", () => { TASK_LEAD = null; $("#tm-lead-sel").innerHTML = ""; });
  });

  $("#tm-create").addEventListener("click", async () => {
    const title = $("#tm-title").value.trim(); if (!title) return;
    const row = { agent_id: ME.id, title, due_at: $("#tm-due").value || null, priority: $("#tm-pri").value, status: "open", notes: $("#tm-notes").value.trim() || null };
    if (TASK_LEAD) row.lead_id = TASK_LEAD.id;
    try { await sb.from("tasks").insert(row); } catch (e) { }
    close(); loadTasks();
  });
}

// ---------------------------------------------------------------- aged store
async function loadAged() {
  const c = $("#content");
  c.innerHTML = `<div class="page-title">Aged lead store</div><div class="page-sub">Discounted aged leads by state.</div><div class="coming"><span class="spin"></span></div>`;
  if (!CATALOG) { try { CATALOG = (await sb.from("lead_types").select("*, lead_verticals(name)").eq("is_active", true).order("sort_order")).data || []; } catch { CATALOG = []; } }
  let avail = []; try { avail = (await sb.rpc("claimable_leads")).data || []; } catch { avail = []; }
  const byState = {}; avail.forEach(r => { byState[r.state] = (byState[r.state] || 0) + (r.available || 0); });
  const states = Object.entries(byState).sort((a, b) => b[1] - a[1]);
  const price = CATALOG[0] ? Number(CATALOG[0].aged_price) || 0 : 0;
  const max = states.length ? states[0][1] : 1;
  c.innerHTML = `
    <div class="page-title">Aged lead store</div><div class="page-sub">Discounted aged leads · ${money(price)}/lead.</div>
    ${states.length ? `<div style="display:flex;flex-direction:column;gap:8px;max-width:700px">${states.map(([st, n]) => `
      <div class="cart-item" style="padding:11px 15px">
        <div style="display:flex;align-items:center;gap:14px;flex:1"><b style="width:48px">${esc(st)}</b><div class="bar" style="flex:1;max-width:280px"><i style="width:${Math.round(n / max * 100)}%;background:var(--gold)"></i></div><span class="num muted2">${n} available</span></div>
        <button class="btn-gold" style="padding:6px 13px" data-aged="${esc(st)}" data-n="${n}">Add 20</button>
      </div>`).join("")}</div>` : `<div class="coming"><div class="badge"><i class="ti ti-clock-hour-4"></i></div><b>No aged inventory yet</b><div>Aged leads appear here as fresh leads age past the threshold.</div></div>`}`;
  c.querySelectorAll("[data-aged]").forEach(b => b.addEventListener("click", () => {
    const st = b.dataset.aged, qty = Math.min(20, parseInt(b.dataset.n) || 20);
    CART.push({ name: CATALOG[0]?.name || "Premium", vertical: CATALOG[0]?.lead_verticals?.name || "Mortgage Protection", channel: "Aged", qty, price, total: qty * price, states: [st], days: [], maxPerDay: qty, sub: false, deliver: "Portal only", delivery: { ghl: false, webhook: "" }, notif: {}, thankyou: {} });
    updateCartCount();
    go("cart");
  }));
}

// ---------------------------------------------------------------- lead orders (list)
function loadOrdersList() {
  const c = $("#content");
  c.innerHTML = `
    <div class="page-title">Lead orders</div><div class="page-sub">Your active and past orders — they appear here as you place them.</div>
    <div class="tbl-wrap"><div style="overflow-x:auto"><table class="tbl">
      <thead><tr><th>Order #</th><th>Order date</th><th>Last delivered</th><th>Lead type</th><th>States</th><th class="num">Delivered</th><th>Status</th></tr></thead>
      <tbody><tr><td colspan="7" style="text-align:center;color:var(--tx3);padding:46px 20px">
        <div class="badge" style="display:inline-flex;margin-bottom:12px"><i class="ti ti-shopping-cart"></i></div><br>
        No orders yet — place an order to start receiving leads.<br>
        <button class="btn-gold" data-route="order" style="margin-top:14px"><i class="ti ti-bolt"></i> Order leads</button>
      </td></tr></tbody>
    </table></div></div>`;
  bindRoutes(c);
}

// ---------------------------------------------------------------- admin: pricing & tiers
let ADMIN_LEAD_TYPE = null;
async function loadAdminTiers() {
  const c = adminHost();
  if (ME.access_level !== "admin" && !ME.is_platform_admin) { c.innerHTML = `<div class="coming"><div class="badge"><i class="ti ti-lock"></i></div><b>Admins only</b><div>You don't have access to this page.</div></div>`; return; }
  c.innerHTML = `<div class="page-title">Pricing &amp; tiers</div><div class="page-sub">Configure pricing.</div><div class="coming"><span class="spin"></span></div>`;
  const tid = activeTenantId();
  let tiers = [], tenant = null;
  try { tiers = (await sb.from("lead_tiers").select("*, lead_types(name)").eq("tenant_id", tid).order("sort_order")).data || []; } catch (e) { }
  try { tenant = (TENANT && TENANT.id === tid) ? TENANT : (await sb.from("tenants").select("id,slug,settings").eq("id", tid).maybeSingle()).data; } catch (e) { }
  ADMIN_LEAD_TYPE = tiers[0]?.lead_type_id || null;
  if (!ADMIN_LEAD_TYPE) { try { ADMIN_LEAD_TYPE = (await sb.from("lead_types").select("id").eq("tenant_id", tid).order("sort_order").limit(1).maybeSingle()).data?.id || null; } catch (e) { } }
  renderAdminTiers(tiers, tenant);
}
function renderAdminTiers(tiers, tenant) {
  const c = adminHost();
  const inS = "padding:7px 9px";
  const s = (tenant && tenant.settings) || {};
  c.innerHTML = `
    <div class="pagehead"><div><div class="page-title">Pricing &amp; tiers</div><div class="page-sub">Set your inbound call price and lead-tier pricing.</div></div><div style="flex:1"></div><button class="btn-soft" id="add-tier"><i class="ti ti-plus"></i> Add tier</button></div>
    <div class="pf-card" style="max-width:540px;margin:2px 0 18px"><div class="pf-card-h2"><b><i class="ti ti-phone-incoming"></i> Inbound call pricing</b><span>What a billable inbound call costs an agent</span></div>
      <div class="pf-grid">
        ${_f("Call price ($)", _i("cp-price", s.call_price, "e.g. 30", "number"))}${_f("Billable after (seconds)", _i("cp-threshold", s.billable_threshold_sec ?? 90, "90", "number"))}
      </div>
      <div style="padding:0 16px 14px;display:flex;justify-content:flex-end"><button class="btn-gold" id="cp-save"><i class="ti ti-check"></i> Save call pricing</button></div>
    </div>
    <div class="nav-sec" style="margin:2px 0 8px">Lead tiers</div>
    <div id="tier-err" style="color:var(--red);font-size:12.5px;min-height:16px;margin-bottom:6px"></div>
    <div class="tbl-wrap"><div style="overflow-x:auto"><table class="tbl">
      <thead><tr><th>Tier</th><th>Type</th><th class="num">Max age (days)</th><th class="num">Price</th><th class="num">Agents at once</th><th></th></tr></thead>
      <tbody>${tiers.length ? tiers.map(t => `<tr data-id="${t.id}" data-type="${t.lead_type_id}">
        <td><input class="in tr-name" value="${esc(t.name)}" style="width:130px;${inS}"></td>
        <td><select class="in tr-channel" style="width:110px;${inS}"><option value="realtime" ${t.channel === "realtime" ? "selected" : ""}>Realtime</option><option value="aged" ${t.channel !== "realtime" ? "selected" : ""}>Aged</option></select></td>
        <td class="num"><input class="in tr-age" type="number" value="${t.max_age_days}" style="width:94px;${inS}"></td>
        <td class="num"><input class="in tr-price" type="number" step="0.01" value="${t.price}" style="width:94px;${inS}"></td>
        <td class="num"><input class="in tr-conc" type="number" min="1" value="${t.max_concurrent_owners}" style="width:80px;${inS}"></td>
        <td><button class="btn-gold" style="padding:7px 14px" data-save>Save</button></td>
      </tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--tx3);padding:34px">No tiers yet — run migrations 162–164, then add one.</td></tr>`}</tbody>
    </table></div></div>`;
  c.querySelectorAll("[data-save]").forEach(b => b.addEventListener("click", () => saveTier(b)));
  $("#add-tier").addEventListener("click", openTierModal);
  $("#cp-save")?.addEventListener("click", e => saveCallPricing(tenant?.id || activeTenantId(), s, e.target));
}
async function saveCallPricing(tenantId, curSettings, btn) {
  const priceRaw = $("#cp-price").value.trim(), thrRaw = $("#cp-threshold").value.trim();
  const settings = { ...(curSettings || {}), call_price: priceRaw === "" ? null : Number(priceRaw), billable_threshold_sec: thrRaw === "" ? 90 : Number(thrRaw) };
  btn.disabled = true; btn.textContent = "Saving…";
  const { error } = await sb.from("tenants").update({ settings }).eq("id", tenantId);
  btn.disabled = false; btn.textContent = error ? "Retry" : "Saved ✓";
  if (error) { alert(error.message); return; }
  if (TENANT && TENANT.id === tenantId) TENANT.settings = settings;
  setTimeout(() => { btn.textContent = "Save call pricing"; }, 1500);
}
async function saveTier(btn) {
  const tr = btn.closest("tr");
  const num = sel => { const s = tr.querySelector(sel).value.trim(); return s === "" ? null : Number(s); };
  btn.disabled = true; btn.textContent = "Saving…";
  const { error } = await sb.rpc("upsert_lead_tier", {
    p_id: tr.dataset.id, p_lead_type: tr.dataset.type, p_name: tr.querySelector(".tr-name").value.trim(),
    p_max_age: num(".tr-age"), p_price: num(".tr-price"), p_cap: num(".tr-conc"),
    p_sort: null, p_channel: tr.querySelector(".tr-channel").value,
  });
  btn.disabled = false;
  if (error) { btn.textContent = "Retry"; $("#tier-err").textContent = error.message; }
  else { btn.textContent = "Saved ✓"; setTimeout(() => { btn.textContent = "Save"; }, 1500); }
}
function openTierModal() {
  if (!ADMIN_LEAD_TYPE) { $("#tier-err").textContent = "No lead type found — run migrations 161–163 first."; return; }
  const m = document.createElement("div");
  m.className = "modal-bg";
  m.innerHTML = `<div class="modal" style="width:380px"><div class="modal-h"><span><i class="ti ti-stack-2" style="color:var(--gold)"></i> New tier</span><i class="ti ti-x" id="nt-x" style="cursor:pointer;color:var(--tx3)"></i></div>
    <div class="modal-b">
      <div class="field"><label>Tier name</label><input class="in" id="nt-name" placeholder="e.g. Fresh" autocomplete="off"></div>
      <div class="field"><label>Type</label><select class="in" id="nt-channel"><option value="realtime">Realtime</option><option value="aged" selected>Aged</option></select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>Max age (days)</label><input class="in" id="nt-age" type="number" value="30"></div>
        <div class="field"><label>Price</label><input class="in" id="nt-price" type="number" step="0.01" value="0"></div>
      </div>
      <div class="field"><label>Agents at once</label><input class="in" id="nt-conc" type="number" min="1" value="1"></div>
      <div id="nt-err" style="color:var(--red);font-size:12px;min-height:14px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:2px"><button class="btn-ghost" id="nt-cancel">Cancel</button><button class="btn-gold" id="nt-create">Create tier</button></div>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $("#nt-x").addEventListener("click", close); $("#nt-cancel").addEventListener("click", close);
  $("#nt-name").focus();
  $("#nt-create").addEventListener("click", async () => {
    const name = $("#nt-name").value.trim(); if (!name) { $("#nt-err").textContent = "Name is required."; return; }
    const num = id => { const s = $(id).value.trim(); return s === "" ? null : Number(s); };
    const btn = $("#nt-create"); btn.disabled = true; btn.textContent = "Creating…";
    const { error } = await sb.rpc("upsert_lead_tier", {
      p_id: null, p_lead_type: ADMIN_LEAD_TYPE, p_name: name,
      p_max_age: num("#nt-age"), p_price: num("#nt-price"), p_cap: num("#nt-conc"),
      p_sort: 99, p_channel: $("#nt-channel").value,
    });
    if (error) { btn.disabled = false; btn.textContent = "Create tier"; $("#nt-err").textContent = error.message; return; }
    close(); loadAdminTiers();
  });
}

// ---------------------------------------------------------------- lead profile panel
let LEAD_PANEL = null, LP_TAB = "details";
let LP_HIDE = { contact: false, data: false }, LP_EDIT = { contact: false, data: false };
const pretty = s => String(s || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

// Fixed field set for the contact panel. `col` = a leads column; `keys` = candidate
// intake jsonb keys (first existing match wins). Intake will be reworked later — when
// it is, just update the keys here. type drives display + edit input.
const F_CONTACT = [
  { lab: "Name", split: true, get: l => `${l.first_name || ""} ${l.last_name || ""}`.trim() },
  { lab: "Phone", col: "phone", type: "phone" },
  { lab: "Email", col: "email", type: "email" },
  { lab: "State", col: "state" },
  { lab: "DOB", col: "date_of_birth", type: "date" },
  { lab: "Age", col: "age", type: "number" },
  { lab: "Gender", col: "gender" },
  { lab: "Marital Status", keys: ["marital_status", "marital", "maritalstatus"] },
  { lab: "Preferred Contact Time", keys: ["preferred_contact_time", "best_time_to_call", "preferred_time", "contact_time"] },
];
const F_DATA = [
  { lab: "Lead Type", keys: ["lead_type", "leadtype", "vertical", "product"] },
  { lab: "Interested In", keys: ["interested_in", "interest", "interestedin"] },
  { lab: "Platform", keys: ["platform"] },
  { lab: "Ad", keys: ["ad", "ad_name", "adname", "creative"] },
  { lab: "IP Address", keys: ["ip_address", "ip", "ipaddress"] },
  { lab: "OTP Code", keys: ["otp_code", "otp", "otpcode"] },
  { lab: "Favorite Hobby", keys: ["favorite_hobby", "hobby", "favoritehobby"] },
  { lab: "Needed Coverage", keys: ["needed_coverage", "coverage", "coverage_amount", "neededcoverage"] },
  { lab: "Has Life Insurance", keys: ["has_life_insurance", "life_insurance", "haslifeinsurance"] },
  { lab: "Beneficiary Name", keys: ["beneficiary_name", "beneficiaryname"] },
  { lab: "Beneficiary Relationship", keys: ["beneficiary", "beneficiary_relationship", "beneficiaryrelationship", "beneficiary_rel"] },
  { lab: "Health History", keys: ["health_history", "health", "healthhistory", "health_conditions"] },
  { lab: "Mortgage Balance", keys: ["mortgage_balance", "mortgagebalance"] },
  { lab: "Mortgage Payment", keys: ["mortgage_payment", "mortgagepayment"] },
  { lab: "Military Status", keys: ["military_status", "military", "militarystatus"] },
  { lab: "Branch of Service", keys: ["branch_of_service", "branch", "branchofservice"] },
  { lab: "Trusted Form", keys: ["trusted_form_url", "trusted_form", "trustedform", "trusted_form_cert", "cert_url", "trustedform_url"], type: "url" },
];
const normKey = k => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
// the actual existing intake key matching one of the candidates (so edits write back to it)
function matchedKey(intake, keys) {
  const have = {}; Object.keys(intake || {}).forEach(k => { have[normKey(k)] = k; });
  for (const k of keys) { if (have[normKey(k)] !== undefined) return have[normKey(k)]; }
  return keys[0];
}
function intakeVal(intake, keys) {
  const k = matchedKey(intake, keys);
  const v = intake ? intake[k] : null;
  return (v != null && typeof v !== "object" && String(v).trim() !== "") ? v : null;
}
const fieldVal = (l, f) => f.get ? f.get(l) : f.col ? l[f.col] : intakeVal(l.intake || {}, f.keys || []);

// quick-action row (GOAT layout): comms/log group · divider · action group
const LP_ACTS = [
  { a: "msgs", i: "ti-lock", lab: "Msgs" },
  { a: "print", i: "ti-printer", lab: "Print" },
  { a: "log", i: "ti-phone-outgoing", lab: "Log" },
  { a: "note", i: "ti-note", lab: "Note" },
  { a: "task", i: "ti-checkbox", lab: "Task" },
  { sep: true },
  { a: "appt", i: "ti-calendar-plus", lab: "Appt", cls: "lp-act-green" },
  { a: "sold", i: "ti-currency-dollar", lab: "Sold", cls: "lp-act-green" },
  { a: "fps", i: "ti-zoom", lab: "FPS" },
  { a: "replace", i: "ti-refresh", lab: "Replace", cls: "lp-act-amber" },
  { a: "vcf", i: "ti-address-book", lab: "VCF" },
];

async function openLeadPanel(id) {
  let l = null, asn = null;
  try { l = (await sb.from("leads").select("*").eq("id", id).single()).data; } catch { }
  if (!l) return;
  try { asn = (await sb.from("lead_assignments").select("id,disposition").eq("lead_id", id).eq("agent_id", ME.id).order("assigned_at", { ascending: false }).limit(1).maybeSingle()).data; } catch { }
  l._asn = asn;
  LEAD_PANEL = l; LP_TAB = "details";
  LP_HIDE = { contact: false, data: false }; LP_EDIT = { contact: false, data: false };
  renderLeadPanel();
}
window.openLeadPanel = openLeadPanel;
function lpOutsideClick(e) {
  const p = document.querySelector(".lead-panel");
  if (!p || p.contains(e.target)) return;
  // ignore clicks inside modals / menus launched from the panel
  if (e.target.closest(".modal-bg,.modal,#disp-menu,.disp-menu,.lead-row")) return;
  closeLeadPanel();
}
function closeLeadPanel() { document.removeEventListener("mousedown", lpOutsideClick); document.querySelector(".lead-panel")?.remove(); LEAD_PANEL = null; }
const lpLeadObj = () => ({ id: LEAD_PANEL.id, name: `${LEAD_PANEL.first_name || ""} ${LEAD_PANEL.last_name || ""}`.trim() });

function renderLeadPanel() {
  const l = LEAD_PANEL;
  document.querySelector(".lead-panel")?.remove();
  const age = l.created_at ? Math.max(0, Math.floor((Date.now() - new Date(l.created_at)) / 86400000)) : null;
  const tabs = [["details", "Lead details"], ["tasks", "Tasks"], ["notes", "Notes"], ["messages", "Messages"], ["support", "Support"]];
  const p = document.createElement("div");
  p.className = "lead-panel ptint-" + dispDef(l._asn?.disposition).badge.replace("b-", "");
  p.innerHTML = `
    <div class="lp-head"><div class="lp-htop">
      <div class="lp-av">${esc(initials((l.first_name || "") + " " + (l.last_name || "")))}</div>
      <div style="flex:1">
        <div class="lp-name">${esc(l.first_name || "")} ${esc(l.last_name || "")}</div>
        <div class="lp-sub">${l.created_at ? new Date(l.created_at).toLocaleDateString() : ""}${age != null ? ` · ${age} days ago` : ""}</div>
        <div class="lp-badges">${[l.source, l.current_tier, l.state].filter(Boolean).map(b => `<span class="lp-badge">${esc(b)}</span>`).join("")}</div>
      </div>
      <div class="lp-meta">${l.id ? "Lead ID · " + String(l.id).slice(0, 8) : ""}</div>
      <span class="lp-close" id="lp-x"><i class="ti ti-x"></i></span>
    </div></div>
    <div class="lp-actions">
      <select class="lp-status status-${dispDef(l._asn?.disposition).badge}" id="lp-status" ${l._asn ? "" : "disabled"}>${DISPO_DEFS.map(d => `<option value="${d.v}" ${l._asn && dispDef(l._asn.disposition).v === d.v ? "selected" : ""}>${d.label}</option>`).join("")}</select>
      <div class="lp-act-group">${LP_ACTS.map(a => a.sep ? `<span class="lp-act-sep"></span>` : `<div class="lp-act ${a.cls || ""}" data-act="${a.a}"><i class="ti ${a.i}"></i>${a.lab}</div>`).join("")}</div>
    </div>
    <div class="lp-tabs">${tabs.map(([id, lab]) => `<span class="lp-tab ${LP_TAB === id ? "on" : ""}" data-lp="${id}">${lab}</span>`).join("")}</div>
    <div class="lp-body" id="lp-body"></div>`;
  document.body.appendChild(p);
  setTimeout(() => document.addEventListener("mousedown", lpOutsideClick), 0);
  $("#lp-x").addEventListener("click", closeLeadPanel);
  $("#lp-status").addEventListener("change", e => {
    if (!l._asn) return;
    e.target.className = "lp-status status-" + dispDef(e.target.value).badge;
    applyDisposition(l._asn.id, l.id, e.target.value);
  });
  p.querySelectorAll(".lp-act").forEach(b => b.addEventListener("click", () => lpAction(b.dataset.act)));
  p.querySelectorAll(".lp-tab").forEach(t => t.addEventListener("click", () => { LP_TAB = t.dataset.lp; p.querySelectorAll(".lp-tab").forEach(x => x.classList.toggle("on", x.dataset.lp === LP_TAB)); lpRenderTab(); }));
  lpRenderTab();
}

function lpGoTab(tab) { LP_TAB = tab; document.querySelectorAll(".lp-tab").forEach(x => x.classList.toggle("on", x.dataset.lp === tab)); lpRenderTab(); }
function lpAction(act) {
  const l = LEAD_PANEL;
  if (act === "task") return openTaskModal(lpLeadObj());
  if (act === "appt") return openApptModal(lpLeadObj());
  if (act === "note") return lpGoTab("notes");
  if (act === "msgs") return lpGoTab("messages");
  if (act === "sold") return openDealModal(l);
  if (act === "fps") return lpSupportAction("search");
  if (act === "vcf") return downloadVCard(l);
  if (act === "print") return window.print();
  if (act === "log") return alert("Call logging arrives with the comms build.");
  if (act === "replace") return alert("Lead replacement requests connect with the support build.");
  if (act === "call" && l.phone) window.location.href = "tel:" + l.phone.replace(/[^\d+]/g, "");
}
function downloadVCard(l) {
  const name = `${l.first_name || ""} ${l.last_name || ""}`.trim();
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${l.last_name || ""};${l.first_name || ""};;;`, `FN:${name}`,
    l.phone ? `TEL;TYPE=CELL:${l.phone}` : "", l.email ? `EMAIL:${l.email}` : "", l.state ? `ADR;TYPE=HOME:;;;;${l.state};;` : "", "END:VCARD"].filter(Boolean);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/vcard" }));
  a.download = `${name || "lead"}.vcf`; a.click(); URL.revokeObjectURL(a.href);
}

async function lpRenderTab() {
  const b = $("#lp-body"); if (!b) return; const l = LEAD_PANEL;
  if (LP_TAB === "details") { b.innerHTML = lpDetails(l); lpWireDetails(b); return; }
  if (LP_TAB === "messages") { b.innerHTML = `<div class="coming"><div class="badge"><i class="ti ti-message"></i></div><b>Messaging</b><div>SMS &amp; email timeline arrives with the comms build.</div></div>`; return; }
  if (LP_TAB === "support") { b.innerHTML = lpSupport(); b.querySelectorAll("[data-sup]").forEach(x => x.addEventListener("click", () => lpSupportAction(x.dataset.sup))); return; }
  if (LP_TAB === "tasks") {
    b.innerHTML = `<div class="coming"><span class="spin"></span></div>`;
    let t = []; try { t = (await sb.from("tasks").select("*").eq("lead_id", l.id).order("due_at", { ascending: true })).data || []; } catch { }
    b.innerHTML = lpTasks(t);
    b.querySelector("#lp-newtask")?.addEventListener("click", () => openTaskModal(lpLeadObj()));
    return;
  }
  if (LP_TAB === "notes") {
    b.innerHTML = `<div class="coming"><span class="spin"></span></div>`;
    let n = [];
    try { n = (await sb.rpc("lead_notes_for", { p_lead: l.id })).data || []; }
    catch { try { n = (await sb.from("lead_notes").select("*").eq("lead_id", l.id).order("created_at", { ascending: false })).data || []; } catch { } }
    b.innerHTML = lpNotes(n);
    b.querySelector("#lp-addnote")?.addEventListener("click", lpAddNote);
    return;
  }
}

function lpReadVal(val, type) {
  if (val == null || String(val).trim() === "") return { empty: true, html: "—" };
  const v = String(val);
  if (type === "url") return { empty: false, html: `<a href="${esc(v)}" target="_blank" class="lp-link">${esc(v)}</a>` };
  if (type === "phone") return { empty: false, html: `<a href="tel:${esc(v.replace(/[^\d+]/g, ""))}" class="lp-link">${esc(v)}</a>` };
  if (type === "email") return { empty: false, html: `<a href="mailto:${esc(v)}" class="lp-link">${esc(v)}</a>` };
  return { empty: false, html: esc(v) };
}
function lpSection(secKey, title, icon, fields, l) {
  const hide = LP_HIDE[secKey], edit = LP_EDIT[secKey];
  let body;
  if (edit) {
    body = fields.map(f => {
      const cur = fieldVal(l, f);
      const kind = f.split ? "split" : f.col ? "col" : "intake";
      const key = f.col || (f.keys ? matchedKey(l.intake || {}, f.keys) : "");
      const itype = f.type === "date" ? "date" : f.type === "number" ? "number" : "text";
      return `<div class="lp-f"><div class="lp-f-lab">${esc(f.lab)}</div><input class="lp-edit-in" data-kind="${kind}" data-key="${esc(key)}" type="${itype}" value="${esc(cur == null ? "" : String(cur))}"></div>`;
    }).join("");
  } else {
    const rows = fields.map(f => { const r = lpReadVal(fieldVal(l, f), f.type); return { empty: r.empty, html: `<div class="lp-f"><div class="lp-f-lab">${esc(f.lab)}</div><div class="lp-f-val">${r.html}</div></div>` }; });
    const shown = hide ? rows.filter(r => !r.empty) : rows;
    body = shown.length ? shown.map(r => r.html).join("") : `<div class="muted2">No fields to show.</div>`;
  }
  const tools = edit
    ? `<span class="lp-sec-tool ok" data-save="${secKey}"><i class="ti ti-check"></i> Save</span><span class="lp-sec-tool" data-cancel="${secKey}">Cancel</span>`
    : `<span class="lp-sec-tool" data-hide="${secKey}"><i class="ti ti-eye${hide ? "-off" : ""}"></i> ${hide ? "Show empty" : "Hide empty"}</span><span class="lp-sec-tool" data-edit="${secKey}"><i class="ti ti-pencil"></i> Edit</span>`;
  return `<div class="lp-sec" data-sec="${secKey}">
    <div class="lp-sec-h2"><span class="lp-sec-title"><i class="ti ${icon}"></i> ${title}</span><span class="lp-sec-tools">${tools}</span></div>
    <div class="lp-grid">${body}</div></div>`;
}
function lpTagsSection(l) {
  const tags = Array.isArray(l.tags) ? l.tags : [];
  return `<div class="lp-sec"><div class="lp-sec-h2"><span class="lp-sec-title"><i class="ti ti-tag"></i> Tags</span></div>
    <div style="padding:14px 16px">
      <div class="lp-tags">${tags.length ? tags.map(t => `<span class="lp-tag">${esc(t)}<i class="ti ti-x" data-untag="${esc(t)}"></i></span>`).join("") : `<span class="muted2">No tags yet</span>`}</div>
      <div class="lp-tag-add"><input class="in" id="lp-tag-input" placeholder="Add a tag and press Enter"><button class="btn-ghost" id="lp-tag-btn"><i class="ti ti-plus"></i> Add</button></div>
    </div></div>`;
}
function lpTypSection() {
  const items = [["Click to Call", "ti-phone"], ["Download vCard", "ti-address-book"], ["Text", "ti-message"], ["Calendar", "ti-calendar"], ["Email", "ti-mail"], ["Agent Website", "ti-world"]];
  return `<div class="lp-sec"><div class="lp-sec-h2"><span class="lp-sec-title"><i class="ti ti-cursor-text"></i> Thank You Page Clicks</span><span class="lp-soon">Coming soon — every interaction with the dynamic thank-you page</span></div>
    <div class="lp-grid">${items.map(([lab, ic]) => `<div class="lp-f"><div class="lp-f-lab"><i class="ti ${ic}" style="font-size:12px;margin-right:4px;opacity:.6"></i>${lab}</div><div class="lp-f-val">—</div></div>`).join("")}</div></div>`;
}
function lpDetails(l) {
  return lpSection("contact", "Contact Info", "ti-address-book", F_CONTACT, l)
    + lpSection("data", "Lead Data", "ti-database", F_DATA, l)
    + lpTagsSection(l) + lpTypSection();
}
function lpWireDetails(b) {
  b.querySelectorAll("[data-hide]").forEach(x => x.addEventListener("click", () => { const k = x.dataset.hide; LP_HIDE[k] = !LP_HIDE[k]; lpRenderTab(); }));
  b.querySelectorAll("[data-edit]").forEach(x => x.addEventListener("click", () => { LP_EDIT[x.dataset.edit] = true; lpRenderTab(); }));
  b.querySelectorAll("[data-cancel]").forEach(x => x.addEventListener("click", () => { LP_EDIT[x.dataset.cancel] = false; lpRenderTab(); }));
  b.querySelectorAll("[data-save]").forEach(x => x.addEventListener("click", () => lpSaveSection(x.dataset.save)));
  b.querySelectorAll("[data-untag]").forEach(x => x.addEventListener("click", () => lpRemoveTag(x.dataset.untag)));
  const ti = b.querySelector("#lp-tag-input"), tb = b.querySelector("#lp-tag-btn");
  if (tb) tb.addEventListener("click", () => lpAddTag(ti.value));
  if (ti) ti.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); lpAddTag(ti.value); } });
}
async function lpSaveSection(secKey) {
  const sec = document.querySelector(`.lp-sec[data-sec="${secKey}"]`); if (!sec) return;
  const cols = {}, intake = {};
  sec.querySelectorAll(".lp-edit-in").forEach(inp => {
    const kind = inp.dataset.kind, key = inp.dataset.key, val = inp.value;
    if (kind === "split") { const parts = val.trim().split(/\s+/); cols.first_name = parts.shift() || ""; cols.last_name = parts.join(" "); }
    else if (kind === "col") cols[key] = val;
    else if (kind === "intake" && key) intake[key] = val;
  });
  const btn = sec.querySelector("[data-save]"); if (btn) btn.innerHTML = `<i class="ti ti-loader"></i> Saving…`;
  try { await sb.rpc("update_lead_contact", { p_lead: LEAD_PANEL.id, p_fields: cols, p_intake: intake }); }
  catch (e) { alert(e.message); if (btn) btn.innerHTML = `<i class="ti ti-check"></i> Save`; return; }
  try { const fresh = (await sb.from("leads").select("*").eq("id", LEAD_PANEL.id).single()).data; if (fresh) { fresh._asn = LEAD_PANEL._asn; LEAD_PANEL = fresh; } } catch { }
  LP_EDIT[secKey] = false; lpRenderTab();
}
async function lpSaveTags(tags) {
  try { await sb.rpc("update_lead_contact", { p_lead: LEAD_PANEL.id, p_fields: { tags }, p_intake: {} }); }
  catch (e) { alert(e.message); return; }
  LEAD_PANEL.tags = tags; lpRenderTab();
}
function lpAddTag(raw) {
  const t = (raw || "").trim(); if (!t) return;
  const tags = Array.isArray(LEAD_PANEL.tags) ? LEAD_PANEL.tags.slice() : [];
  if (tags.some(x => x.toLowerCase() === t.toLowerCase())) return;
  tags.push(t); lpSaveTags(tags);
}
function lpRemoveTag(t) {
  const tags = (Array.isArray(LEAD_PANEL.tags) ? LEAD_PANEL.tags : []).filter(x => x !== t);
  lpSaveTags(tags);
}

function lpTasks(tasks) {
  return `<div class="pagehead"><div style="font-weight:600;font-size:14px">Tasks for this lead</div><div style="flex:1"></div><button class="btn-gold" id="lp-newtask" style="padding:7px 13px"><i class="ti ti-plus"></i> New task</button></div>
    ${tasks.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Due</th><th>Task</th><th>Priority</th><th>Status</th></tr></thead><tbody>${tasks.map(t => `<tr><td class="num" style="color:var(--tx3)">${t.due_at ? new Date(t.due_at).toLocaleDateString() : "—"}</td><td>${esc(t.title || t.task || "—")}</td><td style="text-transform:capitalize">${esc(t.priority || "normal")}</td><td style="text-transform:capitalize">${esc(t.status || "open")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="coming" style="padding:40px"><div class="muted2">No tasks for this lead yet.</div></div>`}`;
}

function lpNotes(notes) {
  return `<div style="display:flex;gap:8px;margin-bottom:14px"><textarea class="in" id="lp-note-input" placeholder="Add a note…" style="flex:1"></textarea><button class="btn-gold" id="lp-addnote" style="align-self:flex-start"><i class="ti ti-plus"></i> Add</button></div>
    ${notes.length ? notes.map(n => `<div class="lp-note"><div>${esc(n.body)}</div><div class="meta">${esc(n.agent_name || "")}${n.created_at ? " · " + new Date(n.created_at).toLocaleString() : ""}</div></div>`).join("") : `<div class="coming" style="padding:30px"><div class="muted2">No notes yet.</div></div>`}`;
}
async function lpAddNote() {
  const ta = $("#lp-note-input"); const body = (ta?.value || "").trim(); if (!body) return;
  try { await sb.from("lead_notes").insert({ lead_id: LEAD_PANEL.id, agent_id: ME.id, body }); } catch (e) { alert(e.message); return; }
  lpRenderTab();
}

function lpSupport() {
  return `<div class="lp-sec"><div style="padding:4px">
    <div class="lp-row" data-sup="search"><i class="ti ti-user-search"></i><div><b>Fast people search</b><div class="muted2">Look up additional contact info</div></div></div>
    <div class="lp-row" data-sup="replace" style="border-top:1px solid var(--line)"><i class="ti ti-refresh"></i><div><b>Request replacement</b><div class="muted2">Replace this lead</div></div></div>
    <div class="lp-row" data-sup="sms" style="border-top:1px solid var(--line)"><i class="ti ti-message"></i><div><b>Send to SMS</b><div class="muted2">Re-trigger the SMS notification</div></div></div>
    <div class="lp-row" data-sup="email" style="border-top:1px solid var(--line)"><i class="ti ti-mail"></i><div><b>Send to email</b><div class="muted2">Re-trigger the email notification</div></div></div>
  </div></div>`;
}
function lpSupportAction(act) {
  const l = LEAD_PANEL;
  if (act === "search") { const q = encodeURIComponent(`${l.first_name || ""} ${l.last_name || ""} ${l.state || ""}`.trim()); window.open(`https://www.google.com/search?q=${q}`, "_blank"); return; }
  alert("This action connects with the comms / support build.");
}

function openApptModal(lead) {
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal" style="width:360px"><div class="modal-h"><span><i class="ti ti-calendar-plus" style="color:var(--gold)"></i> New appointment</span><i class="ti ti-x" id="ap-x" style="cursor:pointer;color:var(--tx3)"></i></div>
    <div class="modal-b">
      <div class="field"><label>Lead</label><input class="in" value="${esc(lead.name)}" disabled></div>
      <div class="field"><label>Title</label><input class="in" id="ap-title" value="Appointment"></div>
      <div class="field"><label>Date &amp; time</label><input class="in" id="ap-when" type="datetime-local"></div>
      <div class="field"><label>Notes</label><textarea class="in" id="ap-notes" placeholder="Optional…"></textarea></div>
      <div id="ap-err" style="color:var(--red);font-size:12px;min-height:14px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn-ghost" id="ap-cancel">Cancel</button><button class="btn-gold" id="ap-create">Create</button></div>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $("#ap-x").addEventListener("click", close); $("#ap-cancel").addEventListener("click", close);
  $("#ap-create").addEventListener("click", async e => {
    const when = $("#ap-when").value; if (!when) { $("#ap-err").textContent = "Pick a date & time."; return; }
    const btn = e.target; btn.disabled = true; btn.textContent = "Creating…";
    let appt;
    try { appt = (await sb.from("lead_appointments").insert({ lead_id: lead.id, agent_id: ME.id, title: $("#ap-title").value.trim() || "Appointment", starts_at: new Date(when).toISOString(), notes: $("#ap-notes").value.trim() || null }).select().single()).data; }
    catch (err) { btn.disabled = false; btn.textContent = "Create"; $("#ap-err").textContent = err.message; return; }
    // push to Google Calendar (non-fatal if not connected)
    let cal; try { cal = await sb.functions.invoke("create-calendar-event", { body: { appointment_id: appt.id } }); } catch (er) { cal = { error: er }; }
    close();
    if (ROUTE === "calendar") loadCalendar();
    const cd = cal?.data;
    if (cal?.error || cd?.ok === false || cd?.skipped) {
      const why = cd?.skipped === "not_connected" ? "your Google account isn't connected (Profile → Integrations)." : (cd?.error || cal?.error?.message || "failed — check which Google account is connected.");
      alert("Appointment saved to the portal. Google Calendar sync: " + why);
    }
  });
}

// ---------------------------------------------------------------- deal submission (Sold)
let DEAL_CATALOG = null;
const DEAL_STATUS = ["underwriting", "approved", "issued", "declined", "cancelled", "chargeback"];
const FREQ = { monthly: 12, quarterly: 4, semiannually: 2, annually: 1 };
// Carrier + product catalog for the sold-policy popup (policy_companies / policy_products, per tenant).
async function loadDealCatalog() {
  if (DEAL_CATALOG) return DEAL_CATALOG;
  const tid = activeTenantId();
  let cos = [], prods = [];
  try { cos   = (await sb.from("policy_companies").select("id,name").eq("tenant_id", tid).eq("is_active", true).order("sort_order").order("name")).data || []; } catch { }
  try { prods = (await sb.from("policy_products").select("id,name,company_id").eq("tenant_id", tid).eq("is_active", true).order("sort_order").order("name")).data || []; } catch { }
  DEAL_CATALOG = cos.map(c => ({ ...c, products: prods.filter(p => p.company_id === c.id) }));
  return DEAL_CATALOG;
}

async function openDealModal(lead, ctx = {}) {
  const cos = await loadDealCatalog();
  const today = new Date().toISOString().slice(0, 10);
  const fromCall = !!ctx.callId;
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal" style="width:480px;max-height:90vh;overflow:auto"><div class="modal-h"><span><i class="ti ti-rosette-discount-check" style="color:var(--green)"></i> Add sold policy${fromCall ? ' <span class="pill green" style="margin-left:6px">Inbound call</span>' : ''}</span><i class="ti ti-x" id="dl-x" style="cursor:pointer;color:var(--tx3)"></i></div>
    <div class="modal-b">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>Insured name *</label><input class="in" id="dl-name" value="${esc(`${lead.first_name || ""} ${lead.last_name || ""}`.trim())}"></div>
        <div class="field"><label>Policy status *</label><select class="in" id="dl-status">${DEAL_STATUS.map(s => `<option value="${s}">${pretty(s)}</option>`).join("")}</select></div>
        <div class="field"><label>Phone</label><input class="in" value="${esc(lead.phone || "")}" disabled></div>
        <div class="field"><label>Email</label><input class="in" value="${esc(lead.email || "")}" disabled></div>
        <div class="field"><label>Carrier *</label><select class="in" id="dl-carrier"><option value="">${cos.length ? "Select carrier" : "No carriers set up"}</option>${cos.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Product *</label><select class="in" id="dl-product"><option value="">Select carrier first</option></select></div>
        <div class="field"><label>Premium frequency</label><select class="in" id="dl-freq"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></div>
        <div class="field"><label>Premium *</label><input class="in" id="dl-premium" type="number" step="0.01" placeholder="0.00"></div>
        <div class="field"><label>Face amount</label><input class="in" id="dl-face" type="number" step="0.01" placeholder="0.00"></div>
        <div class="field"><label>Policy number</label><input class="in" id="dl-policynum" placeholder="Optional"></div>
        <div class="field"><label>Sold on *</label><input class="in" id="dl-sold" type="date" value="${today}"></div>
        <div class="field"><label>Effective date</label><input class="in" id="dl-eff" type="date"></div>
      </div>
      <div id="dl-err" style="color:var(--red);font-size:12px;min-height:14px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn-ghost" id="dl-cancel">Cancel</button><button class="btn-gold" id="dl-save"><i class="ti ti-check"></i> Save deal</button></div>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $("#dl-x").addEventListener("click", close); $("#dl-cancel").addEventListener("click", close);
  // carrier -> product cascade
  $("#dl-carrier").addEventListener("change", e => {
    const c = cos.find(x => x.id === e.target.value);
    const opts = c && c.products.length
      ? `<option value="">Select product</option>` + c.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")
      : `<option value="">${c ? "No products for this carrier" : "Select carrier first"}</option>`;
    $("#dl-product").innerHTML = opts;
  });
  $("#dl-save").addEventListener("click", async () => {
    const name = $("#dl-name").value.trim(), premium = parseFloat($("#dl-premium").value);
    const carrierCo = cos.find(x => x.id === $("#dl-carrier").value);
    const productId = $("#dl-product").value || null;
    if (!name) { $("#dl-err").textContent = "Insured name is required."; return; }
    if (!carrierCo) { $("#dl-err").textContent = "Select a carrier."; return; }
    if (!premium || premium < 0) { $("#dl-err").textContent = "Enter a valid premium."; return; }
    const annual = Math.round(premium * (FREQ[$("#dl-freq").value] || 12) * 100) / 100;
    const payload = {
      tenant_id: activeTenantId(),
      client_name: name, annual_premium: annual,
      carrier: carrierCo.name, company_id: carrierCo.id, product_id: productId,
      coverage_amount: parseFloat($("#dl-face").value) || null,
      policy_number: $("#dl-policynum").value.trim() || null,
      status: $("#dl-status").value,
      effective_date: $("#dl-eff").value || null,
      sale_date: $("#dl-sold").value || today,
      lead_id: lead.id || null, agent_id: ME.id,
      // Stamp the acquisition channel so call-sourced deals are reportable (channel='inbound_call').
      ...(fromCall ? { channel: "inbound_call" } : {}),
    };
    const btn = $("#dl-save"); btn.disabled = true; btn.textContent = "Saving…";
    const { data: dealRow, error } = await sb.from("deals").insert(payload).select("id").single();
    if (error) { btn.disabled = false; btn.textContent = "Save deal"; $("#dl-err").textContent = error.message; return; }
    if (ctx.callId) {
      try { await sb.from("calls").update({ deal_id: dealRow?.id || null, disposition: "sold", pipeline_stage: "deal_closed" }).eq("id", ctx.callId); } catch { }
      if (ROUTE === "calls") loadCalls();
    }
    close();
    confetti(); toast(`Deal logged — ${money(annual)} AP 🎉`);
    if (LEAD_PANEL && LEAD_PANEL.id === lead.id) { try { LEAD_PANEL = (await sb.from("leads").select("*").eq("id", lead.id).single()).data; LEAD_PANEL._asn = lead._asn; } catch { } renderLeadPanel(); }
  });
}

// ---------------------------------------------------------------- admin: carriers & products catalog (per agency)
let CATALOG_ADMIN = { cos: [], prods: [] };
async function loadCatalogAdmin() {
  const c = adminHost();
  c.innerHTML = `<div class="page-title">Carriers &amp; products</div><div class="page-sub">Loading…</div>${skelTable(6)}`;
  const tid = activeTenantId();
  let cos = [], prods = [];
  try { cos   = (await sb.from("policy_companies").select("*").eq("tenant_id", tid).order("sort_order").order("name")).data || []; } catch { }
  try { prods = (await sb.from("policy_products").select("*").eq("tenant_id", tid).order("sort_order").order("name")).data || []; } catch { }
  CATALOG_ADMIN = { cos, prods };
  DEAL_CATALOG = null; // invalidate the sold-popup cache so edits show immediately
  renderCatalogAdmin();
}
function renderCatalogAdmin() {
  const c = adminHost();
  const { cos, prods } = CATALOG_ADMIN;
  const carriers = cos.map(co => {
    const ps = prods.filter(p => p.company_id === co.id);
    return `<div class="panel" style="margin-bottom:12px;padding:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <b style="font-size:15px;${co.is_active ? "" : "opacity:.5;text-decoration:line-through"}">${esc(co.name)}</b>
        ${co.is_active ? "" : '<span class="pill grey">Inactive</span>'}
        <div style="flex:1"></div>
        <button class="btn-ghost sm" data-cat="rename-co" data-id="${co.id}" title="Rename"><i class="ti ti-pencil"></i></button>
        <button class="btn-ghost sm" data-cat="toggle-co" data-id="${co.id}" data-active="${co.is_active}">${co.is_active ? "Deactivate" : "Activate"}</button>
        <button class="btn-ghost sm" data-cat="del-co" data-id="${co.id}" title="Delete carrier"><i class="ti ti-trash"></i></button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${ps.length ? ps.map(p => `<span class="pill ${p.is_active ? "blue" : "grey"}" style="display:inline-flex;align-items:center;gap:6px">${esc(p.name)}<i class="ti ti-x" data-cat="del-prod" data-id="${p.id}" style="cursor:pointer;opacity:.7"></i></span>`).join("") : '<span class="muted2">No products yet</span>'}
      </div>
      <div style="display:flex;gap:6px">
        <input class="in" id="prodin-${co.id}" placeholder="Add product…" style="max-width:300px">
        <button class="btn-ghost sm" data-cat="add-prod" data-id="${co.id}"><i class="ti ti-plus"></i> Add</button>
      </div>
    </div>`;
  }).join("");
  c.innerHTML = `<div class="page-title">Carriers &amp; products</div><div class="page-sub">Carriers and products your agents pick when logging a sold policy — applies to this agency only.</div>
    <div class="panel" style="padding:14px;margin-bottom:16px;display:flex;gap:8px;align-items:center">
      <input class="in" id="cat-newco" placeholder="New carrier name…" style="max-width:340px">
      <button class="btn-gold" data-cat="add-co"><i class="ti ti-plus"></i> Add carrier</button>
    </div>
    ${carriers || '<div class="coming"><div class="badge"><i class="ti ti-building-bank"></i></div><b>No carriers yet</b><div>Add your first carrier above.</div></div>'}`;
  c.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => catAction(b.dataset.cat, b.dataset.id, b)));
}
async function catAction(action, id, btn) {
  const tid = activeTenantId();
  try {
    if (action === "add-co") {
      const name = $("#cat-newco").value.trim(); if (!name) return;
      const { error } = await sb.from("policy_companies").insert({ tenant_id: tid, name }); if (error) throw error;
    } else if (action === "add-prod") {
      const name = $("#prodin-" + id).value.trim(); if (!name) return;
      const { error } = await sb.from("policy_products").insert({ tenant_id: tid, company_id: id, name }); if (error) throw error;
    } else if (action === "del-co") {
      if (!confirm("Delete this carrier and all its products?")) return;
      const { error } = await sb.from("policy_companies").delete().eq("id", id); if (error) throw error;
    } else if (action === "del-prod") {
      const { error } = await sb.from("policy_products").delete().eq("id", id); if (error) throw error;
    } else if (action === "toggle-co") {
      const { error } = await sb.from("policy_companies").update({ is_active: btn.dataset.active !== "true" }).eq("id", id); if (error) throw error;
    } else if (action === "rename-co") {
      const co = CATALOG_ADMIN.cos.find(x => x.id === id);
      const name = prompt("Carrier name", co?.name || ""); if (name == null || !name.trim()) return;
      const { error } = await sb.from("policy_companies").update({ name: name.trim() }).eq("id", id); if (error) throw error;
    }
    toast("Saved");
  } catch (e) { toast(e.message || "Couldn't save (admins only)"); }
  loadCatalogAdmin();
}
window.loadCatalogAdmin = loadCatalogAdmin;

// ---------------------------------------------------------------- team / downline reporting
let TEAM_DATA = [];
async function loadTeam() {
  const c = $("#content");
  c.innerHTML = `<div class="page-title">Team</div><div class="page-sub">Production for you and everyone in your downline.</div>${skelTable(6)}`;
  try { TEAM_DATA = (await sb.rpc("downline_report")).data || []; }
  catch (e) { c.innerHTML = `<div class="page-title">Team</div><div class="coming"><div class="badge"><i class="ti ti-alert-triangle"></i></div><b>Couldn't load the team report</b><div>${esc(e?.message || e)}</div></div>`; return; }
  renderTeam();
}
function renderTeam() {
  const c = $("#content");
  const head = `<div class="page-title">Team</div><div class="page-sub">Production for you and everyone in your downline. Click a row to see their deals.</div>`;
  if (!TEAM_DATA.length) {
    c.innerHTML = head + `<div class="coming"><div class="badge"><i class="ti ti-sitemap"></i></div><b>No one in your downline yet</b><div>Agents assigned beneath you will roll up here.</div></div>`;
    return;
  }
  // org rollup = sum across every agent row (self + downline, each appears once)
  const T = TEAM_DATA.reduce((a, r) => ({
    ap: a.ap + (+r.ap || 0), deals: a.deals + (+r.deals || 0), call_deals: a.call_deals + (+r.call_deals || 0),
    recv: a.recv + (+r.calls_received || 0), conn: a.conn + (+r.calls_connected || 0), bill: a.bill + (+r.calls_billable || 0),
    miss: a.miss + (+r.calls_missed || 0), cspend: a.cspend + (+r.call_spend || 0), lspend: a.lspend + (+r.lead_spend || 0),
  }), { ap: 0, deals: 0, call_deals: 0, recv: 0, conn: 0, bill: 0, miss: 0, cspend: 0, lspend: 0 });
  const blendedCac = T.deals ? (T.cspend + T.lspend) / T.deals : 0;
  const cards = [
    ["ic-purple", "ti-coin", "Team AP", money(T.ap)], ["ic-green", "ti-circle-check", "Deals", T.deals],
    ["ic-blue", "ti-phone-check", "Call deals", T.call_deals], ["ic-blue", "ti-phone-incoming", "Calls received", T.recv],
    ["ic-green", "ti-phone-check", "Connected", T.conn], ["ic-amber", "ti-coin", "Billable", T.bill],
    ["ic-amber", "ti-receipt", "Call spend", money(T.cspend)], ["ic-pink", "ti-target-arrow", "Blended CAC", T.deals ? money(blendedCac) : "—"],
  ].map(([ic, icon, k, v]) => `<div class="stat"><span class="ic ${ic}"><i class="ti ${icon}"></i></span><div><div class="lab">${k}</div><div class="val num">${v}</div></div></div>`).join("");
  const rows = TEAM_DATA.map(r => `<tr data-agent="${r.agent_id}" data-name="${esc(r.full_name || "")}" style="cursor:pointer">
      <td>${esc(r.full_name || "—")}${r.is_self ? ' <span class="pill gold" style="margin-left:4px">You</span>' : ""}</td>
      <td style="text-align:right">${money(r.ap)}</td>
      <td style="text-align:right">${r.deals}</td>
      <td style="text-align:right">${r.call_deals}</td>
      <td style="text-align:right">${r.calls_received}</td>
      <td style="text-align:right">${r.calls_connected}</td>
      <td style="text-align:right">${r.calls_billable}</td>
      <td style="text-align:right">${r.calls_missed}</td>
      <td style="text-align:right">${money(r.call_spend)}</td>
      <td style="text-align:right">${(+r.cac) ? money(r.cac) : "—"}</td>
    </tr>`).join("");
  c.innerHTML = head
    + `<div class="stat-grid" style="margin-bottom:16px">${cards}</div>`
    + `<div class="panel"><table class="tbl"><thead><tr>
        <th>Agent</th><th style="text-align:right">AP</th><th style="text-align:right">Deals</th><th style="text-align:right">Call deals</th>
        <th style="text-align:right">Recv</th><th style="text-align:right">Conn</th><th style="text-align:right">Bill</th><th style="text-align:right">Miss</th>
        <th style="text-align:right">Call spend</th><th style="text-align:right">CAC</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  c.querySelectorAll("tr[data-agent]").forEach(tr => tr.addEventListener("click", () => openAgentDeals(tr.dataset.agent, tr.dataset.name)));
}
// Drill-in: an agent's deal rows (readable under existing RLS via can_reach_agent()).
async function openAgentDeals(agentId, name) {
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal" style="width:640px;max-height:88vh;overflow:auto"><div class="modal-h"><span><i class="ti ti-user"></i> ${esc(name || "Agent")} — deals</span><i class="ti ti-x" id="ad-x" style="cursor:pointer;color:var(--tx3)"></i></div><div class="modal-b" id="ad-body">${skelTable(5)}</div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $("#ad-x").addEventListener("click", close);
  let deals = [];
  try { deals = (await sb.from("deals").select("client_name,carrier,annual_premium,status,channel,sale_date").eq("agent_id", agentId).order("sale_date", { ascending: false }).limit(100)).data || []; } catch { }
  const body = $("#ad-body");
  if (!deals.length) { body.innerHTML = `<div class="coming"><div class="badge"><i class="ti ti-file-invoice"></i></div><b>No deals yet</b></div>`; return; }
  body.innerHTML = `<table class="tbl"><thead><tr><th>Sold</th><th>Client</th><th>Carrier</th><th style="text-align:right">AP</th><th>Status</th><th>Channel</th></tr></thead><tbody>${
    deals.map(d => `<tr>
      <td>${d.sale_date || "—"}</td>
      <td>${esc(d.client_name || "—")}</td>
      <td>${esc(d.carrier || "—")}</td>
      <td style="text-align:right">${money(d.annual_premium)}</td>
      <td>${pretty(d.status)}</td>
      <td>${d.channel === "inbound_call" ? '<span class="pill green">Call</span>' : pretty(d.channel || "—")}</td>
    </tr>`).join("")}</tbody></table>`;
}

// ---------------------------------------------------------------- inbound calls + wallet + availability
async function toggleAvailability(e) {
  const on = e.target.checked;
  try {
    await sb.from("agents").update({ available_for_calls: on }).eq("id", ME.id);
    ME.available_for_calls = on;
    document.getElementById("av-toggle")?.classList.toggle("on", on);
    toast(on ? "You're available for inbound calls" : "Inbound calls paused");
  } catch (err) {
    e.target.checked = !on;
    toast("Couldn't update availability");
  }
}

const CALL_STATUS = {
  received:  { label: "Received",  cls: "grey"   },
  routed:    { label: "Routed",    cls: "yellow" },
  connected: { label: "Connected", cls: "green"  },
  completed: { label: "Completed", cls: "blue"   },
  missed:    { label: "Missed",    cls: "red"    },
  no_agent:  { label: "No agent",  cls: "red"    },
  failed:    { label: "Failed",    cls: "red"    },
};
const fmtDur = s => { s = +s || 0; return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const fmtDT = t => { if (!t) return "—"; const d = new Date(t); return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };

let CALLS_DATA = [];
async function loadCalls() {
  const c = $("#content");
  c.innerHTML = `<div class="page-title">Inbound calls</div><div class="page-sub">Live and recent inbound calls routed to you.</div>${skelTable(8)}`;
  try {
    CALLS_DATA = (await sb.from("calls")
      .select("*, lead:leads(id,first_name,last_name,phone,email,state)")
      .eq("agent_id", ME.id).eq("direction", "inbound")
      .order("started_at", { ascending: false }).limit(200)).data || [];
  } catch { CALLS_DATA = []; }
  renderCalls();
}
function renderCalls() {
  const c = $("#content");
  const head = `<div class="page-title">Inbound calls</div><div class="page-sub">Live and recent inbound calls routed to you.</div>`;
  if (!CALLS_DATA.length) {
    c.innerHTML = head + `<div class="coming"><div class="badge"><i class="ti ti-phone-incoming"></i></div><b>No calls yet</b><div>Inbound calls routed to you will appear here in real time.</div></div>`;
    return;
  }
  const rows = CALLS_DATA.map(cl => {
    const l = cl.lead || {};
    const name = `${l.first_name || ""} ${l.last_name || ""}`.trim() || "Unknown caller";
    const st = CALL_STATUS[cl.status] || CALL_STATUS.received;
    return `<tr>
      <td>${fmtDT(cl.started_at)}</td>
      <td>${esc(name)}<div class="muted2">${esc(cl.caller_number || "")}</div></td>
      <td>${esc(cl.caller_state || "—")}</td>
      <td><span class="pill ${st.cls}">${st.label}</span></td>
      <td>${fmtDur(cl.talk_sec || cl.duration_sec)}</td>
      <td>${cl.billable ? money(cl.price) : '<span class="muted2">—</span>'}</td>
      <td>${cl.recording_url ? `<button class="rec-play" data-rec="${cl.id}" title="Play recording"><i class="ti ti-player-play"></i></button>` : '<span class="muted2">—</span>'}</td>
      <td><span class="disp-pick" data-disp="${cl.id}"><span class="dot ${dispDef(cl.disposition).badge}"></span>${dispLabel(cl.disposition)}<i class="ti ti-chevron-down"></i></span></td>
      <td style="text-align:right">${cl.deal_id ? '<span class="pill green">Sold</span>' : `<button class="btn-gold sm" data-sold="${cl.id}"><i class="ti ti-rosette-discount-check"></i> Mark as Sold</button>`}</td>
    </tr>`;
  }).join("");
  c.innerHTML = head + `<table class="data-tbl"><thead><tr><th>Time</th><th>Caller</th><th>State</th><th>Status</th><th>Talk</th><th>Billable</th><th>Rec</th><th>Disposition</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  c.querySelectorAll("[data-sold]").forEach(b => b.addEventListener("click", () => {
    const cl = CALLS_DATA.find(x => x.id === b.dataset.sold); if (!cl) return;
    const l = cl.lead || {};
    openDealModal({ id: l.id || cl.lead_id, first_name: l.first_name, last_name: l.last_name, phone: l.phone || cl.caller_number, email: l.email }, { callId: cl.id });
  }));
  c.querySelectorAll("[data-disp]").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); openCallDispMenu(el.dataset.disp, el); }));
  // play the Trackdrive recording inline; keep an open-in-new-tab fallback
  c.querySelectorAll("[data-rec]").forEach(b => b.addEventListener("click", () => {
    const cl = CALLS_DATA.find(x => x.id === b.dataset.rec); if (!cl?.recording_url) return;
    b.parentElement.innerHTML = `<audio class="rec-audio" controls autoplay preload="none" src="${esc(cl.recording_url)}"></audio> <a href="${esc(cl.recording_url)}" target="_blank" rel="noopener" title="Open recording in new tab" style="color:var(--tx3);margin-left:2px"><i class="ti ti-external-link"></i></a>`;
  }));
}

// map a disposition -> pipeline stage (mirrors the Leads flow)
const STAGE_FOR_DISP = { new_lead: "new_lead", called: "contacted", follow_up: "contacted", appt_booked: "appt_booked", appt_no_show: "appt_booked", pitched_not_sold: "contacted", sold: "deal_closed", nurture: "contacted", not_interested: "not_interested", bad_number: "not_interested", dnc: "not_interested" };

function openCallDispMenu(callId, anchor) {
  document.querySelector("#disp-menu")?.remove();
  const cl = CALLS_DATA.find(x => x.id === callId); const cur = cl?.disposition;
  const menu = document.createElement("div");
  menu.id = "disp-menu"; menu.className = "disp-menu";
  menu.innerHTML = DISPO_DEFS.map(d => `<div class="disp-opt ${d.v === cur ? "on" : ""}" data-v="${d.v}"><span class="dot ${d.badge}"></span>${d.label}${d.v === cur ? `<i class="ti ti-check" style="margin-left:auto"></i>` : ""}</div>`).join("");
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = (r.bottom + window.scrollY + 5) + "px";
  menu.style.left = Math.min(r.left + window.scrollX, window.innerWidth - 230) + "px";
  menu.querySelectorAll(".disp-opt").forEach(o => o.addEventListener("click", e => { e.stopPropagation(); menu.remove(); applyCallDisposition(callId, o.dataset.v); }));
  setTimeout(() => document.addEventListener("click", function h() { menu.remove(); document.removeEventListener("click", h); }), 0);
}

async function applyCallDisposition(callId, disp) {
  const cl = CALLS_DATA.find(x => x.id === callId); if (!cl) return;
  const stage = STAGE_FOR_DISP[disp] || "contacted";
  try { await sb.from("calls").update({ disposition: disp, pipeline_stage: stage }).eq("id", callId); cl.disposition = disp; cl.pipeline_stage = stage; }
  catch { toast("Couldn't update disposition"); return; }
  if (disp === "sold" && !cl.deal_id) {
    const l = cl.lead || {};
    openDealModal({ id: l.id || cl.lead_id, first_name: l.first_name, last_name: l.last_name, phone: l.phone || cl.caller_number, email: l.email }, { callId });
  }
  renderCalls();
}

async function loadWallet() {
  const c = $("#content");
  c.innerHTML = `<div class="page-title">Wallet</div><div class="page-sub">Your balance funds inbound calls and lead orders.</div>${skelTable(6)}`;
  let w = null, txns = [];
  try { w = (await sb.from("wallets").select("*").eq("agent_id", ME.id).maybeSingle()).data; } catch { }
  try { txns = (await sb.from("wallet_transactions").select("*").eq("agent_id", ME.id).order("created_at", { ascending: false }).limit(100)).data || []; } catch { }
  renderWallet(w, txns);
}
let WALLET_DATA = null;
function renderWallet(w, txns) {
  WALLET_DATA = w;
  const c = $("#content");
  const bal = w ? +w.balance : 0;
  WALLET_BAL = bal; const nb = document.getElementById("nav-bal"); if (nb) nb.textContent = money(bal);
  const hasCard = !!w?.default_pm_id;
  const rows = txns.map(t => `<tr>
      <td>${fmtDT(t.created_at)}</td>
      <td>${pretty(t.type)}</td>
      <td>${esc(t.description || "")}</td>
      <td style="text-align:right;color:${(+t.amount) < 0 ? "var(--red)" : "var(--green)"}">${(+t.amount) < 0 ? "" : "+"}${money(t.amount)}</td>
      <td style="text-align:right">${t.balance_after != null ? money(t.balance_after) : "—"}</td>
    </tr>`).join("");
  c.innerHTML = `<div class="page-title">Wallet</div><div class="page-sub">Your balance funds inbound calls and lead orders.</div>
    <div class="wallet-top">
      <div class="wallet-card">
        <div class="wc-l">Balance</div>
        <div class="wc-bal">${money(bal)}</div>
        <div class="wc-sub">${hasCard ? "Card on file" : "No card on file"}</div>
        <button class="btn-gold" id="wallet-topup"><i class="ti ti-plus"></i> Add funds</button>
      </div>
      <div class="wallet-card">
        <div class="wc-l">Auto-reload</div>
        <label class="ar-row"><span>Automatically top up my wallet</span>
          <span class="av-sw"><input type="checkbox" id="ar-enabled" ${w?.auto_reload_enabled ? "checked" : ""}><span class="av-track"></span></span>
        </label>
        <div class="ar-grid">
          <div class="field"><label>When balance falls below ($)</label><input class="in" id="ar-threshold" type="number" min="0" step="1" value="${w?.auto_reload_threshold ?? ""}" placeholder="e.g. 50"></div>
          <div class="field"><label>Top up by ($)</label><input class="in" id="ar-amount" type="number" min="0" step="1" value="${w?.auto_reload_amount ?? ""}" placeholder="e.g. 200"></div>
        </div>
        <div class="wc-sub">${hasCard ? "Charged to your saved card." : "Add funds once to save a card, then auto-reload can charge it."}</div>
        <button class="btn-ghost" id="ar-save"><i class="ti ti-check"></i> Save auto-reload</button>
      </div>
    </div>
    ${txns.length ? `<table class="data-tbl"><thead><tr><th>Date</th><th>Type</th><th>Description</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="coming"><div class="badge"><i class="ti ti-wallet"></i></div><b>No transactions yet</b><div>Top-ups and charges will show here.</div></div>`}`;
  $("#wallet-topup")?.addEventListener("click", openTopupModal);
  $("#ar-save")?.addEventListener("click", saveAutoReload);
}

function openTopupModal() {
  const presets = [100, 250, 500, 1000];
  const m = document.createElement("div"); m.className = "modal-bg";
  m.innerHTML = `<div class="modal" style="width:400px"><div class="modal-h"><span><i class="ti ti-wallet" style="color:var(--gold)"></i> Add funds</span><i class="ti ti-x" id="tu-x" style="cursor:pointer;color:var(--tx3)"></i></div>
    <div class="modal-b">
      <div class="tu-presets">${presets.map(p => `<button class="tu-preset" data-amt="${p}">$${p}</button>`).join("")}</div>
      <div class="field"><label>Or enter an amount</label><input class="in" id="tu-amt" type="number" min="5" step="1" placeholder="$ amount"></div>
      <div id="tu-err" style="color:var(--red);font-size:12px;min-height:14px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn-ghost" id="tu-cancel">Cancel</button><button class="btn-gold" id="tu-go"><i class="ti ti-credit-card"></i> Continue to payment</button></div>
      <div class="muted2" style="margin-top:8px;font-size:11px">You'll be taken to Stripe's secure checkout. Your card is saved so auto-reload can use it.</div>
    </div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $("#tu-x").addEventListener("click", close); $("#tu-cancel").addEventListener("click", close);
  m.querySelectorAll(".tu-preset").forEach(b => b.addEventListener("click", () => { $("#tu-amt").value = b.dataset.amt; m.querySelectorAll(".tu-preset").forEach(x => x.classList.remove("on")); b.classList.add("on"); }));
  $("#tu-go").addEventListener("click", async () => {
    const amt = parseFloat($("#tu-amt").value);
    if (!amt || amt < 5) { $("#tu-err").textContent = "Enter an amount of $5 or more."; return; }
    const btn = $("#tu-go"); btn.disabled = true; btn.textContent = "Redirecting…";
    try {
      const { data, error } = await sb.functions.invoke("wallet-checkout", { body: { amount: amt, return_url: location.origin + location.pathname } });
      if (error) { let msg = error.message; try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { } throw new Error(msg); }
      if (!data?.url) throw new Error(data?.error || "Checkout failed.");
      window.location.href = data.url;
    } catch (e) { btn.disabled = false; btn.innerHTML = `<i class="ti ti-credit-card"></i> Continue to payment`; $("#tu-err").textContent = e.message || "Could not start checkout."; }
  });
}

async function saveAutoReload() {
  const enabled = $("#ar-enabled").checked;
  const threshold = parseFloat($("#ar-threshold").value) || 0;
  const amount = parseFloat($("#ar-amount").value) || 0;
  if (enabled && (threshold <= 0 || amount <= 0)) { toast("Set both a threshold and a top-up amount."); return; }
  if (enabled && !WALLET_DATA?.default_pm_id) { toast("Add funds once first to save a card."); return; }
  const btn = $("#ar-save"); btn.disabled = true; btn.textContent = "Saving…";
  const { error } = await sb.rpc("set_wallet_autoreload", { p_enabled: enabled, p_threshold: threshold, p_amount: amount });
  btn.disabled = false; btn.innerHTML = `<i class="ti ti-check"></i> Save auto-reload`;
  toast(error ? "Couldn't save auto-reload." : "Auto-reload saved.");
  if (!error) loadWallet();
}

boot();
