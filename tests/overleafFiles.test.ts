// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { overleafBridge, overleafOpenFile } from "@/content/overleafBridge";
import { sameFile, type BridgeResult } from "@/lib/overleaf";

// Chrome serialises these functions and runs them in the page, detached from this module.
const detached = <T>(fn: unknown) => new Function(`return (${String(fn)})`)() as T;
const files = () => detached<typeof overleafBridge>(overleafBridge)({ op: "files" });
const open = (name: string, timeoutMs?: number): Promise<BridgeResult> =>
  detached<typeof overleafOpenFile>(overleafOpenFile)(name, timeoutMs);

const TREE = `
  <div class="file-tree"><ul>
    <li role="treeitem" aria-label="resume.tex" aria-selected="true"><button>resume.tex</button></li>
    <li role="treeitem" aria-label="cover_letter.tex" aria-selected="false"><button>cover_letter.tex</button></li>
    <li role="treeitem" aria-label="figures" aria-expanded="true"><ul>
      <li role="treeitem" aria-label="logo.png" aria-selected="false"><button>logo.png</button></li>
    </ul></li>
  </ul></div>
  <div class="cm-editor"><div class="cm-content"></div></div>`;

const DOCS: Record<string, string> = { "resume.tex": "RESUME TEXT", "cover_letter.tex": "COVER LETTER TEXT is longer", "logo.png": "" };

/** Overleaf-like behaviour: clicking an entry selects it and, a moment later, swaps the editor's document. */
function install(opts: { switches?: boolean } = {}) {
  document.body.innerHTML = TREE;
  let text = DOCS["resume.tex"];
  const view = {
    get state() {
      return { doc: { length: text.length, toString: () => text }, readOnly: false };
    },
    contentDOM: { getAttribute: () => null },
    dispatch() {}
  };
  (document.querySelector(".cm-content") as unknown as { cmView: unknown }).cmView = { view };

  if (opts.switches !== false) {
    for (const li of Array.from(document.querySelectorAll('[role="treeitem"][aria-label$=".tex"], [aria-label="logo.png"]'))) {
      li.addEventListener("click", () => {
        document.querySelectorAll('[role="treeitem"]').forEach((e) => e.setAttribute("aria-selected", String(e === li)));
        setTimeout(() => (text = DOCS[li.getAttribute("aria-label") ?? ""] ?? ""), 120);
      });
    }
  }
  return { get text() { return text; } };
}

describe("file tree helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("lists files (not folders) and the open one, even without an editor", () => {
    document.body.innerHTML = TREE.replace('<div class="cm-editor"><div class="cm-content"></div></div>', "");
    expect(files()).toEqual({ ok: true, op: "files", files: ["resume.tex", "cover_letter.tex", "logo.png"], current: "resume.tex" });
  });

  it("probe reports which file is open", () => {
    install();
    const probe = detached<typeof overleafBridge>(overleafBridge)({ op: "probe" });
    expect(probe).toMatchObject({ ok: true, fileHint: "resume.tex" });
  });

  it("opens another file and waits until the editor has switched", async () => {
    const ed = install();
    const r = await open("cover_letter.tex");
    expect(r).toEqual({ ok: true, op: "open", name: "cover_letter.tex" });
    expect(ed.text).toBe(DOCS["cover_letter.tex"]); // the document had finished switching when it returned
    expect(files()).toMatchObject({ current: "cover_letter.tex" });
  });

  it("does nothing when the file is already open, and ignores folders and case", async () => {
    install();
    expect(await open("RESUME.TEX")).toEqual({ ok: true, op: "open", name: "RESUME.TEX" });
    expect(await open("figures/logo.png", 2000)).toMatchObject({ ok: true });
  });

  it("fails clearly for a missing or ambiguous file name", async () => {
    install();
    expect(await open("nope.tex")).toMatchObject({ ok: false, code: "wrong-file", error: expect.stringContaining("Couldn't find") });
    document.querySelector('[aria-label="logo.png"]')!.setAttribute("aria-label", "resume.tex");
    document.querySelector('[aria-label="resume.tex"][aria-selected="true"]')!.setAttribute("aria-selected", "false");
    expect(await open("resume.tex")).toMatchObject({ ok: false, error: expect.stringContaining("more than once") });
  });

  it("times out if Overleaf never switches", async () => {
    install({ switches: false });
    expect(await open("cover_letter.tex", 400)).toMatchObject({ ok: false, code: "wrong-file", error: expect.stringContaining("in time") });
  });
});

describe("sameFile", () => {
  it("compares base names, ignoring case and folders", () => {
    expect(sameFile("resume.tex", "Resume.TEX")).toBe(true);
    expect(sameFile("cv/resume.tex", "resume.tex")).toBe(true);
    expect(sameFile("resume.tex", "cover.tex")).toBe(false);
    expect(sameFile("", "")).toBe(false);
  });
});
