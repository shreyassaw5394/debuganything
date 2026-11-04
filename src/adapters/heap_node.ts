/**
 * Node heap adapter: snapshot_memory for Node targets via the inspector
 * protocol. Only an inspector port owned by the target's pid tree is used. If
 * the target was not started with --inspect and the caller passed consent, we
 * send SIGUSR1 (Node's documented "activate inspector" signal), connect over
 * WebSocket to 127.0.0.1:9229, take a HeapProfiler.takeHeapSnapshot, and
 * summarize the top retainers by retained size. The inspector stays enabled on
 * the target afterwards (reported as a warn finding). dump_stacks for Node also
 * uses the inspector (Debugger.pause → call frames) when available.
 */
import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import type { Adapter, AdapterContext } from "./types.js";
import type { ToolResult } from "../contracts.js";
import { ResultBuilder, humanBytes } from "../evidence.js";
import { runCapped, LIMITS } from "../safety.js";
import { snapshotMemoryGeneric } from "./psmem.js";
import { mergeResults } from "./pyspy.js";
import { targetPids } from "../target.js";
import type { Target } from "../contracts.js";

// ---------------------------------------------------------------------------
// Heap snapshot parsing (pure, streaming-free; snapshots up to a few hundred MB)
// ---------------------------------------------------------------------------

export interface HeapSummary {
  node_count: number;
  edge_count: number;
  total_size: number;
  byType: Array<{ type: string; count: number; self_size: number }>;
  byName: Array<{ name: string; type: string; count: number; self_size: number }>;
  topRetained: Array<{ name: string; type: string; retained_bytes: number; self_size: number; retainer?: string; idx?: number }>;
}

interface HeapSnapshot {
  snapshot: { meta: { node_fields: string[]; node_types: Array<string[] | string>; edge_fields: string[]; edge_types: Array<string[] | string> }; node_count: number; edge_count: number };
  nodes: number[];
  edges: number[];
  strings: string[];
}

/**
 * Summarize a V8 .heapsnapshot: aggregate by constructor/type (self size) and
 * compute retained size with a dominator-ish approximation (sum of self sizes
 * in a DFS over "strong" edges from the top N largest nodes). Pure.
 */
export function summarizeHeapSnapshot(json: string, topN = 15): HeapSummary {
  const snap = JSON.parse(json) as HeapSnapshot;
  const nf = snap.snapshot.meta.node_fields;
  const ef = snap.snapshot.meta.edge_fields;
  const nodeTypes = snap.snapshot.meta.node_types[0] as string[];
  const edgeTypes = snap.snapshot.meta.edge_types[0] as string[];
  const NF = nf.length;
  const EF = ef.length;
  const iType = nf.indexOf("type");
  const iName = nf.indexOf("name");
  const iSize = nf.indexOf("self_size");
  const iEdges = nf.indexOf("edge_count");
  const eType = ef.indexOf("type");
  const eName = ef.indexOf("name_or_index");
  const eTo = ef.indexOf("to_node");
  const nodes = snap.nodes;
  const edges = snap.edges;
  const strings = snap.strings;
  const n = nodes.length / NF;

  // First edge index per node.
  const firstEdge = new Uint32Array(n + 1);
  for (let i = 0, e = 0; i < n; i++) {
    firstEdge[i] = e;
    e += nodes[i * NF + iEdges]! * EF;
  }
  firstEdge[n] = edges.length;

  const byType = new Map<string, { count: number; self_size: number }>();
  const byName = new Map<string, { type: string; count: number; self_size: number }>();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const t = nodeTypes[nodes[i * NF + iType]!] ?? "?";
    const nm = strings[nodes[i * NF + iName]!] ?? "?";
    const s = nodes[i * NF + iSize]!;
    total += s;
    const bt = byType.get(t) ?? { count: 0, self_size: 0 };
    bt.count++;
    bt.self_size += s;
    byType.set(t, bt);
    const key = t === "object" || t === "closure" || t === "array" ? nm : `(${t})`;
    const bn = byName.get(key) ?? { type: t, count: 0, self_size: 0 };
    bn.count++;
    bn.self_size += s;
    byName.set(key, bn);
  }

  // Exact retained size for a bounded candidate set: retained(c) = |reachable(root)| − |reachable(root) without c|
  // (the set c dominates). One BFS per candidate over strong edges; ~100k nodes × ~60 candidates stays well under a second.
  const weakIdx = edgeTypes.indexOf("weak");
  const shortcutIdx = edgeTypes.indexOf("shortcut");
  const traversable = (etIdx: number) => etIdx !== weakIdx && etIdx !== shortcutIdx;
  const strong = new Set(["property", "element", "internal", "hidden", "shortcut", "context"].map((t) => edgeTypes.indexOf(t)).filter((i) => i >= 0));
  const typeOf = (i: number) => nodeTypes[nodes[i * NF + iType]!] ?? "?";
  const nameOf = (i: number) => strings[nodes[i * NF + iName]!] ?? "?";
  const reach = (skip: number): { count: number; bytes: number } => {
    const visited = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    queue[tail++] = 0;
    visited[0] = 1;
    let bytes = 0;
    let count = 0;
    while (head < tail) {
      const i = queue[head++]!;
      count++;
      bytes += nodes[i * NF + iSize]!;
      for (let e = firstEdge[i]!; e < firstEdge[i + 1]!; e += EF) {
        if (!traversable(edges[e + eType]!)) continue;
        const to = edges[e + eTo]! / NF;
        if (to === skip || visited[to]) continue;
        visited[to] = 1;
        queue[tail++] = to;
      }
    }
    return { count, bytes };
  };
  const full = reach(-1);
  const candidates = new Set<number>();
  const bySelf = Array.from({ length: n }, (_, i) => i).sort((a, b) => nodes[b * NF + iSize]! - nodes[a * NF + iSize]!).slice(0, 30);
  for (const i of bySelf) candidates.add(i);
  // Nodes with the most outgoing edges (big arrays/maps holding many objects).
  const byEdges = Array.from({ length: n }, (_, i) => i).sort((a, b) => nodes[b * NF + iEdges]! - nodes[a * NF + iEdges]!).slice(0, 30);
  for (const i of byEdges) candidates.add(i);

  const retained: HeapSummary["topRetained"] = [];
  // Internal backing stores ("(object elements)", "(array)", shapes, code) are always owned by a visible
  // object that we would list anyway; skip them so the top list names things a developer recognizes.
  const skipTypes = new Set(["synthetic", "hidden", "array", "code", "object shape", "number", "bigint", "symbol", "regexp"]);
  for (const start of candidates) {
    if (start === 0 || skipTypes.has(typeOf(start))) continue;
    if (nameOf(start).startsWith("(") && typeOf(start) !== "native") continue;
    const without = reach(start);
    const sum = Math.max(nodes[start * NF + iSize]!, full.bytes - without.bytes);
    retained.push({ name: nameOf(start).slice(0, 80) || `(${typeOf(start)})`, type: typeOf(start), retained_bytes: sum, self_size: nodes[start * NF + iSize]!, idx: start });
  }
  // Retainer for top entries: the first incoming strong edge, preferring named (property/context) edges.
  retained.sort((a, b) => b.retained_bytes - a.retained_bytes);
  const top = retained.slice(0, topN);
  const wanted = new Map<number, HeapSummary["topRetained"][number]>();
  for (const r of top) if (r.idx !== undefined) wanted.set(r.idx, r);
  const best = new Map<number, { score: number; label: string }>();
  for (let i = 0; i < n && wanted.size; i++) {
    for (let e = firstEdge[i]!; e < firstEdge[i + 1]!; e += EF) {
      const to = edges[e + eTo]! / NF;
      const r = wanted.get(to);
      if (!r) continue;
      const etIdx = edges[e + eType]!;
      if (!strong.has(etIdx)) continue;
      const et = edgeTypes[etIdx];
      const en = et === "element" || et === "hidden" ? `[${edges[e + eName]}]` : strings[edges[e + eName]!] ?? "?";
      const ownerName = nameOf(i) || `(${typeOf(i)})`;
      const score = (et === "context" ? 3 : et === "property" ? 2 : et === "internal" ? 1 : 0) + (ownerName.startsWith("(") ? 0 : 1);
      const prev = best.get(to);
      if (!prev || score > prev.score) best.set(to, { score, label: `${ownerName.slice(0, 40)}.${en}` });
    }
  }
  for (const r of top) if (r.idx !== undefined) r.retainer = best.get(r.idx)?.label;
  for (const r of top) delete r.idx;
  return {
    node_count: n,
    edge_count: edges.length / EF,
    total_size: total,
    byType: [...byType].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.self_size - a.self_size),
    byName: [...byName]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.self_size - a.self_size)
      .slice(0, 25),
    topRetained: top,
  };
}

// ---------------------------------------------------------------------------
// Inspector client (minimal, no deps: Node 22 has global WebSocket)
// ---------------------------------------------------------------------------

interface InspectorTarget {
  id: string;
  webSocketDebuggerUrl: string;
  title?: string;
  url?: string;
}

export async function listInspectorTargets(port = 9229, host = "127.0.0.1"): Promise<InspectorTarget[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  try {
    const r = await fetch(`http://${host}:${port}/json/list`, { signal: ctrl.signal });
    if (!r.ok) return [];
    return (await r.json()) as InspectorTarget[];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly events = new Map<string, Array<(p: unknown) => void>>();
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown };
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.events.get(msg.method) ?? []) h(msg.params);
      }
    });
  }
  static connect(url: string, timeoutMs = 5000): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => {
        ws.close();
        reject(new Error("inspector connect timeout"));
      }, timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(t);
        resolve(new Cdp(ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(t);
        reject(new Error("inspector websocket error"));
      });
    });
  }
  on(method: string, h: (p: unknown) => void): void {
    this.events.set(method, [...(this.events.get(method) ?? []), h]);
  }
  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
    });
  }
  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

/** Inspector ports Node uses by default (9229) and for extra workers/children. */
export const INSPECTOR_PORTS = [9229, 9230, 9231] as const;

/** Accept a webSocketDebuggerUrl only if it points back at the loopback port we probed. Pure. */
export function validInspectorUrl(url: unknown, port: number): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== "ws:") return undefined;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return undefined;
    if (Number(u.port) !== port) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Pids listening on a local TCP port (lsof -F p output). Undefined when lsof is unavailable. */
export async function listeningPids(port: number): Promise<Set<number> | undefined> {
  const r = await runCapped("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], { timeoutMs: 5_000 }).catch(() => undefined);
  if (!r || (r.exitCode !== 0 && r.exitCode !== 1)) return undefined;
  const pids = new Set<number>();
  for (const line of r.stdout.split("\n")) if (/^p\d+$/.test(line)) pids.add(Number(line.slice(1)));
  return pids;
}

export interface FindInspectorOptions {
  /** Send SIGUSR1 when no inspector is open yet (requires the caller's consent). */
  allowSignal: boolean;
  ports?: readonly number[];
  /** Override for tests. */
  ownersOf?: (port: number) => Promise<Set<number> | undefined>;
  /** Override for tests. */
  listTargets?: (port: number) => Promise<InspectorTarget[]>;
}

/**
 * Find an inspector endpoint that belongs to the target: the listening port must be owned by the target pid or one
 * of its descendants, and the advertised WebSocket must point back to that loopback port. Optionally send SIGUSR1
 * and retry. Returns the ws url, port, and whether we signalled the target.
 */
export async function findInspector(target: Pick<Target, "pid" | "pids">, b: ResultBuilder, opts: FindInspectorOptions): Promise<{ url: string; port: number; signalled: boolean } | undefined> {
  const pid = target.pid!;
  const owned = new Set<number>([pid, ...(target.pids ?? [])]);
  const ports = opts.ports ?? INSPECTOR_PORTS;
  const ownersOf = opts.ownersOf ?? listeningPids;
  const listTargets = opts.listTargets ?? ((p: number) => listInspectorTargets(p));
  let noted = false;
  const probe = async () => {
    for (const port of ports) {
      const list = await listTargets(port);
      if (!list.length) continue;
      const owners = await ownersOf(port);
      if (!owners) {
        if (!noted) b.limitation("lsof is not available, so the inspector port's owner cannot be verified; refusing to connect to it");
        noted = true;
        continue;
      }
      if (![...owners].some((p) => owned.has(p))) {
        b.limitation(`inspector on 127.0.0.1:${port} belongs to pid ${[...owners].join(",") || "?"}, not the target; ignored`);
        continue;
      }
      for (const t of list) {
        const url = validInspectorUrl(t.webSocketDebuggerUrl, port);
        if (url) return { url, port };
      }
    }
    return undefined;
  };
  const found = await probe();
  if (found) return { ...found, signalled: false };
  if (!opts.allowSignal) return undefined;
  // Node's documented way to enable the inspector on a running process.
  try {
    process.kill(pid, "SIGUSR1");
  } catch (err) {
    b.limitation(`could not send SIGUSR1 to pid ${pid}: ${(err as Error).message}`);
    return undefined;
  }
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const again = await probe();
    if (again) return { ...again, signalled: true };
  }
  return undefined;
}

/** Record that SIGUSR1 left the inspector open: a warn finding, so it is not buried in limitations. */
function noteInspectorOpened(b: ResultBuilder, pid: number, port: number): void {
  const ev = b.evidenceOf("note", `sent SIGUSR1 to pid ${pid}; Node's inspector is now listening on 127.0.0.1:${port}`, { pid, port, signal: "SIGUSR1" });
  b.finding("warn", `Node's inspector stays open on 127.0.0.1:${port} until pid ${pid} exits`, [ev], "observed", "Any local process that can reach that port can run code as the target's user. Restart the target when you are done if that matters on this host.");
}

const NO_CONSENT = "no Node inspector is open on the target; pass consent: true to let Debug Anything send SIGUSR1, which opens one on 127.0.0.1:9229 until the process exits (or start the target with --inspect)";

async function takeHeapSnapshot(url: string, outPath: string): Promise<{ bytes: number; chunks: number }> {
  const cdp = await Cdp.connect(url);
  const file = createWriteStream(outPath, { mode: 0o600 });
  let bytes = 0;
  let chunks = 0;
  let over = false;
  let abort: (e: Error) => void = () => {};
  const capped = new Promise<never>((_, reject) => (abort = reject));
  cdp.on("HeapProfiler.addHeapSnapshotChunk", (p) => {
    if (over) return;
    const chunk = (p as { chunk: string }).chunk;
    bytes += chunk.length;
    chunks++;
    if (bytes > LIMITS.MAX_RAW_BYTES) {
      over = true;
      abort(new Error(`heap snapshot exceeded the ${Math.round(LIMITS.MAX_RAW_BYTES / 1024 / 1024)} MB cap; aborted`));
      return;
    }
    file.write(chunk);
  });
  try {
    await cdp.send("HeapProfiler.enable");
    await Promise.race([cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, treatGlobalObjectsAsRoots: true, captureNumericValue: false }, 55_000), capped]);
  } finally {
    cdp.close();
    await new Promise<void>((r) => file.end(() => r()));
  }
  return { bytes, chunks };
}

async function snapshotMemory(ctx: AdapterContext, args: { heap?: boolean; window_s?: number; consent?: boolean }): Promise<ToolResult> {
  const base = await snapshotMemoryGeneric(ctx, args);
  if (args.heap === false) return base;
  const { session, target } = ctx;
  const b = new ResultBuilder("snapshot_memory", session, target);
  const pid = target.pid!;
  const insp = await findInspector(target, b, { allowSignal: args.consent === true });
  if (!insp) {
    b.limitation(args.consent === true ? "no Node inspector owned by the target on 127.0.0.1:9229-9231 and SIGUSR1 did not open one; start the target with --inspect for heap snapshots" : NO_CONSENT);
    return mergeResults(base, b.build(), []);
  }
  if (insp.signalled) noteInspectorOpened(b, pid, insp.port);
  const outPath = b.artifactPath("heap.heapsnapshot");
  let took: { bytes: number; chunks: number };
  try {
    took = await takeHeapSnapshot(insp.url, outPath);
    b.limitation(`heap snapshot: ${took.chunks} chunks, ${Math.round(took.bytes / 1024 / 1024)} MB JSON`);
  } catch (err) {
    b.limitation(`heap snapshot failed: ${(err as Error).message}`);
    await rm(outPath, { force: true }).catch(() => undefined);
    return mergeResults(base, b.build(), []);
  }
  await b.addArtifact(outPath, "heapsnapshot", { description: `V8 heap snapshot via inspector :${insp.port} (open in Chrome DevTools → Memory → Load)` });
  let summary: HeapSummary;
  try {
    summary = summarizeHeapSnapshot(await readFile(outPath, "utf8"));
  } catch (err) {
    b.limitation(`could not parse heap snapshot: ${(err as Error).message}`);
    return mergeResults(base, b.build(), []);
  }
  const sumEv = b.evidenceOf("heap_summary", `heap ${humanBytes(summary.total_size)} in ${summary.node_count} objects; by type: ${summary.byType.slice(0, 4).map((t) => `${t.type} ${humanBytes(t.self_size)}`).join(", ")}`, { name: "heap_total", bytes: summary.total_size, objects: summary.node_count, by_type: summary.byType.slice(0, 8) }, { artifact: outPath });
  const nameEv = b.evidenceOf("heap_summary", `by constructor (self size): ${summary.byName.slice(0, 5).map((x) => `${x.name} ${humanBytes(x.self_size)}×${x.count}`).join(", ")}`, summary.byName.map((x) => ({ name: x.name, type: x.type, count: x.count, bytes: x.self_size })), { artifact: outPath });
  const retEv = b.evidenceOf("heap_retainer", `top retainers: ${summary.topRetained.slice(0, 4).map((r) => `${r.name} (${r.type}) retains ${humanBytes(r.retained_bytes)}${r.retainer ? ` via ${r.retainer}` : ""}`).join("; ")}`, summary.topRetained.map((r) => ({ name: r.name, type: r.type, retained_bytes: r.retained_bytes, self_size: r.self_size, retainer: r.retainer })), { artifact: outPath });
  const top = summary.topRetained[0];
  if (top && top.retained_bytes > summary.total_size * 0.2 && top.type !== "synthetic") {
    b.finding("warn", `${top.name} (${top.type}) retains ${humanBytes(top.retained_bytes)} = ${Math.round((100 * top.retained_bytes) / summary.total_size)}% of the heap${top.retainer ? `, held by ${top.retainer}` : ""}`, [retEv, sumEv], "observed", "Take another snapshot_memory after load and diff_runs: if this retainer grows, it is the leak.");
  }
  const bigArrays = summary.byName.find((x) => x.type === "array" || x.name === "Array");
  if (bigArrays && bigArrays.self_size > summary.total_size * 0.25) b.finding("info", `arrays hold ${humanBytes(bigArrays.self_size)} (${Math.round((100 * bigArrays.self_size) / summary.total_size)}% of heap)`, [nameEv]);
  b.limitation(`retained sizes are a reachability approximation (shared subgraphs are over-counted); open the .heapsnapshot in Chrome DevTools for exact dominator-tree numbers`);
  b.next("snapshot_memory (again, after load)", "diff_runs");
  return mergeResults(base, b.build(), []);
}

/** dump_stacks for Node through the inspector: pause, read call frames of the main thread, resume. */
async function dumpStacks(ctx: AdapterContext, args: { consent?: boolean }): Promise<ToolResult> {
  const { session, target } = ctx;
  const b = new ResultBuilder("dump_stacks", session, target);
  const pid = target.pid!;
  const insp = await findInspector(target, b, { allowSignal: args.consent === true });
  if (!insp) {
    b.limitation(args.consent === true ? "no Node inspector owned by the target; falling back needs gdb/lldb (native frames only)" : NO_CONSENT);
    return b.fail("node inspector not available; cannot attach").build();
  }
  if (insp.signalled) noteInspectorOpened(b, pid, insp.port);
  const cdp = await Cdp.connect(insp.url);
  try {
    const paused = new Promise<unknown>((resolve) => cdp.on("Debugger.paused", resolve));
    await cdp.send("Debugger.enable");
    const t0 = Date.now();
    await cdp.send("Debugger.pause");
    const p = (await Promise.race([paused, new Promise((r) => setTimeout(() => r(undefined), 3000))])) as { callFrames?: Array<{ functionName: string; url: string; location: { lineNumber: number; columnNumber: number } }>; reason?: string } | undefined;
    const pauseLatency = Date.now() - t0;
    if (p) await cdp.send("Debugger.resume").catch(() => undefined);
    else await cdp.send("Debugger.disable").catch(() => undefined);
    const frames = (p?.callFrames ?? []).map((f) => ({ func: f.functionName || "(anonymous)", file: f.url.replace(/^file:\/\//, "") || "(internal)", line: f.location.lineNumber + 1 }));
    const userFrames = frames.filter((f) => !/^node:|^\(internal\)$/.test(f.file));
    const raw = frames.map((f) => `${f.func} (${f.file}:${f.line})`).join("\n") || "(event loop idle: no JS frames on the stack)";
    const art = await b.writeArtifact("node-stack.txt", raw, "raw_text", "Node main-thread JS stack via inspector Debugger.pause");
    const ev = b.evidenceOf(
      "stack",
      frames.length ? `main thread (pause latency ${pauseLatency} ms): ${frames.slice(0, 4).map((f) => `${f.func}@${f.file.split("/").pop()}:${f.line}`).join(" ← ")}` : `main thread idle in the event loop (no JS frames after ${pauseLatency} ms)`,
      { thread: "main", pause_latency_ms: pauseLatency, frames, user_frames: userFrames.length },
      { artifact: art },
    );
    // Debugger.pause only fires when JS runs. If the loop was idle it fires on the next tick, which is an internal
    // frame reached after a delay — that is NOT evidence of a blocked loop.
    if (userFrames.length && pauseLatency < 100) {
      const f = userFrames[0]!;
      b.finding("warn", `Node main thread is executing ${f.func} (${f.file.split("/").pop()}:${f.line}) — a synchronous task is running on the event loop`, [ev], "observed", `Hot JS stack: ${userFrames.slice(0, 5).map((x) => `${x.func}@${x.file.split("/").pop()}:${x.line}`).join(" ← ")}. Handoff: attach a step debugger (e.g. mcp-debugger) at ${f.file}:${f.func}. Run profile_cpu to see if it is CPU-bound.`);
    } else if (userFrames.length) {
      b.finding("info", `caught the event loop in user code ${userFrames[0]!.func} (${userFrames[0]!.file.split("/").pop()}:${userFrames[0]!.line}) after ${pauseLatency} ms — a tick was running, not necessarily blocked`, [ev], "observed");
    } else {
      b.finding("info", `Node main thread was idle in the event loop (first JS tick after ${pauseLatency} ms was ${frames[0] ? `${frames[0].func} in ${frames[0].file}` : "none"}) — not stuck in JS; if callers hang, the work is pending on I/O or timers (inspect_sockets, trace_syscalls)`, [ev], "inferred");
    }
    b.limitation("JS main thread only; worker threads and libuv threadpool are not shown (use gdb/lldb for native threads)");
    b.next("profile_cpu", "trace_syscalls", "inspect_sockets");
    return b.build();
  } finally {
    cdp.close();
  }
}

export const heapNodeAdapter: Adapter = {
  name: "node-inspector",
  tools: ["snapshot_memory", "dump_stacks"],
  platforms: ["linux", "darwin"],
  requires: [],
  runtimes: ["node"],
  priority: 20,
  check(base) {
    base.notes.push("uses Node's inspector protocol; with consent: true it sends SIGUSR1 to enable it if the target was not started with --inspect");
    return base;
  },
  async run(tool, args, ctx) {
    if (tool === "snapshot_memory") return snapshotMemory(ctx, args as { heap?: boolean; window_s?: number; consent?: boolean });
    if (tool === "dump_stacks") return dumpStacks(ctx, args as { consent?: boolean });
    throw new Error(`node-inspector adapter cannot run ${tool}`);
  },
};

export { targetPids, runCapped };
