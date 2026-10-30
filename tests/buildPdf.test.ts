import { describe, expect, it, vi } from "vitest";
import { buildPdf, type BuildDeps } from "@/lib/buildPdf";
import type { BridgeCommand, BridgeResult } from "@/lib/overleaf";
import type { PendingRestore } from "@/lib/pendingRestore";

const PDF_B64 = btoa("%PDF-1.4 " + "x".repeat(200));
const META = { project: "p1", file: "main.tex", title: "CV" };
const MASTER = "MASTER TEXT";
const TAILORED = "TAILORED TEXT";

/** A fake Overleaf: holds one document and answers the commands the builder sends. */
function fake(opts: { failReplaceNo?: number; compile?: BridgeResult; failReadAfterRestore?: boolean; initial?: string } = {}) {
  let doc = opts.initial ?? MASTER;
  let replaces = 0;
  const log: string[] = [];
  const pending: (PendingRestore | null)[] = [];
  const deps: BuildDeps = {
    sleep: async () => {},
    savePending: async (p) => void pending.push(p),
    call: async (cmd: BridgeCommand): Promise<BridgeResult> => {
      log.push(cmd.op === "compile" ? `compile:${cmd.download ? "download" : "kick"}` : cmd.op);
      if (cmd.op === "replace") {
        replaces++;
        if (opts.failReplaceNo === replaces) return { ok: false, code: "error", error: "replace failed" };
        doc = cmd.text;
        return { ok: true, op: "replace", length: doc.length };
      }
      if (cmd.op === "read") {
        return { ok: true, op: "read", text: opts.failReadAfterRestore ? "something else" : doc };
      }
      if (cmd.op === "compile") {
        if (!cmd.download) return { ok: true, op: "compile", pdfBase64: "", bytes: 0, via: "none", logBadge: "" };
        return opts.compile ?? { ok: true, op: "compile", pdfBase64: PDF_B64, bytes: 209, via: "fetch", logBadge: "" };
      }
      return { ok: false, code: "error", error: "unexpected " + cmd.op };
    }
  };
  return { deps, log, pending, get doc() { return doc; } };
}

const input = { tailored: TAILORED, restoreTo: MASTER, meta: META };

describe("buildPdf", () => {
  it("backs up, writes, compiles, restores, verifies and refreshes the preview", async () => {
    const f = fake();
    const r = await buildPdf(f.deps, input);
    expect(f.log).toEqual(["replace", "compile:download", "replace", "read", "compile:kick"]);
    expect(r.pdf?.length).toBeGreaterThan(100);
    expect(r).toMatchObject({ error: null, restored: true, restoreError: null, browserDownload: false });
    expect(f.doc).toBe(MASTER);
    // a backup record was written first and cleared at the end
    expect(f.pending[0]).toMatchObject({ text: MASTER, project: "p1", file: "main.tex" });
    expect(f.pending[f.pending.length - 1]).toBeNull();
  });

  it("restores the file even when the compile fails", async () => {
    const f = fake({ compile: { ok: false, code: "compile", error: "no new PDF" } });
    const r = await buildPdf(f.deps, input);
    expect(r).toMatchObject({ pdf: null, error: "no new PDF", restored: true });
    expect(f.doc).toBe(MASTER);
    expect(f.pending[f.pending.length - 1]).toBeNull();
  });

  it("can restore something other than the master", async () => {
    const f = fake({ initial: "WHAT WAS THERE" });
    const r = await buildPdf(f.deps, { ...input, restoreTo: "WHAT WAS THERE" });
    expect(r.restored).toBe(true);
    expect(f.doc).toBe("WHAT WAS THERE");
  });

  it("never compiles, and leaves nothing pending, if the first write is rejected", async () => {
    const f = fake({ failReplaceNo: 1 });
    const r = await buildPdf(f.deps, input);
    expect(f.log).toEqual(["replace"]);
    expect(r).toMatchObject({ error: "replace failed", restored: true });
    expect(f.doc).toBe(MASTER);
    expect(f.pending[f.pending.length - 1]).toBeNull();
  });

  it("keeps the backup and reports it when the restore fails", async () => {
    const f = fake({ failReplaceNo: 2 });
    const r = await buildPdf(f.deps, input);
    expect(r.pdf).not.toBeNull();
    expect(r).toMatchObject({ restored: false, restoreError: "replace failed" });
    expect(f.pending[f.pending.length - 1]).toMatchObject({ text: MASTER }); // still there for "Restore now"
    expect(f.log).not.toContain("compile:kick");
  });

  it("keeps the backup if the restored file doesn't read back the same", async () => {
    const f = fake({ failReadAfterRestore: true });
    const r = await buildPdf(f.deps, input);
    expect(r.restored).toBe(false);
    expect(r.restoreError).toMatch(/doesn't match/);
    expect(f.pending[f.pending.length - 1]).not.toBeNull();
  });

  it("treats CRLF vs LF as the same when verifying the restore", async () => {
    const f = fake();
    const r = await buildPdf(f.deps, { ...input, restoreTo: "A\r\nB" });
    expect(r.restored).toBe(true);
  });

  it("reports a browser-side download and the Overleaf error badge", async () => {
    const f = fake({ compile: { ok: true, op: "compile", pdfBase64: "", bytes: 0, via: "browser", logBadge: "2" } });
    const r = await buildPdf(f.deps, input);
    expect(r).toMatchObject({ pdf: null, browserDownload: true, logErrors: "2", error: null, restored: true });
  });

  it("waits for Overleaf to sync before compiling", async () => {
    const sleep = vi.fn(async () => {});
    const f = fake();
    await buildPdf({ ...f.deps, sleep, syncDelayMs: 1234 }, input);
    expect(sleep).toHaveBeenCalledWith(1234);
    expect(f.log.indexOf("replace")).toBeLessThan(f.log.indexOf("compile:download"));
  });
});
