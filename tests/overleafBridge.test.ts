// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { overleafBridge } from "@/content/overleafBridge";
import { samePreamble, type BridgeCommand, type BridgeResult } from "@/lib/overleaf";

// Chrome serialises the function and runs it in the page, detached from this module.
const run = (cmd: BridgeCommand): BridgeResult => new Function(`return (${overleafBridge.toString()})`)()(cmd);

interface Change {
  from: number;
  to?: number;
  insert?: string;
}

/** A stand-in for CodeMirror's EditorView with the same change semantics (positions in the original doc). */
function installEditor(initial: string, opts: { readOnly?: boolean; reject?: boolean; uneditable?: boolean } = {}) {
  let text = initial;
  const calls: unknown[] = [];
  const view = {
    get state() {
      return { doc: { length: text.length, toString: () => text }, readOnly: !!opts.readOnly };
    },
    contentDOM: { getAttribute: (n: string) => (n === "contenteditable" && opts.uneditable ? "false" : null) },
    dispatch(spec: { changes: Change | Change[] }) {
      calls.push(spec);
      if (opts.reject) return;
      const list = ([] as Change[]).concat(spec.changes).sort((a, b) => a.from - b.from);
      let out = "";
      let pos = 0;
      for (const c of list) {
        out += text.slice(pos, c.from) + (c.insert ?? "");
        pos = c.to ?? c.from;
      }
      text = out + text.slice(pos);
    }
  };
  document.body.innerHTML = '<div class="cm-editor"><div class="cm-content"></div></div>';
  (document.querySelector(".cm-content") as unknown as { cmView: unknown }).cmView = { view };
  return { get text() { return text; }, calls };
}

const DOC = String.raw`\section{Experience}
\resumeItem{Built REST APIs in Python and
    deployed them on AWS.}
\resumeItem{Wrote unit tests.}
\resumeItem{Wrote unit tests.}
\section{Skills}
Python, TypeScript
`;

const edit = (id: string, original: string, replacement: string) => ({ id, original, replacement });

describe("overleafBridge", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("runs as a detached, serialised function and reports a missing editor", () => {
    expect(run({ op: "read" })).toMatchObject({ ok: false, code: "no-editor" });
  });

  it("reads the document and probes the page", () => {
    installEditor(DOC);
    expect(run({ op: "read" })).toEqual({ ok: true, op: "read", text: DOC });
    expect(run({ op: "probe" })).toMatchObject({ ok: true, op: "probe", docLength: DOC.length, readOnly: false, hasCsrfToken: false });
  });

  it("applies edits in one transaction, in original coordinates, whatever their order", () => {
    const ed = installEditor(DOC);
    const r = run({
      op: "apply",
      edits: [edit("s2", "Python, TypeScript", "Python, TypeScript, Redux"), edit("s1", "Built REST APIs in Python and", "Built and documented REST APIs in Python and")]
    });
    expect(r).toMatchObject({ ok: true, op: "apply" });
    expect(ed.calls).toHaveLength(1); // a single transaction = a single undo step
    expect(ed.text).toBe(
      DOC.replace("Built REST APIs in Python and", "Built and documented REST APIs in Python and").replace("Python, TypeScript", "Python, TypeScript, Redux")
    );
    if (r.ok && r.op === "apply") expect(r.outcomes.map((o) => [o.id, o.status])).toEqual([["s2", "applied"], ["s1", "applied"]]);
  });

  it("inserts replacement text literally", () => {
    const ed = installEditor(DOC);
    run({ op: "apply", edits: [edit("s1", "Python, TypeScript", String.raw`saved \$5 ($& $1)`)] });
    expect(ed.text).toContain(String.raw`saved \$5 ($& $1)`);
  });

  it("matches across whitespace differences and says so", () => {
    const ed = installEditor(DOC);
    const r = run({ op: "apply", edits: [edit("s1", String.raw`\resumeItem{Built REST APIs in Python and deployed them on AWS.}`, String.raw`\resumeItem{Shipped APIs.}`)] });
    expect(ed.text).toContain(String.raw`\resumeItem{Shipped APIs.}`);
    expect(ed.text).not.toContain("deployed them");
    if (r.ok && r.op === "apply") expect(r.outcomes[0]).toEqual({ id: "s1", status: "applied", fuzzy: true });
  });

  it("reports not-found, ambiguous and overlapping edits without touching the document for them", () => {
    const ed = installEditor(DOC);
    const r = run({
      op: "apply",
      edits: [
        edit("missing", "no such text", "x"),
        edit("twice", String.raw`\resumeItem{Wrote unit tests.}`, "y"),
        edit("a", "Python, TypeScript", "Python"),
        edit("b", "TypeScript", "TS")
      ]
    });
    expect(r.ok && r.op === "apply" && r.outcomes.map((o) => [o.id, o.status])).toEqual([
      ["missing", "not-found"],
      ["twice", "ambiguous"],
      ["a", "applied"],
      ["b", "overlap"]
    ]);
    expect(ed.text).toBe(DOC.replace("Python, TypeScript", "Python"));
  });

  it("does not dispatch anything when no edit applies", () => {
    const ed = installEditor(DOC);
    run({ op: "apply", edits: [edit("x", "nope", "y")] });
    expect(ed.calls).toHaveLength(0);
    expect(ed.text).toBe(DOC);
  });

  it("replaces the whole document in one transaction and normalises line endings", () => {
    const ed = installEditor(DOC);
    const r = run({ op: "replace", text: "a\r\nb\rc" });
    expect(r).toEqual({ ok: true, op: "replace", length: 5 });
    expect(ed.text).toBe("a\nb\nc");
    expect(ed.calls).toHaveLength(1);
  });

  it("refuses to write when the editor is read-only", () => {
    for (const opts of [{ readOnly: true }, { uneditable: true }]) {
      const ed = installEditor(DOC, opts);
      expect(run({ op: "replace", text: "x" })).toMatchObject({ ok: false, code: "read-only" });
      expect(run({ op: "apply", edits: [edit("s", "Python, TypeScript", "x")] })).toMatchObject({ ok: false, code: "read-only" });
      expect(ed.text).toBe(DOC);
      // reading is still fine
      expect(run({ op: "read" })).toMatchObject({ ok: true });
    }
  });

  it("detects a change that Overleaf silently rejected", () => {
    installEditor(DOC, { reject: true });
    expect(run({ op: "replace", text: "x" })).toMatchObject({ ok: false, code: "error" });
    expect(run({ op: "apply", edits: [edit("s", "Python, TypeScript", "x")] })).toMatchObject({ ok: false, code: "error" });
  });
});

describe("samePreamble", () => {
  const a = String.raw`\documentclass{article}
\usepackage{foo}
\begin{document}
Hello
\end{document}`;
  it("compares preambles ignoring whitespace and body text", () => {
    expect(samePreamble(a, a.replace("Hello", "Other body"))).toBe(true);
    expect(samePreamble(a, a.replace("\\usepackage{foo}", "\\usepackage{foo}  \n"))).toBe(true);
  });
  it("flags a different file, a fragment, and can't tell for a fragment reference", () => {
    expect(samePreamble(a, a.replace("article", "letter"))).toBe(false);
    expect(samePreamble(a, "just some text")).toBe(false);
    expect(samePreamble("no document marker here", "anything")).toBe(true);
  });
});
