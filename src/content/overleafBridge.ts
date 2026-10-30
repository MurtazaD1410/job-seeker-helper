import type { ApplyOutcome, BridgeCommand, BridgeFailure, BridgeResult } from "@/lib/overleaf";

// Both functions below run inside the Overleaf page's MAIN world (chrome.scripting.executeScript with
// world "MAIN"). Chrome serialises them, so each must stay self-contained: no imports or references to
// anything outside its own body (types are erased at build time).

/**
 * Reads and edits the open file through the CodeMirror 6 EditorView. Edits go through view.dispatch(),
 * i.e. ordinary transactions: they join the editor's undo history (Ctrl+Z works) and Overleaf's
 * collaboration layer sees them like typed text.
 */
export function overleafBridge(cmd: BridgeCommand): BridgeResult {
  const fail = (code: BridgeFailure["code"], error: string): BridgeFailure => ({ ok: false, code, error });

  try {
    // File tree helpers (best effort: Overleaf's markup changes from time to time).
    const nameOf = (el: Element): string =>
      (el.getAttribute("aria-label") || el.querySelector(".entity-name, [class*='item-name'], [class*='entity-name']")?.textContent || "").trim();
    const leafItems = (): Element[] =>
      Array.from(document.querySelectorAll('[role="treeitem"]')).filter((el) => !el.querySelector('[role="treeitem"]'));
    const selectedName = (): string => {
      const sel = leafItems().find((el) => el.getAttribute("aria-selected") === "true");
      if (sel) return nameOf(sel);
      return (document.querySelector(".file-tree li.selected .entity-name, .file-tree .selected .entity-name")?.textContent ?? "").trim();
    };

    if (cmd.op === "files") {
      let files = leafItems().map(nameOf);
      if (!files.length) files = Array.from(document.querySelectorAll(".file-tree .entity-name")).map((e) => (e.textContent ?? "").trim());
      return { ok: true, op: "files", files: [...new Set(files.filter((n) => /\.[A-Za-z0-9]+$/.test(n)))], current: selectedName() };
    }
    if (cmd.op === "open" || cmd.op === "compile") return fail("error", "That command runs through its own async function.");

    // The EditorView hangs off the content element as cmView.view.
    type View = {
      state: { doc: { length: number; toString(): string }; readOnly?: boolean };
      contentDOM?: Element;
      dispatch(spec: unknown): void;
    };
    let view: View | null = null;
    for (const el of Array.from(document.querySelectorAll(".cm-content"))) {
      const candidate = (el as unknown as { cmView?: { view?: View } }).cmView?.view;
      if (candidate && candidate.state && typeof candidate.dispatch === "function") {
        view = candidate;
        break;
      }
    }
    if (!view) {
      return fail("no-editor", "Couldn't find the Overleaf editor on that tab. Open a .tex file in the editor (source view) and try again.");
    }
    const v: View = view;

    const readOnly = !!v.state.readOnly || v.contentDOM?.getAttribute("contenteditable") === "false";
    const readOnlyMessage = "The Overleaf editor is read-only (view-only access or a locked file).";
    const lf = (s: string) => s.replace(/\r\n?/g, "\n");

    if (cmd.op === "probe") {
      return {
        ok: true,
        op: "probe",
        docLength: v.state.doc.length,
        readOnly,
        fileHint: selectedName().slice(0, 120),
        projectId: /\/project\/([0-9a-fA-F]+)/.exec(location.pathname)?.[1] ?? "",
        canRecompile: !!document.querySelector("button.compile-button"),
        hasCsrfToken: !!document.querySelector('meta[name="ol-csrfToken"]'),
        hasPdfLink: !!document.querySelector('a[aria-label="Download PDF"], a[href*="/output/output.pdf"]')
      };
    }

    if (cmd.op === "read") return { ok: true, op: "read", text: v.state.doc.toString() };

    if (readOnly) return fail("read-only", readOnlyMessage);

    if (cmd.op === "replace") {
      const text = lf(cmd.text);
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, userEvent: "input" });
      if (v.state.doc.length !== text.length) {
        return fail("error", "Overleaf didn't accept the change. Use Copy and paste it instead.");
      }
      return { ok: true, op: "replace", length: text.length };
    }

    // cmd.op === "apply": find every original in the same snapshot, then change them all in ONE transaction.
    const doc = v.state.doc.toString();
    const indicesOf = (haystack: string, needle: string): number[] => {
      const out: number[] = [];
      if (!needle) return out;
      for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) out.push(i);
      return out;
    };
    const normalize = (text: string): { norm: string; map: number[] } => {
      let norm = "";
      const map: number[] = [];
      let inSpace = false;
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) {
          if (!inSpace) {
            norm += " ";
            map.push(i);
          }
          inSpace = true;
        } else {
          norm += text[i];
          map.push(i);
          inSpace = false;
        }
      }
      return { norm, map };
    };
    let normalizedDoc: { norm: string; map: number[] } | null = null;

    const outcomes: ApplyOutcome[] = [];
    const changes: { from: number; to: number; insert: string }[] = [];

    for (const edit of cmd.edits) {
      const original = lf(edit.original);
      let start = -1;
      let end = -1;
      let fuzzy = false;

      const exact = indicesOf(doc, original);
      if (exact.length > 1) {
        outcomes.push({ id: edit.id, status: "ambiguous" });
        continue;
      }
      if (exact.length === 1) {
        start = exact[0];
        end = start + original.length;
      } else {
        normalizedDoc = normalizedDoc ?? normalize(doc);
        const needle = normalize(original).norm.trim();
        const hits = indicesOf(normalizedDoc.norm, needle);
        if (hits.length !== 1) {
          outcomes.push({ id: edit.id, status: hits.length > 1 ? "ambiguous" : "not-found" });
          continue;
        }
        start = normalizedDoc.map[hits[0]];
        end = normalizedDoc.map[hits[0] + needle.length - 1] + 1;
        fuzzy = true;
      }

      if (changes.some((c) => start < c.to && c.from < end)) {
        outcomes.push({ id: edit.id, status: "overlap" });
        continue;
      }
      changes.push({ from: start, to: end, insert: lf(edit.replacement) });
      outcomes.push({ id: edit.id, status: "applied", fuzzy });
    }

    if (changes.length) {
      changes.sort((a, b) => a.from - b.from);
      const expected = v.state.doc.length + changes.reduce((n, c) => n + c.insert.length - (c.to - c.from), 0);
      v.dispatch({ changes, userEvent: "input" });
      if (v.state.doc.length !== expected) {
        return fail("error", "Overleaf didn't accept the changes. Use Copy and paste them instead.");
      }
    }
    return { ok: true, op: "apply", outcomes };
  } catch (e) {
    return fail("error", `Unexpected error in the Overleaf page: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Opens a file of the project by clicking its entry in the file tree, then waits until Overleaf has
 * switched the editor to it. Used so Pull/Apply act on the right file (resume vs. cover letter).
 */
export async function overleafOpenFile(name: string, timeoutMs = 5000): Promise<BridgeResult> {
  const fail = (error: string): BridgeFailure => ({ ok: false, code: "wrong-file", error });
  try {
    const nameOf = (el: Element): string =>
      (el.getAttribute("aria-label") || el.querySelector(".entity-name, [class*='item-name'], [class*='entity-name']")?.textContent || "").trim();
    const leaf = (): Element[] => Array.from(document.querySelectorAll('[role="treeitem"]')).filter((el) => !el.querySelector('[role="treeitem"]'));
    const base = (s: string) => (s.split("/").pop() ?? s).trim().toLowerCase();
    const selected = (): string => {
      const sel = leaf().find((el) => el.getAttribute("aria-selected") === "true");
      return sel ? nameOf(sel) : "";
    };
    const docLength = (): number => {
      for (const el of Array.from(document.querySelectorAll(".cm-content"))) {
        const view = (el as unknown as { cmView?: { view?: { state?: { doc?: { length: number } } } } }).cmView?.view;
        if (view?.state?.doc) return view.state.doc.length;
      }
      return -1;
    };
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const want = base(name);
    if (!want) return fail("No file name given.");
    if (base(selected()) === want) return { ok: true, op: "open", name };

    const matches = leaf().filter((el) => base(nameOf(el)) === want);
    if (matches.length === 0) return fail(`Couldn't find "${name}" in the Overleaf file tree.`);
    if (matches.length > 1) return fail(`"${name}" exists more than once in the project. Use a more specific name, e.g. folder/${name}.`);

    const target = matches[0];
    ((target.querySelector("button") as HTMLElement | null) ?? (target as HTMLElement)).click();

    // Wait until the tree shows it as selected, then until the editor content has stopped changing.
    const deadline = Date.now() + timeoutMs;
    let stableFor = 0;
    let last = -2;
    while (Date.now() < deadline) {
      await sleep(100);
      if (base(selected()) !== want) {
        stableFor = 0;
        continue;
      }
      const len = docLength();
      stableFor = len === last && len !== -1 ? stableFor + 100 : 0;
      last = len;
      if (stableFor >= 300) return { ok: true, op: "open", name };
    }
    return fail(`Overleaf didn't switch to "${name}" in time. Open it yourself and try again.`);
  } catch (e) {
    return fail(`Couldn't open "${name}": ${e instanceof Error ? e.message : String(e)}`);
  }
}
