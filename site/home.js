// debuganything.dev home. No third-party requests: community numbers come from this site's own /api/stats.
// Hero reel, incident row, runtime tabs, the annotated finding, the pinned story, the "why" dialog, entrances.
(() => {
  document.documentElement.classList.add("js");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const live = (msg) => { const l = $("#live"); if (l) l.textContent = msg; };
  const copyText = async (t) => { try { await navigator.clipboard.writeText(t); live(`Copied: ${t}`); return true; } catch { return false; } };

  const init = () => {
    // ---- copy buttons ----
    for (const b of $$(".cmd[data-copy]")) b.addEventListener("click", async () => {
      if (!(await copyText(b.dataset.copy))) return;
      const a = $(".cmd-act", b); b.classList.add("done"); if (a) a.textContent = "Copied";
      setTimeout(() => { b.classList.remove("done"); if (a) a.textContent = "Copy"; }, 1600);
    });

    // ---- hero: the reel advances through three frames while the sentence holds ----
    const hero = $("#hero"), reel = $("#reel"), video = $("#hero video"), vctl = $(".vid-ctl");
    const wide = () => matchMedia("(min-width: 1101px)").matches;
    if (hero && reel) {
      let ticking = false;
      const update = () => {
        ticking = false;
        if (!wide() || reduce) { reel.style.setProperty("--i", "0"); return; }
        const r = hero.getBoundingClientRect();
        const span = hero.offsetHeight - innerHeight;
        const p = Math.min(1, Math.max(0, -r.top / Math.max(1, span)));
        reel.style.setProperty("--i", (p * 2).toFixed(3));
      };
      addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
      addEventListener("resize", update);
      update();
    }
    // start the clip once the session is under way, so the first frame already shows output
    const midStart = () => { try { video.currentTime = Math.min(6, (video.duration || 18) / 3); } catch { /* ignore */ } };
    if (video) { video.addEventListener("loadedmetadata", midStart, { once: true }); video.addEventListener("ended", () => { midStart(); if (!reduce) video.play().catch(() => {}); }); }
    if (video && !reduce && "IntersectionObserver" in window) {
      let userPaused = false;
      const label = () => { if (vctl) vctl.textContent = video.paused ? "Play" : "Pause"; };
      video.addEventListener("play", label); video.addEventListener("pause", label);
      if (vctl) { vctl.hidden = false; vctl.addEventListener("click", () => { userPaused = !video.paused; if (userPaused) video.pause(); else video.play().catch(() => {}); }); }
      new IntersectionObserver((es) => { for (const e of es) { if (e.isIntersecting && !userPaused) video.play().catch(() => {}); else video.pause(); } }, { threshold: 0.2 }).observe(video);
    }

    // ---- incidents row ----
    const incidents = [
      { t: "EMFILE at 2 am", plain: "The app slowly runs out of connections because it never lets go of the old ones.", sym: "500s a few hours after deploy. Logs say EMFILE: too many open files. A restart fixes it.", cmd: "debuganything sockets --session $S\ndebuganything files --session $S --window 10", out: [["high", "412 sockets in CLOSE_WAIT: the peer closed and the target never called close() [inferred; e2]"], ["high", "980 fds open vs soft limit 1024 (96%): EMFILE imminent [observed; e4]"]], fix: "Keep-alive timeout longer than the load balancer's idle timeout. Set the server below it. Prove it: CLOSE_WAIT back to 3." },
      { t: "Disk full, du disagrees", plain: "A huge log file was deleted, but the app still holds it open, so the space never comes back.", sym: "/var is 100% full. du says 40 GB free. Deleting files frees nothing.", cmd: "debuganything files --session $S", out: [["high", "1 file deleted while still open holds 38.2 GB of disk [observed; e5]"]], fix: "logrotate deleted it; the process still holds fd 7. Use copytruncate, or send the reopen signal. It names the pid and fd; it will not truncate it for you." },
      { t: "Postgres: too many connections", plain: "Every worker opens its own database connection and never shares, so the database runs out.", sym: "Under load, requests queue. Postgres shows 100/100 connections. p99 at 8 s.", cmd: "debuganything sockets --session $S\ndebuganything trace --session $S --duration 10 --categories network", out: [["warn", "64 connections to 10.0.5.9: pool exhaustion or missing reuse [inferred; e3]"], ["warn", "18× connect failed with ECONNREFUSED [observed; e3]"]], fix: "Each worker opens its own connections. Put pgbouncer in front, or reuse connections, and cap workers × pool below max_connections." },
      { t: "The worker just stops", plain: "Two threads each wait for the other to finish first. Neither ever does.", sym: "Throughput drops to zero every few hours. CPU idle. A restart fixes it.", cmd: "debuganything why 5570 --symptom hang", out: [["high", "likely deadlock: 42 threads blocked on locks, none running. worker_ab (app.py:38) holds lock_b; worker_ba (app.py:45) holds lock_a [inferred; e14,e1]"]], fix: "Two code paths take lock_a and lock_b in opposite order. The source lines come from the process's own files. From a real lab run." },
      { t: "p99 of 1.4 s on one core", plain: "The app reads a file from disk on every request instead of once.", sym: "p50 is 20 ms, p99 is 1.4 s, one core pegged in bursts.", cmd: "debuganything profile --session $S --duration 10\ndebuganything trace --session $S --duration 8 --categories file", out: [["warn", "18000 path lookups (open/stat) in 8 s: filesystem churn [inferred; e1]"], ["warn", "__arch_copy_to_user accounts for 58.3% of CPU work [observed; e1,e2,e3]"]], fix: "readFileSync on the request path. Read it once and cache it, or stream it. From a real lab run." },
      { t: "OOMKilled every few hours", plain: "A list that only ever grows. The container hits its memory limit and gets killed.", sym: "Kubernetes shows OOMKilled and the restart count climbs. Nothing in the app logs.", cmd: "debuganything container --session $S\ndebuganything memory --session $S   # twice, then diff", out: [["high", "container was OOM-killed (State.OOMKilled=true) [observed; e1,e2]"], ["warn", "Array retains 87.7 MB = 93% of the heap, held by Context.retained [observed; e5,e3]"]], fix: "A module-level cache that is only appended to. Bound it with an LRU or a TTL. Numbers from the leaky-node demo." },
      { t: "Latency spikes every 30 s", plain: "The app looks up the partner's address on every call instead of remembering it.", sym: "Calls to a partner API are fast, then 300–900 ms.", cmd: "debuganything capture --session $S --duration 10 --consent\ndebuganything sockets --session $S", out: [["warn", "api.partner.example resolved 212× in 10 s: no DNS caching [inferred; e4]"], ["warn", "127 sockets in TIME_WAIT: connection churn [inferred; e2]"]], fix: "A new connection and lookup per request. Use a keep-alive agent and cache lookups." },
      { t: "EADDRINUSE after a crash", plain: "An old copy of your dev server is still running on the port. It tells you which one.", sym: "npm run dev fails with EADDRINUSE :3000. Nothing obvious is running.", cmd: "debuganything port 3000", out: [["high", "port 3000 is held by pid 61326 (node) in LISTEN [observed; e1,e2]"]], fix: "An orphaned child from the previous run. It names the process; you decide whether to stop it." },
    ];
    const row = $("#row");
    if (row) {
      const panels = incidents.map((inc, i) => {
        const p = el("article", "panel"); p.setAttribute("data-ui", ""); p.dataset.i = String(i);
        p.append(el("h3", null, inc.t), el("p", "sym", inc.sym));
        const pre = el("pre"); const code = el("code", null, `$ ${inc.cmd.replace(/\n/g, "\n$ ")}`); code.setAttribute("translate", "no"); pre.append(code); p.append(pre);
        const ev = el("div", "ev");
        for (const [s, line] of inc.out) { const q = el("p"); const c = el("code", null, line); c.setAttribute("translate", "no"); q.append(el("span", `sev ${s}`, s.toUpperCase()), " ", c); ev.append(q); }
        p.append(ev, el("p", "fix", inc.fix));
        row.append(p);
        return p;
      });
      const name = $("#row-name"), plain = $("#row-plain"), count = $("#row-count");
      let cur = -1;
      const light = (i) => {
        if (i === cur) return; cur = i;
        panels.forEach((p, k) => { p.classList.toggle("lit", k === i); p.toggleAttribute("inert", k !== i); });
        name.textContent = incidents[i].t; plain.textContent = incidents[i].plain; count.textContent = `${i + 1} of ${incidents.length}`;
      };
      const centred = () => {
        const mid = row.getBoundingClientRect().left + row.clientWidth / 2;
        let best = 0, bd = Infinity;
        panels.forEach((p, k) => { const r = p.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - mid); if (d < bd) { bd = d; best = k; } });
        return best;
      };
      let rt = 0;
      row.addEventListener("scroll", () => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => light(centred())); }, { passive: true });
      const go = (i) => { const k = (i + panels.length) % panels.length; panels[k].scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "center", block: "nearest" }); light(k); };
      $("#row-prev")?.addEventListener("click", () => go(cur - 1));
      $("#row-next")?.addEventListener("click", () => go(cur + 1));
      row.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { e.preventDefault(); go(cur + 1); } if (e.key === "ArrowLeft") { e.preventDefault(); go(cur - 1); } });
      // drag with the mouse
      let down = false, sx = 0, sl = 0;
      row.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") return; down = true; sx = e.clientX; sl = row.scrollLeft; row.style.scrollSnapType = "none"; });
      addEventListener("pointerup", () => { if (!down) return; down = false; row.style.scrollSnapType = ""; go(centred()); });
      row.addEventListener("pointermove", (e) => { if (down) row.scrollLeft = sl - (e.clientX - sx); });
      light(0);
    }

    // ---- runtime tabs (vertical on desktop, a row on phones) ----
    const tabs = $$('.days [role="tab"]');
    const pick = (t, focus) => {
      for (const x of tabs) { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; document.getElementById(x.getAttribute("aria-controls")).hidden = !on; }
      if (focus) t.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => pick(t));
      t.addEventListener("keydown", (e) => {
        const next = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (!next) return; e.preventDefault(); pick(tabs[(i + next + tabs.length) % tabs.length], true);
      });
    });

    // ---- the annotated finding: a note lights its part of the panel ----
    const finding = $(".finding");
    if (finding) {
      const focus = (k) => { if (k) { finding.dataset.focus = k; $$(":scope > *", finding).forEach((x) => x.classList.toggle("on", x.dataset.k === k)); } else { delete finding.dataset.focus; $$(":scope > .on", finding).forEach((x) => x.classList.remove("on")); } };
      for (const n of $$(".notes li")) {
        n.addEventListener("mouseenter", () => focus(n.dataset.k)); n.addEventListener("mouseleave", () => focus(null));
        n.addEventListener("focus", () => focus(n.dataset.k)); n.addEventListener("blur", () => focus(null));
      }
      // align each note with its part on wide screens
      const align = () => {
        const wideNow = matchMedia("(min-width: 1101px)").matches;
        for (const n of $$(".notes li")) {
          n.style.marginTop = "";
          if (!wideNow) continue;
        }
        if (!wideNow) return;
        for (const side of $$(".notes")) {
          const top0 = side.getBoundingClientRect().top;
          let used = top0;
          for (const n of $$("li", side)) {
            const part = $(`[data-k="${n.dataset.k}"]`, finding);
            if (!part) continue;
            const want = part.getBoundingClientRect().top;
            const gap = Math.max(16, want - used);
            n.style.marginTop = `${gap - (n === side.firstElementChild ? 0 : 0)}px`;
            used = want + n.getBoundingClientRect().height;
          }
        }
      };
      $$(".notes").forEach((s) => { s.style.gap = "0"; s.style.paddingTop = "0"; });
      align(); addEventListener("resize", align);
      document.fonts?.ready.then(align);
    }

    // ---- pinned story: three statements change one terminal ----
    const term = $("#pin-term"), steps = $$(".pin-steps li");
    // each frame is a list of lines; each line a list of [class, text] pieces
    const frames = [
      [[["t-p", "$ npm run dev"]], [[null, "Error: listen EADDRINUSE: address already in use :::3000"]]],
      [[["t-p", "$ npm run dev"]], [[null, "Error: listen EADDRINUSE: address already in use :::3000"]], [["t-note", "Debug Anything: the last command's output shows a runtime problem signal (port_busy). Run debuganything port 3000; never kill it blindly."]]],
      [[["t-p", "$ debuganything port 3000"]], [["t-ok", "ok inspect_sockets  81 ms"]], [[null, "  "], ["t-high", "HIGH"], [null, "  port 3000 is held by pid 61326 (node) in LISTEN "], ["t-ev", "[observed; e1,e2]"]], [[null, "        command: node server.js. Debug Anything will not kill it; decide yourself."]]],
    ];
    const paint = (k) => {
      if (!term) return;
      term.replaceChildren();
      frames[k].forEach((line, j) => {
        if (j) term.append("\n");
        for (const [cls, text] of line) term.append(cls ? el("span", cls, text) : document.createTextNode(text));
      });
      steps.forEach((s, i) => s.classList.toggle("on", i === k));
    };
    if (term && steps.length) {
      if (reduce || !("IntersectionObserver" in window) || !matchMedia("(min-width: 1101px)").matches) paint(2);
      else {
        paint(0);
        const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) paint(Number(e.target.dataset.step)); }, { rootMargin: "-45% 0px -45% 0px" });
        steps.forEach((s) => io.observe(s));
      }
    }

    // ---- the "why" dialog ----
    const form = $("#why");
    if (form) {
      const pid = $("#why-pid"), out = $("#why-cmd"), go = $(".dialog-go", form), segs = $$(".seg [role=radio]", form);
      let sym = "slow";
      const sync = () => { const p = (pid.value.match(/\d+/) || ["<pid>"])[0]; out.textContent = `npx debuganything why ${p} --symptom ${sym}`; };
      const choose = (b, focus) => { for (const x of segs) { const on = x === b; x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; } sym = b.dataset.v; sync(); if (focus) b.focus(); };
      segs.forEach((b, i) => {
        b.addEventListener("click", () => choose(b));
        b.addEventListener("keydown", (e) => { const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return; e.preventDefault(); choose(segs[(i + d + segs.length) % segs.length], true); });
      });
      pid.addEventListener("input", sync);
      form.addEventListener("submit", async (e) => {
        e.preventDefault(); sync();
        if (!(await copyText(out.textContent))) return;
        go.textContent = "Copied"; go.classList.add("done");
        setTimeout(() => { go.textContent = "Copy command"; go.classList.remove("done"); }, 1600);
      });
    }

    // ---- community numbers, from this site ----
    (async () => {
      const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      let st = null;
      try { const r = await fetch("/api/stats"); st = r.ok ? await r.json() : null; } catch { /* offline: leave dashes */ }
      if (st && st.stars != null) set("st-stars", fmt(st.stars));
      set("st-npm", st && typeof st.npm === "number" ? fmt(st.npm) : "new");
      set("st-pypi", st && typeof st.pypi === "number" ? fmt(st.pypi) : "new");
      if (st && Array.isArray(st.contributors)) set("st-contrib", fmt(st.contributors.length));
    })();

    // ---- entrances: the parts of each section, in reading order, once ----
    const parts = $$("[data-r]"), groups = new Map();
    for (const p of parts) { const s = p.closest("section, footer") ?? document.body; const l = groups.get(s) ?? []; p.style.setProperty("--d", `${l.length * 80}ms`); l.push(p); groups.set(s, l); }
    if (reduce || !("IntersectionObserver" in window)) parts.forEach((p) => p.classList.add("in"));
    else {
      const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }, { rootMargin: "0px 0px 8% 0px", threshold: 0 });
      parts.forEach((p) => io.observe(p));
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
