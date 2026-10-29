// debuganything.dev home. No third-party requests: community numbers come from this site's own /api/stats.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const live = (msg) => { const l = $("#live"); if (l) { l.textContent = ""; setTimeout(() => { l.textContent = msg; }, 30); } };
  document.documentElement.classList.add("js");

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch {
      const a = el("textarea"); a.value = t; a.setAttribute("readonly", ""); a.className = "sr"; document.body.append(a); a.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch { /* no clipboard */ }
      a.remove(); return ok;
    }
  }

  // ---- the hero replay: a real session from 2026-10-28, full on first paint ----
  const session = [
    [["t-cmd", "$ S=$(debuganything attach 34327 --json | jq -r .session_id)"]],
    [["t-cmd", "$ debuganything memory --session $S"]],
    [["t-ok", "ok"], [null, " snapshot_memory#2  RSS 47.2 MB"]],
    [["t-note", "# load the app: 300 requests"]],
    [["t-cmd", "$ debuganything memory --session $S"]],
    [["t-ok", "ok"], [null, " snapshot_memory#3  Array retains 37.6 MB (85% of heap)"]],
    [["t-note", "# 400 more requests"]],
    [["t-cmd", "$ debuganything memory --session $S"]],
    [["t-ok", "ok"], [null, " snapshot_memory#5  Array retains 87.7 MB (93% of heap)"]],
    [["t-cmd", "$ debuganything diff --session $S"]],
    [["t-ok", "ok"], [null, " diff_runs#6  rss grew 47.2 MB → 323.0 MB (+584%)"]],
    [["t-high", "HIGH"], [null, " Array grew 2.0 KB → 87.7 MB "], ["t-ev", "[observed; e4]"]],
    [[null, ""]],
    [["t-note", "# the leak: a module-level array called `retained`."]],
    [["t-note", "# evidence: diff_runs#6/e4"]],
  ];
  const term = $("#replay"), again = $("#replay-btn");
  const line = (parts) => { const f = document.createDocumentFragment(); for (const [c, t] of parts) f.append(c ? el("span", c, t) : document.createTextNode(t)); return f; };
  const paintAll = () => { if (!term) return; term.replaceChildren(); session.forEach((l, i) => { if (i) term.append("\n"); term.append(line(l)); }); };
  let timer = 0;
  const replay = () => {
    if (!term) return;
    clearTimeout(timer);
    if (reduce) { paintAll(); live("Session shown in full"); return; }
    term.replaceChildren();
    let i = 0;
    const caret = el("span", "caret"); caret.setAttribute("aria-hidden", "true");
    const step = () => {
      caret.remove();
      if (i) term.append("\n");
      term.append(line(session[i]));
      i++;
      if (i < session.length) { term.append(caret); timer = setTimeout(step, session[i - 1][0][0] === "t-cmd" ? 520 : 260); }
    };
    step();
  };
  paintAll();
  if (again) again.addEventListener("click", replay);

  // ---- incident console ----
  const incidents = [
    { t: "EMFILE at 2 am", plain: "The app slowly runs out of connections because it never lets go of the old ones.", sym: "500s a few hours after deploy. Logs say EMFILE: too many open files. A restart fixes it.", cmd: "debuganything sockets --session $S\ndebuganything files --session $S --window 10", out: [["high", "412 sockets in CLOSE_WAIT: the peer closed and the target never called close() [inferred; e2]"], ["high", "980 fds open vs soft limit 1024 (96%): EMFILE imminent [observed; e4]"]], fix: "Keep-alive timeout longer than the load balancer's idle timeout. Set the server below it. Prove it: CLOSE_WAIT back to 3." },
    { t: "Disk full, du disagrees", plain: "A huge log file was deleted, but the app still holds it open, so the space never comes back.", sym: "/var is 100% full. du says 40 GB free. Deleting files frees nothing.", cmd: "debuganything files --session $S", out: [["high", "1 file deleted while still open holds 38.2 GB of disk [observed; e5]"]], fix: "logrotate deleted it; the process still holds fd 7. Use copytruncate, or send the reopen signal. It names the pid and fd; it will not truncate it for you." },
    { t: "Postgres: too many connections", plain: "Every worker opens its own database connection and never shares, so the database runs out.", sym: "Under load, requests queue. Postgres shows 100/100 connections. p99 at 8 s.", cmd: "debuganything sockets --session $S\ndebuganything trace --session $S --duration 10 --categories network", out: [["warn", "64 connections to 10.0.5.9: pool exhaustion or missing reuse [inferred; e3]"], ["warn", "18× connect failed with ECONNREFUSED [observed; e3]"]], fix: "Each worker opens its own connections. Put pgbouncer in front, or reuse connections, and cap workers × pool below max_connections." },
    { t: "The worker just stops", plain: "Two threads each wait for the other to finish first. Neither ever does.", sym: "Throughput drops to zero every few hours. CPU idle. A restart fixes it.", cmd: "debuganything why 5570 --symptom hang", out: [["high", "likely deadlock: 42 threads blocked on locks, none running. worker_ab (app.py:38) holds lock_b; worker_ba (app.py:45) holds lock_a [inferred; e14,e1]"]], fix: "Two code paths take lock_a and lock_b in opposite order. The source lines come from the process's own files. From a real lab run." },
    { t: "p99 of 1.4 s on one core", plain: "The app reads a file from disk on every request instead of once.", sym: "p50 is 20 ms, p99 is 1.4 s, one core pegged in bursts.", cmd: "debuganything profile --session $S --duration 10\ndebuganything trace --session $S --duration 8 --categories file", out: [["warn", "18000 path lookups (open/stat) in 8 s: filesystem churn [inferred; e1]"], ["warn", "__arch_copy_to_user accounts for 58.3% of CPU work [observed; e1,e2,e3]"]], fix: "readFileSync on the request path. Read it once and cache it, or stream it. From a real lab run." },
    { t: "OOMKilled every few hours", plain: "A list that only ever grows. The container hits its memory limit and gets killed.", sym: "Kubernetes shows OOMKilled and the restart count climbs. Nothing in the app logs.", cmd: "debuganything container --session $S\ndebuganything memory --session $S   # twice, then diff", out: [["high", "container was OOM-killed (State.OOMKilled=true) [observed; e1,e2]"], ["warn", "Array retains 87.7 MB (93% of heap), held by Context.retained [observed; e5,e3]"]], fix: "A module-level cache that is only appended to. Bound it with an LRU or a TTL. Numbers from the leaky-node demo." },
    { t: "Latency spikes every 30 s", plain: "The app looks up the partner's address on every call instead of remembering it.", sym: "Calls to a partner API are fast, then 300–900 ms.", cmd: "debuganything capture --session $S --duration 10 --consent\ndebuganything sockets --session $S", out: [["warn", "api.partner.example resolved 212× in 10 s: no DNS caching [inferred; e4]"], ["warn", "127 sockets in TIME_WAIT: connection churn [inferred; e2]"]], fix: "A new connection and lookup per request. Use a keep-alive agent and cache lookups." },
    { t: "EADDRINUSE after a crash", plain: "An old copy of your dev server is still running on the port. It tells you which one.", sym: "npm run dev fails with EADDRINUSE :3000. Nothing obvious is running.", cmd: "debuganything port 3000", out: [["high", "port 3000 is held by pid 61326 (node) in LISTEN [observed; e1,e2]"]], fix: "An orphaned child from the previous run. It names the process; you decide whether to stop it." },
  ];
  const list = $("#clist"), pane = $("#cpane");
  if (list && pane) {
    const row = (k, body) => { const r = el("div", "c-row"); r.append(el("p", "c-k", k), body); return r; };
    const show = (i, focus) => {
      const x = incidents[i];
      $$(".c-item", list).forEach((b, j) => { const on = j === i; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      pane.setAttribute("aria-labelledby", `ci-${i}`);
      const head = el("div"); head.append(el("h3", "c-title", x.t), el("p", "c-sym", x.sym));
      const cmd = el("pre", null, x.cmd.split("\n").map((l) => "$ " + l).join("\n")); cmd.setAttribute("translate", "no");
      const out = el("pre"); out.setAttribute("translate", "no");
      x.out.forEach(([sev, text], j) => {
        if (j) out.append("\n");
        const m = text.match(/^(.*?)(\s\[[^\]]+\])?$/);
        out.append(el("span", sev === "high" ? "t-high" : "t-warn", sev.toUpperCase()), " " + m[1]);
        if (m[2]) out.append(el("span", "t-ev", m[2]));
      });
      pane.replaceChildren(head, row("In plain words", el("p", null, x.plain)), row("Ran", cmd), row("Found", out), row("The fix", el("p", null, x.fix)));
    };
    incidents.forEach((x, i) => {
      const b = el("button", "c-item"); b.type = "button"; b.id = `ci-${i}`;
      b.setAttribute("role", "tab"); b.setAttribute("aria-controls", "cpane");
      b.append(el("b", null, x.t), el("span", null, x.plain.split(/[,.]/)[0]));
      b.addEventListener("click", () => show(i));
      b.addEventListener("keydown", (e) => {
        const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (e.key === "Home") { e.preventDefault(); show(0, true); }
        else if (e.key === "End") { e.preventDefault(); show(incidents.length - 1, true); }
        else if (d) { e.preventDefault(); show((i + d + incidents.length) % incidents.length, true); }
      });
      list.append(b);
    });
    show(0);
  }

  // ---- install tabs ----
  for (const box of $$("[data-tabs]")) {
    const tabs = $$("[role=tab]", box);
    const pick = (t, focus) => {
      for (const x of tabs) { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; const p = document.getElementById(x.getAttribute("aria-controls")); if (p) p.hidden = !on; }
      if (focus) t.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => pick(t));
      t.addEventListener("keydown", (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (e.key === "Home") { e.preventDefault(); pick(tabs[0], true); }
        else if (e.key === "End") { e.preventDefault(); pick(tabs[tabs.length - 1], true); }
        else if (d) { e.preventDefault(); pick(tabs[(i + d + tabs.length) % tabs.length], true); }
      });
    });
  }

  // ---- copy buttons ----
  for (const c of $$(".cmd[data-copy]")) {
    const b = $(".copy", c);
    if (!b) continue;
    b.setAttribute("aria-label", `Copy: ${c.dataset.copy}`);
    b.addEventListener("click", async () => {
      if (!(await copyText(c.dataset.copy))) { live("Copy failed. Select the command instead."); return; }
      b.textContent = "Copied"; b.classList.add("done"); live("Copied to clipboard");
      setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1600);
    });
  }

  // ---- community numbers, from this site ----
  (async () => {
    const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    let st = null;
    try { const r = await fetch("/api/stats"); st = r.ok ? await r.json() : null; } catch { /* offline: leave dashes */ }
    if (st && st.stars != null) set("st-stars", fmt(st.stars));
    set("st-npm", st && typeof st.npm === "number" && st.npm > 0 ? fmt(st.npm) : "new");
    set("st-pypi", st && typeof st.pypi === "number" && st.pypi > 0 ? fmt(st.pypi) : "new");
    if (st && Array.isArray(st.contributors)) set("st-contrib", fmt(st.contributors.length));
  })();

  // ---- entrances: each section's parts, once, in reading order ----
  const parts = $$(".sec > .wrap > *, .end > .wrap > *");
  if (!reduce && "IntersectionObserver" in window) {
    parts.forEach((p) => p.classList.add("reveal"));
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }, { rootMargin: "0px 0px -6% 0px" });
    parts.forEach((p) => io.observe(p));
  }
})();
