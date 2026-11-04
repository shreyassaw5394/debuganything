import { analyzeText, detectTool } from "/assets/debuganything-web.js";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const SAMPLES = {
  deadlock: `Thread 0x7F0A1 (active): "MainThread"\n    acquire (threading.py:123)\n    __enter__ (threading.py:265)\n    transfer (bank.py:41)\n    <module> (bank.py:88)\nThread 0x7F0A2 (active): "worker-1"\n    acquire (threading.py:123)\n    __enter__ (threading.py:265)\n    transfer (bank.py:44)\n    run (threading.py:982)`,
  closewait: `p1234
cnode
u501
f12
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53200
TST=CLOSE_WAIT
f13
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53201
TST=CLOSE_WAIT
f14
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53202
TST=CLOSE_WAIT
f15
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53203
TST=CLOSE_WAIT
f16
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53204
TST=CLOSE_WAIT
f17
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53205
TST=CLOSE_WAIT
f18
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53206
TST=CLOSE_WAIT
f19
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53207
TST=CLOSE_WAIT
f20
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53208
TST=CLOSE_WAIT
f21
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53209
TST=CLOSE_WAIT
f22
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53210
TST=CLOSE_WAIT
f23
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53211
TST=CLOSE_WAIT
f24
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53212
TST=CLOSE_WAIT
f25
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53213
TST=CLOSE_WAIT
f26
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53214
TST=CLOSE_WAIT
f27
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53215
TST=CLOSE_WAIT
f28
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53216
TST=CLOSE_WAIT
f29
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53217
TST=CLOSE_WAIT
f30
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53218
TST=CLOSE_WAIT
f31
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53219
TST=CLOSE_WAIT
f32
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53220
TST=CLOSE_WAIT
f33
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53221
TST=CLOSE_WAIT
f34
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53222
TST=CLOSE_WAIT
f35
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53223
TST=CLOSE_WAIT
f36
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53224
TST=CLOSE_WAIT
f37
au
tIPv4
PTCP
n127.0.0.1:8080->127.0.0.1:53225
TST=CLOSE_WAIT`,
};
document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", () => { $("#in").value = SAMPLES[b.dataset.sample]; $("#tool").value = b.dataset.sample === "deadlock" ? "pyspy_dump" : "lsof"; run(); }));
async function run() {
  const raw = $("#in").value;
  if (!raw.trim()) { $("#status").textContent = "paste something first"; return; }
  let tool = $("#tool").value || detectTool(raw);
  if (!tool) { $("#status").textContent = "couldn't auto-detect the tool — pick it from the list"; return; }
  $("#status").textContent = `analyzing as ${tool}…`;
  const r = await analyzeText(tool, raw);
  $("#status").textContent = "";
  const ev = new Map(r.evidence.map((e) => [e.id, e]));
  const sevRank = { high: 0, warn: 1, info: 2 };
  const findings = [...r.findings].sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3));
  $("#out").innerHTML = r.ok
    ? `<div class="panel"><b>${findings.length} finding${findings.length === 1 ? "" : "s"}</b> <span class="hint">· ${r.evidence.length} pieces of evidence · analyzed as ${esc(tool)}</span>
       ${findings.map((f) => `
        <div class="finding ${f.severity}">
          <span class="sev">${f.severity}</span> &nbsp;${esc(f.summary)}${f.detail ? `<div class="hint" style="margin-top:4px">${esc(f.detail)}</div>` : ""}
          <div class="ev">${f.evidence_ids.map((id) => { const e = ev.get(id); return e ? `<div><code>${esc(e.id)}</code> ${esc(e.summary)}</div>` : ""; }).join("")}</div>
        </div>`).join("")}
       ${r.suggested_next?.length ? `<details><summary>what Debug Anything would look at next</summary><div class="lim">${r.suggested_next.map(esc).join(" · ")}</div></details>` : ""}
       ${r.limitations?.length ? `<div class="lim">${r.limitations.map(esc).join("<br>")}</div>` : ""}
      </div>`
    : `<div class="panel"><b>Could not analyze:</b> <span class="hint">${esc(r.error ?? "unknown error")}</span></div>`;
  $("#cta").hidden = false;
  $("#out").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#go").addEventListener("click", run);
