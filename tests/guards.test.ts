import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { assertSafeBpfFragment, redact } from "../src/safety.js";
import { ResultBuilder } from "../src/evidence.js";
import { toolAnnotations } from "../src/server.js";
import { checkReportOut, runTool } from "../src/tools.js";
import { ToolArgs } from "../src/contracts.js";
import { findInspector, listeningPids, validInspectorUrl } from "../src/adapters/heap_node.js";

describe("redaction", () => {
  it("scrubs credentials in any URL scheme", () => {
    expect(redact("postgres://app:hunter2@db:5432/x")).toBe("postgres://app:[REDACTED]@db:5432/x");
    expect(redact("redis://:s3cret@cache:6379")).toBe("redis://:[REDACTED]@cache:6379");
    expect(redact("amqp://guest:pw@mq")).toBe("amqp://guest:[REDACTED]@mq");
    expect(redact("https://u:p4ss@example.com")).toBe("https://u:[REDACTED]@example.com");
  });
  it("scrubs space-separated secret flags", () => {
    expect(redact("node app.js --password hunter2 --port 3000")).toBe("node app.js --password [REDACTED] --port 3000");
    expect(redact("cli --token abc123 -v")).toBe("cli --token [REDACTED] -v");
    expect(redact("x --api-key 'k-123'")).toBe("x --api-key '[REDACTED]'");
  });
  it("scrubs cookies and basic auth", () => {
    expect(redact("Cookie: sid=abc; theme=dark")).toBe("Cookie: [REDACTED]");
    expect(redact("set-cookie: sid=abc; HttpOnly")).toBe("set-cookie: [REDACTED]");
    expect(redact("Authorization: Basic dXNlcjpwYXNz")).toBe("Authorization: Basic [REDACTED]");
    expect(redact("hdr Basic dXNlcjpwYXNzd29yZA==")).toBe("hdr Basic [REDACTED]");
  });
  it("leaves ordinary text alone", () => {
    expect(redact("Basic configuration loaded")).toBe("Basic configuration loaded");
    expect(redact("the token expired")).toBe("the token expired");
    expect(redact("listening on http://localhost:3000")).toBe("listening on http://localhost:3000");
  });
  it("covers target, findings, limitations and error in every result", () => {
    const target = { kind: "pid" as const, id: "1", pid: 1, cmdline: "node app.js --password hunter2", host: "local" };
    const b = new ResultBuilder("attach", null, target);
    const ev = b.evidenceOf("note", "x", {});
    b.finding("info", "started with postgres://a:b@db", [ev]);
    b.limitation("saw --token abc123");
    b.fail("failed: Cookie: sid=1");
    const r = b.build();
    const text = JSON.stringify(r);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain(":b@");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("sid=1");
  });
});

describe("BPF fragment scope", () => {
  it("refuses fragments that close the base scope", () => {
    expect(() => assertSafeBpfFragment("tcp) or (tcp")).toThrow(/unbalanced/);
    expect(() => assertSafeBpfFragment("(tcp")).toThrow(/unbalanced/);
    expect(() => assertSafeBpfFragment("tcp)")).toThrow(/unbalanced/);
  });
  it("accepts balanced fragments", () => {
    expect(assertSafeBpfFragment("(tcp and not port 22)")).toBe("(tcp and not port 22)");
    expect(assertSafeBpfFragment("host 10.0.0.1")).toBe("host 10.0.0.1");
  });
});

describe("MCP annotations", () => {
  it("does not mark spawning, writing or signalling tools read-only", () => {
    expect(toolAnnotations("attach")).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(toolAnnotations("report").readOnlyHint).toBe(false);
    expect(toolAnnotations("snapshot_memory").readOnlyHint).toBe(false);
    expect(toolAnnotations("dump_stacks").readOnlyHint).toBe(false);
    expect(toolAnnotations("inspect_sockets").readOnlyHint).toBe(true);
  });
  it("defaults locals off and consent unset", () => {
    const a = ToolArgs.snapshot_memory.parse({ session_id: "s" });
    expect(a.locals).toBe(false);
    expect(a.consent).toBeUndefined();
    expect(ToolArgs.dump_stacks.parse({ session_id: "s", consent: true }).consent).toBe(true);
  });
});

describe("attach", () => {
  it("does not spawn a command unless kind is command", async () => {
    const r = await runTool("attach", { target: "/bin/sleep 5" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/kind: "command"/);
  });
});

describe("session files", () => {
  const prev = process.env.DEA_HOME;
  const home = mkdtempSync(join(tmpdir(), "dea-perm-"));
  beforeAll(() => {
    process.env.DEA_HOME = join(home, "dh");
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.DEA_HOME;
    else process.env.DEA_HOME = prev;
  });
  it.skipIf(process.platform === "win32")("are private to the user", async () => {
    const { createSession } = await import("../src/session.js");
    const s = await createSession({ kind: "pid", id: "1", host: "local" });
    expect(statSync(join(home, "dh")).mode & 0o777).toBe(0o700);
    expect(statSync(s.dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(s.dir, "artifacts")).mode & 0o777).toBe(0o700);
    expect(statSync(join(s.dir, "session.json")).mode & 0o777).toBe(0o600);
    const b = new ResultBuilder("x", s, s.target);
    const p = await b.writeArtifact("a.txt", "secret", "raw_text");
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });
});

describe("report out path", () => {
  const cwd = mkdtempSync(join(tmpdir(), "dea-out-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "dea-sess-"));
  it("allows .md files inside cwd or the session dir", async () => {
    expect(await checkReportOut("r.md", sessionDir, cwd)).toBe(join(cwd, "r.md"));
    expect(await checkReportOut(join(sessionDir, "copy.md"), sessionDir, cwd)).toBe(join(sessionDir, "copy.md"));
  });
  it("refuses other extensions, outside paths, symlinks and foreign files", async () => {
    await expect(checkReportOut("x.sh", sessionDir, cwd)).rejects.toThrow(/\.md/);
    await expect(checkReportOut("../escape.md", sessionDir, cwd)).rejects.toThrow(/inside/);
    await expect(checkReportOut(join(tmpdir(), "elsewhere.md"), sessionDir, cwd)).rejects.toThrow(/inside/);
    writeFileSync(join(cwd, "notes.md"), "my notes\n");
    await expect(checkReportOut("notes.md", sessionDir, cwd)).rejects.toThrow(/not a Debug Anything report/);
    writeFileSync(join(cwd, "old.md"), "# Debug Anything session 1\n");
    expect(await checkReportOut("old.md", sessionDir, cwd)).toBe(join(cwd, "old.md"));
    symlinkSync(join(cwd, "notes.md"), join(cwd, "link.md"));
    await expect(checkReportOut("link.md", sessionDir, cwd)).rejects.toThrow(/symlink/);
    mkdirSync(join(cwd, "sub"));
    symlinkSync(tmpdir(), join(cwd, "sub", "out"));
    await expect(checkReportOut("sub/out/x.md", sessionDir, cwd)).rejects.toThrow(/inside/);
  });
});

describe("Node inspector selection", () => {
  it("accepts only loopback ws urls on the probed port", () => {
    expect(validInspectorUrl("ws://127.0.0.1:9229/abc", 9229)).toBe("ws://127.0.0.1:9229/abc");
    expect(validInspectorUrl("ws://localhost:9229/abc", 9229)).toBeDefined();
    expect(validInspectorUrl("ws://evil.example:9229/abc", 9229)).toBeUndefined();
    expect(validInspectorUrl("ws://127.0.0.1:9230/abc", 9229)).toBeUndefined();
    expect(validInspectorUrl("wss://127.0.0.1:9229/abc", 9229)).toBeUndefined();
    expect(validInspectorUrl(42, 9229)).toBeUndefined();
  });

  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{ id: "x", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/x` }]));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("refuses an inspector owned by a different pid", async () => {
    const b = new ResultBuilder("dump_stacks", null, { kind: "pid", id: "1", host: "local" });
    const other = process.pid + 1_000_000;
    const found = await findInspector({ pid: other, pids: [other] }, b, { allowSignal: false, ports: [port], ownersOf: async () => new Set([process.pid]) });
    expect(found).toBeUndefined();
    expect(b.limitations.join(" ")).toMatch(/not the target/);
  });

  it("refuses when the owner cannot be verified", async () => {
    const b = new ResultBuilder("dump_stacks", null, { kind: "pid", id: "1", host: "local" });
    const found = await findInspector({ pid: process.pid }, b, { allowSignal: false, ports: [port], ownersOf: async () => undefined });
    expect(found).toBeUndefined();
  });

  it("uses an inspector owned by the target (real lsof when available)", async () => {
    const owners = await listeningPids(port);
    const b = new ResultBuilder("dump_stacks", null, { kind: "pid", id: "1", host: "local" });
    if (owners === undefined) return; // no lsof on this runner
    expect(owners.has(process.pid)).toBe(true);
    const found = await findInspector({ pid: process.pid }, b, { allowSignal: false, ports: [port] });
    expect(found).toEqual({ url: `ws://127.0.0.1:${port}/x`, port, signalled: false });
    const refused = await findInspector({ pid: process.pid + 1_000_000 }, b, { allowSignal: false, ports: [port] });
    expect(refused).toBeUndefined();
  });
});
