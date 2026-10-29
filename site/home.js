// debuganything.dev home. No third-party requests: community numbers come from this site's own /api/stats.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const live = (msg) => { const l = $("#live"); if (l) { l.textContent = ""; setTimeout(() => { l.textContent = msg; }, 30); } };
  const root = document.documentElement;
  root.classList.add("js");
  // the shutter opens once the moth has loaded (or straight away if it is cached)
  const moth = $(".slot img");
  const open = () => requestAnimationFrame(() => root.classList.add("ready"));
  if (!moth || moth.complete) open(); else { moth.addEventListener("load", open, { once: true }); moth.addEventListener("error", open, { once: true }); }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch {
      const a = el("textarea"); a.value = t; a.setAttribute("readonly", ""); a.className = "sr"; document.body.append(a); a.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch { /* no clipboard */ }
      a.remove(); return ok;
    }
  }
  const flash = (b, label) => { const was = b.textContent; b.textContent = "Copied"; b.classList.add("done"); live("Copied to clipboard"); setTimeout(() => { b.textContent = label || was; b.classList.remove("done"); }, 1600); };
  for (const c of $$(".cmd[data-copy]")) {
    const b = $(".copy", c); if (!b) continue;
    b.setAttribute("aria-label", `Copy: ${c.dataset.copy}`);
    b.addEventListener("click", async () => { if (await copyText(c.dataset.copy)) flash(b, "Copy"); else live("Copy failed. Select the command instead."); });
  }
  for (const b of $$("[data-copy-cmd]")) {
    const label = b.textContent;
    b.addEventListener("click", async () => { if (await copyText(b.dataset.copyCmd)) flash(b, label); else live("Copy failed."); });
  }

  // ---- tell it what you see: symptoms → real sessions ----
  const cases = [
    { k: ["memory", "leak", "heap", "grow", "oom", "ram"], t: "A list that only ever grows.", run: "debuganything memory --session $S   # twice\ndebuganything diff --session $S", out: [["high", "Array grew 2.0 KB → 87.7 MB, held by Context.retained", "diff_runs#6/e4"], ["warn", "rss grew 47.2 MB → 323.0 MB (+584%)", "diff_runs#6/e1"]], fix: "A module-level cache that is only appended to. Bound it with an LRU or a TTL." },
    { k: ["port", "eaddrinuse", "in use", "address"], t: "An old dev server still holds the port.", run: "debuganything port 3000", out: [["high", "port 3000 is held by pid 61326 (node) in LISTEN", "inspect_sockets#1/e1"]], fix: "An orphaned child from the previous run. It names the process; you decide whether to stop it." },
    { k: ["stop", "stuck", "hang", "freeze", "frozen", "deadlock", "stall"], t: "Two threads wait for each other.", run: "debuganything why 5570 --symptom hang", out: [["high", "likely deadlock: worker_ab (app.py:38) holds lock_b; worker_ba (app.py:45) holds lock_a", "dump_stacks#1/e14"]], fix: "Two code paths take the same two locks in opposite order. Take them in one order everywhere." },
    { k: ["open files", "emfile", "file", "fd", "2 am", "socket", "close_wait"], t: "Connections that are never let go.", run: "debuganything sockets --session $S\ndebuganything files --session $S", out: [["high", "412 sockets in CLOSE_WAIT: the peer closed, the app never called close()", "inspect_sockets#2/e2"], ["high", "980 fds open vs soft limit 1024 (96%)", "inspect_files#1/e4"]], fix: "Set the server's keep-alive timeout below the load balancer's idle timeout." },
    { k: ["slow", "latency", "p99", "cpu", "lag"], t: "A file read on every request.", run: "debuganything profile --session $S --duration 10", out: [["warn", "one frame accounts for 58.3% of CPU work", "profile_cpu#1/e2"], ["warn", "18000 path lookups in 8 s: filesystem churn", "trace_syscalls#2/e1"]], fix: "readFileSync on the request path. Read it once and cache it." },
    { k: ["disk", "full", "space", "du "], t: "A deleted log still held open.", run: "debuganything files --session $S", out: [["high", "1 file deleted while still open holds 38.2 GB", "inspect_files#1/e5"]], fix: "logrotate deleted it; the process still holds fd 7. Use copytruncate or send the reopen signal." },
  ];
  const q = $("#q"), answer = $("#answer");
  const pick = (text) => {
    const s = text.toLowerCase();
    let best = null, score = 0;
    for (const c of cases) { const n = c.k.filter((k) => s.includes(k)).length; if (n > score) { score = n; best = c; } }
    return best;
  };
  const render = () => {
    if (!q || !answer) return;
    const c = pick(q.value);
    if (!c) {
      answer.replaceChildren(el("p", "a-title", "Describe it the way you would to a colleague."), el("p", "a-fix", "Try slow, stuck, a memory leak, a busy port or too many open files."));
      return;
    }
    const pre = el("pre"); pre.setAttribute("translate", "no");
    pre.append(el("span", "t-cmd", c.run.split("\n").map((l) => "$ " + l).join("\n")));
    for (const [sev, text, ev] of c.out) { pre.append("\n", el("span", sev === "high" ? "t-high" : "t-warn", sev.toUpperCase()), "  " + text + "  ", el("span", "t-ev", ev)); }
    answer.replaceChildren(el("p", "a-title", c.t), pre, el("p", "a-fix", c.fix));
  };
  if (q) {
    // the example is there to be replaced: focusing the line selects it
    q.addEventListener("focus", () => setTimeout(() => q.select(), 0));
    q.addEventListener("input", () => { $$(".examples button").forEach((b) => b.setAttribute("aria-pressed", "false")); render(); });
    for (const b of $$(".examples button")) {
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => { q.value = b.dataset.q; $$(".examples button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); render(); });
    }
    render();
  }

  // ---- how it works: one slider drives both fields ----
  const stages = [
    ["First, it attaches to the process.", "By pid, container, pod or a command it starts for you. Nothing is installed in your app."],
    ["Then it observes, inside hard limits.", "The right tool for the symptom: heap snapshots, CPU profiles, stacks, sockets. Each run is capped and kept on disk."],
    ["Every finding cites its evidence.", "Observed or inferred, with ids that point at the raw output. A claim without evidence is dropped."],
    ["It writes the report and leaves.", "Findings, the commands that produced them and what the tools could not see. Then it detaches."],
  ];
  const range = $("#stage"), clause = $("#clause"), note = $("#clause-note"), fill = $("#track-fill");
  const names = $$(".stage-names li"), frags = $$(".frag[data-stage]");
  const video = $(".frag video"), vbtn = $(".vid-toggle");
  let userPaused = false;
  const setStage = (i) => {
    clause.textContent = stages[i][0]; note.textContent = stages[i][1];
    names.forEach((n, j) => n.classList.toggle("on", j === i));
    frags.forEach((f) => { f.hidden = Number(f.dataset.stage) !== i; });
    range.setAttribute("aria-valuetext", names[i].textContent);
    if (fill) fill.style.width = `calc(${(i / 3) * 100}% - ${(i / 3) * 32}px + 16px)`;
    if (video) { if (i === 1 && !userPaused && !reduce) { video.preload = "auto"; video.play().catch(() => {}); } else video.pause(); }
  };
  if (range) { range.addEventListener("input", () => setStage(Number(range.value))); setStage(0); }
  if (vbtn && video) vbtn.addEventListener("click", () => {
    if (video.paused) { userPaused = false; video.play().catch(() => {}); vbtn.textContent = "Pause"; vbtn.setAttribute("aria-pressed", "false"); }
    else { userPaused = true; video.pause(); vbtn.textContent = "Play"; vbtn.setAttribute("aria-pressed", "true"); }
  });
  if (video && reduce && vbtn) vbtn.textContent = "Play";

  // ---- names: one lit at a time ----
  const ns = $$(".names .n");
  if (ns.length) {
    let i = 0; ns[0].classList.add("lit");
    if (!reduce) setInterval(() => { ns[i].classList.remove("lit"); i = (i + 1) % ns.length; ns[i].classList.add("lit"); }, 2000);
  }

  // ---- sentences with switches ----
  for (const sw of $$(".band .sw")) {
    const band = sw.closest(".band");
    const sync = () => band.classList.toggle("on", sw.getAttribute("aria-checked") === "true");
    sw.addEventListener("click", () => { sw.setAttribute("aria-checked", String(sw.getAttribute("aria-checked") !== "true")); sync(); });
    sync();
  }

  // ---- community numbers, from this site ----
  (async () => {
    const out = $("#stats"); if (!out) return;
    const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
    let st = null;
    try { const r = await fetch("/api/stats"); st = r.ok ? await r.json() : null; } catch { /* offline */ }
    if (!st) return;
    const parts = [];
    if (typeof st.stars === "number" && st.stars > 0) parts.push(`${fmt(st.stars)} GitHub stars`);
    if (typeof st.npm === "number" && st.npm > 0) parts.push(`${fmt(st.npm)} npm downloads last month`);
    out.textContent = parts.join(" · ");
  })();

  // ---- entrances ----
  const parts = $$(".split-text, .logbook-fig, .answer, .names, .band, .qa, .how-fields");
  if (!reduce && "IntersectionObserver" in window) {
    parts.forEach((p) => p.classList.add("reveal"));
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }, { rootMargin: "0px 0px -6% 0px" });
    parts.forEach((p) => io.observe(p));
  }
})();
