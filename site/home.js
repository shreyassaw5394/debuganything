// debuganything.dev. No third-party requests, no cookies; optional analytics only after consent (consent.js).
// Evidence markers on the scene, the case files, tabs, the case form, copy boxes, entrances.
(() => {
  const root = document.documentElement;
  root.classList.add("js");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const live = (t) => { const l = $("#live"); if (l) { l.textContent = ""; setTimeout(() => { l.textContent = t; }, 30); } };
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); live(`Copied: ${text}`); return true; }
    catch {
      const a = el("textarea"); a.value = text; a.setAttribute("readonly", ""); a.className = "sr"; document.body.append(a); a.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch { /* no clipboard */ }
      a.remove(); if (ok) live(`Copied: ${text}`); return ok;
    }
  };
  const flash = (b) => { const act = $(".cmd-act", b); b.classList.add("done"); if (act) act.textContent = "Copied"; setTimeout(() => { b.classList.remove("done"); if (act) act.textContent = "Copy"; }, 1600); };

  // ---- copy boxes ----
  for (const b of $$(".cmd[data-copy]")) b.addEventListener("click", async () => { if (await copyText(b.dataset.copy)) flash(b); });

  // ---- tabs ----
  for (const box of $$("[data-tabs]")) {
    const tabs = $$('[role="tab"]', box);
    const select = (tab) => { for (const t of tabs) { const on = t === tab; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; document.getElementById(t.getAttribute("aria-controls")).hidden = !on; } };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(t));
      t.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        select(next); next.focus();
      });
    });
  }

  // ---- the scene: evidence markers with a glass card ----
  const ev = {
    1: ["Evidence 1 · attach#1/e1", "Attached to pid 34327, a Node.js server. Nothing was injected into it."],
    2: ["Evidence 2 · snapshot_memory#2/e2", "The baseline: RSS 47.2 MB, stable over 3 seconds."],
    3: ["Evidence 3 · snapshot_memory#3/e5", "After 300 requests one Array retains 37.6 MB, 85% of the heap, held by Context.retained."],
    4: ["Evidence 4 · diff_runs#6/e4", "Between the first and last snapshot the Array grew from 2.0 KB to 87.7 MB. That is the leak."],
  };
  const scene = $(".scene"), tip = $("#tip");
  if (scene && tip) {
    const marks = $$(".scene .mk");
    const show = (m) => {
      const [t, d] = ev[m.dataset.e];
      tip.replaceChildren(el("b", null, t), el("span", null, d));
      marks.forEach((x) => x.setAttribute("aria-pressed", String(x === m)));
      const sr = scene.getBoundingClientRect(), mr = m.getBoundingClientRect();
      const w = tip.offsetWidth || 300;
      let left = mr.left - sr.left + mr.width / 2 - w / 2;
      left = Math.max(12, Math.min(left, sr.width - w - 12));
      let top = mr.top - sr.top - tip.offsetHeight - 12;
      if (top < 8) top = mr.bottom - sr.top + 12;
      tip.style.left = `${left}px`; tip.style.top = `${top}px`;
      tip.hidden = false;
    };
    marks.forEach((m, i) => {
      m.style.setProperty("--md", `${600 + i * 260}ms`);
      m.setAttribute("aria-pressed", "false");
      m.addEventListener("click", () => show(m));
      m.addEventListener("mouseenter", () => show(m));
      m.addEventListener("focus", () => show(m));
    });
    const last = marks[marks.length - 1];
    const drop = () => { scene.classList.add("dropped"); setTimeout(() => show(last), reduce ? 0 : 1900); };
    if (reduce || !("IntersectionObserver" in window)) drop();
    else new IntersectionObserver((es, io) => { if (es.some((e) => e.isIntersecting)) { drop(); io.disconnect(); } }, { threshold: 0.3 }).observe(scene);
    window.addEventListener("resize", () => { const on = marks.find((m) => m.getAttribute("aria-pressed") === "true"); if (on) show(on); });
  }

  // ---- case files ----
  const cases = [
    { t: "Memory keeps growing", said: "A Node.js server's memory climbs until the container is killed.", ran: "debuganything memory --session $S   # before and after load\ndebuganything diff --session $S", ev: [["Array grew 2.0 KB → 87.7 MB", "diff_runs#6/e4"], ["Array retains 93% of the heap, held by Context.retained", "snapshot_memory#5/e5"]], fix: "A module-level cache that is only appended to. Bound it with an LRU or a TTL." },
    { t: "The worker just stops", said: "Throughput drops to zero every few hours. CPU idle. A restart fixes it.", ran: "debuganything why 5570 --symptom hang", ev: [["worker_ab (app.py:38) holds lock_b and waits for lock_a", "dump_stacks#1/e14"], ["worker_ba (app.py:45) holds lock_a and waits for lock_b", "dump_stacks#1/e1"]], fix: "Two code paths take the same two locks in opposite order. Take them in one order everywhere." },
    { t: "Port 3000 is taken", said: "npm run dev fails with EADDRINUSE. Nothing obvious is running.", ran: "debuganything port 3000", ev: [["port 3000 is held by pid 61326 (node) in LISTEN", "inspect_sockets#1/e1"]], fix: "An orphaned dev server from the last run. It names the process; you decide whether to stop it." },
    { t: "Too many open files at 2 am", said: "500s a few hours after deploy. A restart fixes it.", ran: "debuganything sockets --session $S\ndebuganything files --session $S", ev: [["412 sockets in CLOSE_WAIT: the app never called close()", "inspect_sockets#2/e2"], ["980 file descriptors open against a limit of 1024", "inspect_files#1/e4"]], fix: "Set the server's keep-alive timeout below the load balancer's idle timeout." },
    { t: "p99 is 1.4 seconds", said: "p50 is 20 ms, but one core is pegged in bursts.", ran: "debuganything profile --session $S --duration 10", ev: [["one frame takes 58.3% of CPU work", "profile_cpu#1/e2"], ["18,000 path lookups in 8 s", "trace_syscalls#2/e1"]], fix: "A file is read from disk on every request. Read it once and cache it." },
  ];
  const list = $("#case-list"), panel = $("#case");
  if (list && panel) {
    const render = (i, focus) => {
      const c = cases[i];
      $$("button", list).forEach((b, j) => { const on = j === i; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      panel.setAttribute("aria-labelledby", `cf-${i}`);
      const dl = el("dl");
      const row = (k, v) => { const d = el("div"); d.append(el("dt", null, k), v); dl.append(d); };
      const ran = el("pre"); ran.setAttribute("translate", "no"); ran.textContent = c.ran.split("\n").map((l) => "$ " + l).join("\n");
      row("It ran", el("dd", null)); dl.lastChild.lastChild.append(ran);
      const evs = el("dd");
      c.ev.forEach(([text, id], k) => { const r = el("div", "ev"); const m = el("span", "mk mk-s", String(k + 1)); m.setAttribute("aria-hidden", "true"); const body = el("div"); body.append(el("span", null, text), el("code", null, id)); r.append(m, body); evs.append(r); });
      row("Evidence", evs);
      row("The fix", el("dd", null, c.fix));
      panel.replaceChildren(el("h3", null, c.t), el("p", "said", c.said), dl);
    };
    cases.forEach((c, i) => {
      const b = el("button"); b.type = "button"; b.id = `cf-${i}`; b.setAttribute("role", "tab"); b.setAttribute("aria-controls", "case");
      b.append(el("span", null, `${c.ev.length} ${c.ev.length === 1 ? "item" : "items"}`), document.createTextNode(c.t));
      b.addEventListener("click", () => render(i));
      b.addEventListener("keydown", (e) => {
        const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (e.key === "Home") { e.preventDefault(); render(0, true); }
        else if (e.key === "End") { e.preventDefault(); render(cases.length - 1, true); }
        else if (d) { e.preventDefault(); render((i + d + cases.length) % cases.length, true); }
      });
      list.append(b);
    });
    render(0);
  }

  // ---- open a case ----
  const form = $("#case-form");
  if (form) {
    const pid = $("#pid"), out = $("#case-cmd"), go = $(".f-go", form);
    const sync = () => { const p = pid.value.replace(/\D/g, "").slice(0, 8) || "<pid>"; const s = ($('input[name="sym"]:checked', form) || {}).value || "slow"; out.textContent = `npx debuganything why ${p} --symptom ${s}`; };
    form.addEventListener("input", sync); form.addEventListener("change", sync);
    form.addEventListener("submit", async (e) => { e.preventDefault(); sync(); if (await copyText(out.textContent)) flash(go); });
    sync();
  }

  // ---- the exhibit video: plays only when asked ----
  const vid = $(".ex video"), vbtn = $(".ex .vid-ctl");
  if (vid && vbtn) {
    vbtn.hidden = false;
    const label = () => { vbtn.textContent = vid.paused ? "Play" : "Pause"; };
    vid.addEventListener("play", label); vid.addEventListener("pause", label);
    vbtn.addEventListener("click", () => { if (vid.paused) { vid.preload = "auto"; vid.play().catch(() => {}); } else vid.pause(); });
  }

  // ---- entrances ----
  const parts = $$("[data-r]");
  const groups = new Map();
  for (const p of parts) { const sec = p.closest("section, footer") ?? document.body; const l = groups.get(sec) ?? []; p.style.setProperty("--d", `${l.length * 80}ms`); l.push(p); groups.set(sec, l); }
  if (reduce || !("IntersectionObserver" in window)) parts.forEach((p) => p.classList.add("in"));
  else {
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }, { rootMargin: "0px 0px 8% 0px", threshold: 0 });
    parts.forEach((p) => io.observe(p));
  }
})();
