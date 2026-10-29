// debuganything.dev privacy choices. Vercel Web Analytics loads only after an explicit "Accept";
// Global Privacy Control / Do Not Track count as "Reject" and no banner is shown. No other optional script exists on this site.
(() => {
  const KEY = "dea_consent", VERSION = 1;
  const read = () => { try { const c = JSON.parse(localStorage.getItem(KEY) || "null"); return c && c.v === VERSION ? c : null; } catch { return null; } };
  const write = (analytics) => { const c = { v: VERSION, analytics, at: new Date().toISOString() }; try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} return c; };
  const signal = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  let loaded = false;
  const load = () => { if (loaded) return; loaded = true; const s = document.createElement("script"); s.defer = true; s.src = "/_vercel/insights/script.js"; document.head.appendChild(s); };

  const css = `#dea-consent{position:fixed;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:1000;max-width:600px;margin:0 auto;background:#1a1c20;color:#ececf0;border-radius:12px;padding:18px 20px;font:14px/1.55 "Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 0 0 1px #25282d}
#dea-consent p{margin:0 0 14px;color:#a3a7b0}#dea-consent a{color:#6cb6ff}
#dea-consent .row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
#dea-consent button{font:600 14px/1 inherit;font-family:inherit;padding:11px 18px;border-radius:8px;border:0;background:#25282d;color:#ececf0;cursor:pointer;min-width:110px}
#dea-consent button[data-a="1"]{background:#6cb6ff;color:#06121e}
#dea-consent button:focus-visible{outline:2px solid #6cb6ff;outline-offset:2px}
@media(max-width:520px){#dea-consent button{flex:1}}`;

  function banner() {
    if (document.getElementById("dea-consent")) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const el = document.createElement("div"); el.id = "dea-consent"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Privacy choices");
    el.innerHTML = `<p>This site uses no cookies. With your permission it counts page views with Vercel Web Analytics, which is cookieless and stores no identifier on your device. Nothing loads until you choose. <a href="/privacy">Privacy</a></p><div class="row"><button type="button" data-a="0">Reject</button><button type="button" data-a="1">Accept</button></div>`;
    el.addEventListener("click", (e) => { const b = e.target.closest("button[data-a]"); if (!b) return; const yes = b.dataset.a === "1"; write(yes); el.remove(); if (yes) load(); });
    document.body.appendChild(el);
  }

  const start = () => {
    const c = read();
    if (c) { if (c.analytics) load(); }
    else if (!signal) banner();
    document.querySelectorAll("[data-cookie-settings]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); try { localStorage.removeItem(KEY); } catch {} banner(); }));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
