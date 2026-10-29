// debuganything.dev privacy choices. Vercel Web Analytics loads only after an explicit "Accept";
// Global Privacy Control / Do Not Track count as "Reject" and no banner is shown. No other optional script exists on this site.
(() => {
  const KEY = "dea_consent", VERSION = 1;
  const read = () => { try { const c = JSON.parse(localStorage.getItem(KEY) || "null"); return c && c.v === VERSION ? c : null; } catch { return null; } };
  const write = (analytics) => { const c = { v: VERSION, analytics, at: new Date().toISOString() }; try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} return c; };
  const signal = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  let loaded = false;
  const load = () => { if (loaded) return; loaded = true; const s = document.createElement("script"); s.defer = true; s.src = "/_vercel/insights/script.js"; document.head.appendChild(s); };

  const css = `#dea-consent{position:fixed;left:12px;right:12px;bottom:12px;z-index:1000;max-width:640px;margin:0 auto;background:#fff;color:#111;border:2px solid #111;box-shadow:6px 6px 0 #111;padding:16px 18px;font:15px/1.5 "Plex Sans",system-ui,-apple-system,sans-serif}
#dea-consent p{margin:0 0 12px;color:#111}#dea-consent a{color:#0039d6}
#dea-consent .row{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
#dea-consent button{font:600 14px "Plex Sans",system-ui,sans-serif;padding:10px 18px;border:2px solid #111;border-radius:0;background:#fff;color:#111;cursor:pointer;min-width:120px}
#dea-consent button[data-a="1"]{background:#ffd400}
#dea-consent button:focus-visible{outline:3px solid #0039d6;outline-offset:2px}
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
