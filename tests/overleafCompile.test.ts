// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overleafCompile } from "@/content/overleafCompile";
import { base64ToBytes, type BridgeResult } from "@/lib/overleaf";

// Chrome serialises the function and runs it in the page, detached from this module.
const compile = (download: boolean, timeoutMs = 5000, idleMs = 250): Promise<BridgeResult> =>
  new Function(`return (${String(overleafCompile)})`)()(download, timeoutMs, idleMs);

const PDF = new TextEncoder().encode("%PDF-1.5\n" + "x".repeat(300));
const href = (build: string) => `/download/project/abc/build/${build}/output/output.pdf?compileGroup=standard&popupDownload=true`;

/** Mimics Overleaf's PDF toolbar: clicking Recompile sets data-ol-loading for a while, then publishes a new build id. */
function toolbar(opts: { newBuild?: boolean; buttonClass?: string } = {}) {
  document.body.innerHTML = `
    <div class="toolbar-pdf-left">
      <div class="compile-button-group">
        <button type="button" data-ol-loading="false" class="${opts.buttonClass ?? "compile-button btn btn-primary"}"><span class="button-content">Recompile</span></button>
      </div>
      <button aria-label="View logs"><span class="badge bg-danger"><span class="badge-content">1</span></span></button>
      <a aria-label="Download PDF" href="${href("old-build")}" download>dl</a>
    </div>`;
  const button = document.querySelector("button.compile-button, button.btn") as HTMLButtonElement;
  const link = document.querySelector('a[aria-label="Download PDF"]') as HTMLAnchorElement;
  let clicks = 0;
  button.addEventListener("click", () => {
    clicks++;
    button.setAttribute("data-ol-loading", "true");
    setTimeout(() => {
      button.setAttribute("data-ol-loading", "false");
      if (opts.newBuild !== false) link.setAttribute("href", href(`new-build-${clicks}`));
    }, 300);
  });
  return { get clicks() { return clicks; }, link };
}

const respond = (body: Uint8Array | string, ok = true) =>
  vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, arrayBuffer: async () => (typeof body === "string" ? new TextEncoder().encode(body) : body).buffer });

beforeEach(() => {
  vi.stubGlobal("fetch", respond(PDF));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("overleafCompile", () => {
  it("clicks Recompile, waits for the new build and returns the PDF", async () => {
    const t = toolbar();
    const r = await compile(true);
    expect(t.clicks).toBe(1);
    expect(r).toMatchObject({ ok: true, op: "compile", via: "fetch", bytes: PDF.length, logBadge: "1" });
    if (r.ok && r.op === "compile") expect(Array.from(base64ToBytes(r.pdfBase64))).toEqual(Array.from(PDF));
    // it fetched the NEW build, from the same origin, with the user's session
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/build/new-build-1/output/output.pdf");
    expect(init).toMatchObject({ credentials: "include" });
  });

  it("only starts a compile when download is false", async () => {
    const t = toolbar();
    const r = await compile(false);
    expect(t.clicks).toBe(1);
    expect(r).toMatchObject({ ok: true, op: "compile", pdfBase64: "", via: "none" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not click again while Overleaf is already compiling (auto compile)", async () => {
    const t = toolbar();
    document.querySelector("button.compile-button")!.setAttribute("data-ol-loading", "true");
    setTimeout(() => {
      document.querySelector("button.compile-button")!.setAttribute("data-ol-loading", "false");
      t.link.setAttribute("href", href("auto-build"));
    }, 300);
    const r = await compile(true);
    expect(t.clicks).toBe(0);
    expect(r).toMatchObject({ ok: true, via: "fetch" });
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("auto-build");
  });

  it("reports a compile that finished without a new PDF", async () => {
    toolbar({ newBuild: false });
    const r = await compile(true);
    expect(r).toMatchObject({ ok: false, code: "compile", error: expect.stringContaining("no new PDF") });
    expect(r.ok === false && r.error).toContain("1 error(s)");
  });

  it("falls back to the browser's own download when the bytes can't be fetched", async () => {
    vi.stubGlobal("fetch", respond("<html>not a pdf</html>"));
    const t = toolbar();
    const clicked = vi.fn((e: Event) => e.preventDefault());
    t.link.addEventListener("click", clicked);
    const r = await compile(true);
    expect(r).toMatchObject({ ok: true, via: "browser", pdfBase64: "" });
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("fails clearly if there is no Recompile button", async () => {
    document.body.innerHTML = "<div>no preview here</div>";
    expect(await compile(true)).toMatchObject({ ok: false, code: "compile", error: expect.stringContaining("Recompile button") });
  });

  it("finds the button by its label if the class names change", async () => {
    const t = toolbar({ buttonClass: "btn btn-primary" });
    const r = await compile(true);
    expect(t.clicks).toBe(1);
    expect(r).toMatchObject({ ok: true });
  });
});
