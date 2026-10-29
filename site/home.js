// debuganything.dev. No third-party requests, no cookies; optional analytics only after consent (consent.js).
// The signal trace, the symptom picker, the incident switches, copy boxes, tabs, the pid blank, entrances.
(() => {
  const root = document.documentElement;
  root.classList.add("js");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const live = (t) => { const l = $("#live"); if (l) { l.textContent = ""; setTimeout(() => { l.textContent = t; }, 30); } };
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); live(`Copied: ${text}`); return true; }
    catch {
      const a = document.createElement("textarea"); a.value = text; a.setAttribute("readonly", ""); a.className = "sr"; document.body.append(a); a.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch { /* no clipboard */ }
      a.remove(); if (ok) live(`Copied: ${text}`); return ok;
    }
  };

  // ---- preview colour choice (?c=magenta|acid|ice) ----
  const accents = { blue: "59,91,255", magenta: "255,61,127", acid: "212,255,58", ice: "58,209,255" };
  const setC = (c) => {
    if (!accents[c]) c = "blue";
    if (c === "blue") delete root.dataset.c; else root.dataset.c = c;
    $$(".swatch button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === c)));
    try { localStorage.setItem("dea_c", c); } catch { /* private mode */ }
  };
  let startC = new URLSearchParams(location.search).get("c");
  if (!startC) { try { startC = localStorage.getItem("dea_c"); } catch { /* none */ } }
  setC(startC || "blue");
  $$(".swatch button").forEach((b) => b.addEventListener("click", () => setC(b.dataset.c)));
  const accRGB = () => getComputedStyle(root).getPropertyValue("--acc-rgb").trim() || accents.blue;

  // ---- copy boxes ----
  for (const b of $$(".cmd[data-copy]")) {
    b.addEventListener("click", async () => {
      if (!(await copyText(b.dataset.copy))) return;
      const act = $(".cmd-act", b);
      b.classList.add("done");
      if (act) act.textContent = "Copied";
      setTimeout(() => { b.classList.remove("done"); if (act) act.textContent = "Copy"; }, 1600);
    });
  }

  // ---- tabs ----
  for (const box of $$("[data-tabs]")) {
    const tabs = $$('[role="tab"]', box);
    const select = (tab) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      }
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(t));
      t.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        select(next); next.focus();
      });
    });
  }

  // ---- the symptom picker: real answers from real runs ----
  const show = $("#symptoms");
  if (show) {
    const radios = $$('[role="radio"]', show);
    const verdict = $("#verdict"), resp = $("#resp code");
    const answers = {
      leak: { field: "bad", word: "array", text: "$ debuganything diff --session $S\nHIGH  Array grew 2.0 KB → 87.7 MB   diff_runs#6/e4" },
      hang: { field: "ok", word: "deadlock", text: "$ debuganything why 5570 --symptom hang\nHIGH  worker_ab holds lock_b, worker_ba holds lock_a   dump_stacks#1/e14" },
      port: { field: "mid", word: "process", text: "$ debuganything port 3000\nHIGH  port 3000 held by pid 61326 (node) in LISTEN   inspect_sockets#1/e1" },
    };
    const pick = (r, focus) => {
      for (const x of radios) { const on = x === r; x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; }
      const a = answers[r.dataset.s];
      show.dataset.field = a.field;
      verdict.textContent = a.word;
      resp.textContent = a.text;
      if (focus) r.focus();
    };
    radios.forEach((r, i) => {
      r.addEventListener("click", () => pick(r));
      r.addEventListener("keydown", (e) => {
        const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        pick(radios[(i + d + radios.length) % radios.length], true);
      });
    });
  }

  // ---- incident switches ----
  for (const band of $$(".band")) {
    const sw = $(".sw", band);
    const set = (on) => { sw.setAttribute("aria-checked", String(on)); band.classList.toggle("on", on); };
    set(sw.getAttribute("aria-checked") === "true");
    sw.addEventListener("click", () => set(sw.getAttribute("aria-checked") !== "true"));
  }

  // ---- the sentence with a blank: ask why pid ___ ----
  const form = $("#blank");
  if (form) {
    const input = $("#pid"), out = $("#blank-cmd"), btn = $("button", form);
    const clean = () => (input.value.replace(/\D/g, "").slice(0, 8) || "<pid>");
    const sync = () => { out.textContent = `npx debuganything why ${clean()} --symptom slow`; };
    input.addEventListener("input", sync);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      sync();
      if (!(await copyText(out.textContent))) return;
      btn.textContent = "Copied"; btn.classList.add("done");
      setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1600);
    });
  }

  // ---- entrances ----
  const parts = $$("[data-r]");
  const groups = new Map();
  for (const p of parts) {
    const sec = p.closest("section, footer") ?? document.body;
    const list = groups.get(sec) ?? [];
    p.style.setProperty("--d", `${list.length * 80}ms`);
    list.push(p); groups.set(sec, list);
  }
  const stage = $("#stage"), video = $(".stage-video");
  if (reduce || !("IntersectionObserver" in window)) {
    parts.forEach((p) => p.classList.add("in"));
    stage?.classList.add("is-in");
  } else {
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px 8% 0px", threshold: 0 });
    parts.forEach((p) => io.observe(p));
    if (stage) requestAnimationFrame(() => setTimeout(() => stage.classList.add("is-in"), 250));
  }
  // the session recording plays only while on screen, never under reduced motion, and can be paused
  if (video && !reduce && "IntersectionObserver" in window) {
    const ctl = $(".vid-ctl");
    let userPaused = false;
    const label = () => { if (ctl) ctl.textContent = video.paused ? "Play" : "Pause"; };
    video.addEventListener("play", label); video.addEventListener("pause", label);
    if (ctl) { ctl.hidden = false; ctl.addEventListener("click", () => { userPaused = !video.paused; if (userPaused) video.pause(); else video.play().catch(() => {}); }); }
    new IntersectionObserver((es) => { for (const e of es) { if (e.isIntersecting && !userPaused) video.play().catch(() => {}); else video.pause(); } }, { threshold: 0.2 }).observe(video);
  }

  // ---- the signal trace: a live process seen through the tools, spikes tagged with their evidence ----
  // taste-skill-ignore: the hero sky is the owner's chosen signature picture (as on Mock Anything), drawn in code
  const canvas = $("#sky");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, stars = [], raf = 0, visible = true;
    const t0 = performance.now();
    const tags = ["snapshot_memory#2", "profile_cpu#1", "dump_stacks#1", "inspect_sockets#2", "diff_runs#6/e4", "trace_syscalls#3"];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      stars = Array.from({ length: Math.round((w * h) / 5200) }, () => ({ x: rnd() * w, y: rnd() * h, r: rnd() * 1.1 + 0.2, p: rnd() * Math.PI * 2, s: 0.4 + rnd() * 1.2 }));
      draw(performance.now());
    };
    // one heartbeat: the logo's zigzag, then flat
    const beat = (u) => {
      if (u < 0.08) return 0;
      if (u < 0.11) return -0.9 * ((u - 0.08) / 0.03);
      if (u < 0.15) return -0.9 + 2.1 * ((u - 0.11) / 0.04);
      if (u < 0.18) return 1.2 - 1.6 * ((u - 0.15) / 0.03);
      if (u < 0.2) return -0.4 + 0.4 * ((u - 0.18) / 0.02);
      return 0;
    };
    const draw = (now) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const st of stars) {
        ctx.fillStyle = `rgba(236,235,231,${reduce ? 0.5 : 0.25 + 0.3 * Math.sin(st.p + t * st.s)})`;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
      }
      const wide = w > 1000;
      const x0 = wide ? w * 0.42 : 0, x1 = w, cy = wide ? h * 0.3 : 112, amp = wide ? Math.min(h * 0.11, 90) : 24;
      const period = wide ? 360 : 240, speed = reduce ? 0 : 70;
      const shift = t * speed;
      // faint graticule
      ctx.strokeStyle = "rgba(236,235,231,0.06)"; ctx.lineWidth = 1;
      for (let gx = x0 - ((shift) % 60); gx < x1; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, cy - amp * 1.6); ctx.lineTo(gx, cy + amp * 1.6); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
      // the trace, brightening towards the beam head at the right
      const rgb = accRGB();
      const head = x0 + (x1 - x0) * 0.86;
      ctx.lineWidth = 2; ctx.lineJoin = "round";
      let prev = null;
      for (let x = x0; x <= head; x += 2) {
        const u = (((x + shift) % period) + period) % period / period;
        const y = cy + beat(u) * amp;
        if (prev) {
          const a = Math.max(0, (x - x0) / (head - x0));
          ctx.strokeStyle = `rgba(${rgb},${0.08 + 0.85 * a * a})`;
          ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(x, y); ctx.stroke();
        }
        prev = [x, y];
      }
      // beam head
      if (prev) {
        const g = ctx.createRadialGradient(prev[0], prev[1], 0, prev[0], prev[1], 26); // taste-skill-ignore: phosphor glow of the beam head
        g.addColorStop(0, `rgba(${rgb},0.7)`); g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(prev[0], prev[1], 26, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(prev[0], prev[1], 2.6, 0, Math.PI * 2); ctx.fill();
      }
      // evidence tags on the peaks
      ctx.font = "12px ui-monospace, Menlo, monospace";
      for (let k = Math.floor((x0 + shift) / period); k * period - shift < head; k++) {
        const px = k * period - shift + period * 0.15;
        if (px < x0 + 10 || px > head - 10) continue;
        const a = Math.max(0, (px - x0) / (head - x0));
        ctx.fillStyle = `rgba(236,235,231,${0.15 + 0.6 * a})`;
        ctx.fillText(tags[((k % tags.length) + tags.length) % tags.length], px + 8, cy - amp * 1.25);
        ctx.fillRect(px, cy - amp * 1.2 + 2, 1, amp * 0.25);
      }
    };
    const loop = (now) => { draw(now); raf = visible && !document.hidden ? requestAnimationFrame(loop) : 0; };
    const start = () => { if (!reduce && !raf && visible && !document.hidden) raf = requestAnimationFrame(loop); };
    new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); start(); }).observe(canvas);
    document.addEventListener("visibilitychange", start);
    let rt = 0;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(resize, 120); });
    $$(".swatch button").forEach((b) => b.addEventListener("click", () => draw(performance.now())));
    resize(); start();
  }
})();
