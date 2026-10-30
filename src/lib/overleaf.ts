// Types and the panel-side client for talking to an Overleaf tab.
// Flow: panel -> background service worker -> chrome.scripting (MAIN world) -> overleafBridge().

export const OVERLEAF_PROJECT_PATTERN = "https://www.overleaf.com/project/*";

export interface OverleafTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
  /** Overleaf's project id from the URL; stays the same when tabs are closed and reopened. */
  projectId: string;
}

/** "https://www.overleaf.com/project/64f0a1.../..." -> "64f0a1..." (empty if not a project URL). */
export function projectIdFromUrl(url: string): string {
  return /\/project\/([0-9a-fA-F]+)/.exec(url)?.[1] ?? "";
}

export interface EditInput {
  id: string;
  original: string;
  replacement: string;
}

export type BridgeCommand =
  | { op: "probe" }
  | { op: "read" }
  | { op: "apply"; edits: EditInput[] }
  | { op: "replace"; text: string }
  /** File names in the project's file tree, plus the one that is open. */
  | { op: "files" }
  /** Open a file of the project in the editor. */
  | { op: "open"; name: string }
  /**
   * Click Recompile and, if `download`, wait for the newest PDF and return it (base64). Without
   * `download` it only starts a compile and returns at once.
   */
  | { op: "compile"; download: boolean; timeoutMs?: number };

export type ApplyStatus = "applied" | "not-found" | "ambiguous" | "overlap";
export interface ApplyOutcome {
  id: string;
  status: ApplyStatus;
  /** Matched only after ignoring whitespace differences. */
  fuzzy?: boolean;
}

export interface BridgeFailure {
  ok: false;
  code: "no-editor" | "read-only" | "no-access" | "wrong-file" | "compile" | "error";
  error: string;
}

export type ProbeInfo = {
  ok: true;
  op: "probe";
  docLength: number;
  readOnly: boolean;
  /** Name of the file selected in the file tree, if the page shows it. */
  fileHint: string;
  projectId: string;
  /** For diagnostics: what the page exposes (used to decide how PDF building can work). */
  canRecompile: boolean;
  hasCsrfToken: boolean;
  hasPdfLink: boolean;
};

export type BridgeResult =
  | BridgeFailure
  | ProbeInfo
  | { ok: true; op: "read"; text: string }
  | { ok: true; op: "apply"; outcomes: ApplyOutcome[] }
  | { ok: true; op: "replace"; length: number }
  | { ok: true; op: "files"; files: string[]; current: string }
  | { ok: true; op: "open"; name: string }
  | {
      ok: true;
      op: "compile";
      pdfBase64: string;
      bytes: number;
      /** How the PDF was obtained; "browser" means Overleaf's own link downloaded it as output.pdf. */
      via: "fetch" | "timing" | "browser" | "none";
      /** The error count shown on Overleaf's "View logs" button, if any. */
      logBadge: string;
    };

export const OUTCOME_MESSAGE: Record<Exclude<ApplyStatus, "applied">, string> = {
  "not-found": "The text wasn't found in the open Overleaf file. Is the right file open, and does it match your master?",
  ambiguous: "The text appears more than once in the open Overleaf file, so it can't be placed safely.",
  overlap: "It overlaps another change in the same batch."
};

export async function listOverleafTabs(): Promise<OverleafTab[]> {
  const tabs = await chrome.tabs.query({ url: OVERLEAF_PROJECT_PATTERN });
  return tabs
    .filter((t): t is chrome.tabs.Tab & { id: number } => typeof t.id === "number")
    .map((t) => ({ id: t.id, title: t.title ?? "Overleaf project", url: t.url ?? "", active: !!t.active, projectId: projectIdFromUrl(t.url ?? "") }));
}

export async function callOverleaf(tabId: number, cmd: BridgeCommand): Promise<BridgeResult> {
  try {
    const reply: unknown = await chrome.runtime.sendMessage({ type: "overleaf", tabId, cmd });
    if (reply && typeof reply === "object" && typeof (reply as { ok?: unknown }).ok === "boolean") return reply as BridgeResult;
    return { ok: false, code: "error", error: "The extension's background worker didn't answer. Reload the extension and try again." };
  } catch (e) {
    return { ok: false, code: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

const normalizeSpace = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Whether two LaTeX files share the same preamble (class, packages, commands). Used to warn before
 * replacing the open Overleaf file with a cover letter: if the preambles differ, it is probably a
 * different file. Returns true if it can't tell (no \begin{document} in the reference text).
 */
export function samePreamble(reference: string, other: string): boolean {
  const marker = "\\begin{document}";
  const a = reference.indexOf(marker);
  if (a === -1) return true;
  const b = other.indexOf(marker);
  if (b === -1) return false;
  return normalizeSpace(reference.slice(0, a)) === normalizeSpace(other.slice(0, b));
}

/** Whether two file names refer to the same file (case-insensitive, folders ignored). */
export function sameFile(a: string, b: string): boolean {
  const base = (s: string) => (s.split("/").pop() ?? s).trim().toLowerCase();
  return base(a) !== "" && base(a) === base(b);
}

/** The tab a document should use: its own project's tab, or the default tab when it has no project. */
export function pickTab(tabs: OverleafTab[], defaultTabId: number | null, project: string): OverleafTab | undefined {
  return project ? tabs.find((t) => t.projectId === project) : tabs.find((t) => t.id === defaultTabId);
}

/** Decodes the base64 PDF returned by the compile command. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
