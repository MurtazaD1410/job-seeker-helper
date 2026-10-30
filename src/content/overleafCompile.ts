import type { BridgeFailure, BridgeResult } from "@/lib/overleaf";

/**
 * Compiles in Overleaf and returns the PDF. Runs in the Overleaf page's MAIN world, so it must stay
 * self-contained (see overleafBridge.ts).
 *
 * How it works, based on Overleaf's current markup:
 *  - the Recompile button is `.compile-button`; while a compile runs it has data-ol-loading="true"
 *  - the PDF toolbar's "Download PDF" link points at /download/project/<id>/build/<buildId>/output/output.pdf
 *    and its build id changes with every compile, so a changed href means a new PDF exists
 *  - "View logs" shows a red badge with the number of errors
 * With Auto compile on, Overleaf may already be compiling when we click; we wait until it has been idle
 * for a moment, so we always return the latest build, not one started before our edit was synced.
 */
export async function overleafCompile(download: boolean, timeoutMs = 120000, idleMs = 2000): Promise<BridgeResult> {
  const fail = (error: string): BridgeFailure => ({ ok: false, code: "compile", error });
  try {
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const findButton = (): HTMLButtonElement | null => {
      const direct = document.querySelector("button.compile-button");
      if (direct) return direct as HTMLButtonElement;
      // Fallback by label, in case the class names change.
      const byText = Array.from(document.querySelectorAll("button")).find((b) => /^(re)?compile$|^(neu )?kompilieren$/i.test((b.textContent ?? "").trim()));
      return (byText as HTMLButtonElement | undefined) ?? null;
    };
    const isLoading = (): boolean => {
      const b = findButton();
      if (!b) return false;
      return b.getAttribute("data-ol-loading") === "true" || b.getAttribute("aria-busy") === "true" || /^(compiling|kompilier)/i.test((b.textContent ?? "").trim());
    };
    const pdfHref = (): string =>
      (document.querySelector('a[aria-label="Download PDF"][href*="output.pdf"], a[href*="/output/output.pdf"]') as HTMLAnchorElement | null)?.getAttribute("href") ?? "";
    const logBadge = (): string => (document.querySelector('button[aria-label="View logs"] .badge-content')?.textContent ?? "").trim();

    const button = findButton();
    if (!button) return fail("Couldn't find Overleaf's Recompile button. Open the PDF preview panel (Layout menu) and try again.");

    const baseline = pdfHref();
    const t0 = performance.now();
    const click = async () => {
      // A disabled button means a compile is already starting; give it a moment.
      for (let i = 0; i < 40 && findButton()?.disabled; i++) await sleep(250);
      findButton()?.click();
    };

    if (!isLoading()) await click();
    if (!download) return { ok: true, op: "compile", pdfBase64: "", bytes: 0, via: "none", logBadge: "" };

    const deadline = Date.now() + timeoutMs;
    let sawLoading = false;
    let idleSince = 0;
    let clickedAgain = false;
    let href = "";

    while (Date.now() < deadline) {
      await sleep(250);
      if (isLoading()) {
        sawLoading = true;
        idleSince = 0;
        continue;
      }
      idleSince = idleSince || Date.now();
      const idleFor = Date.now() - idleSince;

      // Not compiling for a moment (2s): whatever build is showing now is the latest one.
      if (idleFor >= idleMs) {
        href = pdfHref();
        if (href && href !== baseline) break;
        if (sawLoading) {
          return fail(`Overleaf finished compiling but produced no new PDF${logBadge() ? ` (${logBadge()} error(s) in the log)` : ""}. Open "View logs" in Overleaf to see why.`);
        }
        // Nothing started: the click may have been swallowed. Try once more after a few seconds.
        if (idleFor >= idleMs * 3 && !clickedAgain) {
          clickedAgain = true;
          await click();
          idleSince = 0;
        }
      }
    }
    if (!href || href === baseline) {
      return fail("Overleaf didn't produce a new PDF in time. Keep the PDF preview open and the Overleaf tab visible, then try again.");
    }

    // Download the bytes. First choice: the "Download PDF" link (same origin, with the user's session).
    const fetchPdf = async (url: string, credentials: RequestCredentials): Promise<Uint8Array> => {
      const res = await fetch(url, { credentials });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 100 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "%PDF") throw new Error("not a PDF");
      return bytes;
    };
    const toBase64 = (bytes: Uint8Array): string => {
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    };

    const errors: string[] = [];
    try {
      const bytes = await fetchPdf(new URL(href, location.href).href, "include");
      return { ok: true, op: "compile", pdfBase64: toBase64(bytes), bytes: bytes.length, via: "fetch", logBadge: logBadge() };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    // Second choice: the URL the PDF viewer itself requested for this build.
    try {
      const entries = (performance.getEntriesByType?.("resource") ?? []).filter((r) => r.startTime >= t0 && r.name.includes("/output/output.pdf"));
      const last = entries[entries.length - 1];
      if (last) {
        const bytes = await fetchPdf(last.name, "omit");
        return { ok: true, op: "compile", pdfBase64: toBase64(bytes), bytes: bytes.length, via: "timing", logBadge: logBadge() };
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    // Last resort: let the browser download it through Overleaf's own link (the file is named output.pdf).
    const link = document.querySelector('a[aria-label="Download PDF"]') as HTMLAnchorElement | null;
    if (link) {
      link.click();
      return { ok: true, op: "compile", pdfBase64: "", bytes: 0, via: "browser", logBadge: logBadge() };
    }
    return fail(`Couldn't download the compiled PDF (${errors.join("; ") || "no download link"}).`);
  } catch (e) {
    return fail(`Unexpected error while compiling: ${e instanceof Error ? e.message : String(e)}`);
  }
}
