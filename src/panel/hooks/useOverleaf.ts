import { useCallback, useEffect, useRef, useState } from "react";
import {
  callOverleaf,
  listOverleafTabs,
  pickTab,
  sameFile,
  type BridgeCommand,
  type BridgeResult,
  type OverleafTab,
  type ProbeInfo
} from "@/lib/overleaf";

export type OverleafStatus =
  | { state: "none" }
  | { state: "checking" }
  | { state: "ready"; info: ProbeInfo }
  | { state: "error"; message: string };

/** Where a document (resume or cover letter) lives in Overleaf. Empty strings mean "use the default". */
export interface DocTarget {
  /** Overleaf project id; empty = the tab selected in the Overleaf bar. */
  project: string;
  /** File name in that project; empty = whichever file is open. */
  file: string;
}

export interface OverleafApi {
  tabs: OverleafTab[];
  /** The default tab: used by documents that have no project of their own. */
  targetId: number | null;
  setTargetId: (id: number) => void;
  status: OverleafStatus;
  /** The open tab for a project id (or the default tab for ""), if there is one. */
  tabFor: (project: string) => OverleafTab | undefined;
  /** .tex etc. files found in that project's tab. */
  filesFor: (project: string) => string[];
  /** Re-read the tabs, their file lists and the default tab's editor state. */
  recheck: () => void;
  /**
   * Runs a command for a document: finds the document's project tab, makes sure its file is the open one
   * (switching to it, or failing with a clear message rather than touching the wrong file), then runs it.
   */
  callFor: (doc: DocTarget, cmd: BridgeCommand) => Promise<BridgeResult>;
}

// Which Overleaf project tabs are open, which is the default target, and whether its editor is reachable.
export function useOverleaf(): OverleafApi {
  const [tabs, setTabs] = useState<OverleafTab[]>([]);
  const [targetId, setTargetIdState] = useState<number | null>(null);
  const [status, setStatus] = useState<OverleafStatus>({ state: "none" });
  const [filesByTab, setFilesByTab] = useState<Record<number, string[]>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refreshTabs = useCallback(async () => {
    const list = await listOverleafTabs();
    setTabs(list);
    // Keep the current default while it exists; otherwise prefer the tab the user is looking at.
    setTargetIdState((cur) => (cur !== null && list.some((t) => t.id === cur) ? cur : (list.find((t) => t.active) ?? list[0])?.id ?? null));
    const entries = await Promise.all(
      list.map(async (t) => {
        const r = await callOverleaf(t.id, { op: "files" });
        return [t.id, r.ok && r.op === "files" ? r.files : []] as const;
      })
    );
    setFilesByTab(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void refreshTabs();
    const soon = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void refreshTabs(), 250);
    };
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (change.url || change.title || change.status === "complete") soon();
    };
    chrome.tabs.onCreated.addListener(soon);
    chrome.tabs.onRemoved.addListener(soon);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      clearTimeout(timer.current);
      chrome.tabs.onCreated.removeListener(soon);
      chrome.tabs.onRemoved.removeListener(soon);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refreshTabs]);

  const check = useCallback(async (id: number) => {
    setStatus({ state: "checking" });
    const r = await callOverleaf(id, { op: "probe" });
    setStatus(r.ok && r.op === "probe" ? { state: "ready", info: r } : { state: "error", message: r.ok ? "Unexpected reply from Overleaf." : r.error });
  }, []);

  useEffect(() => {
    if (targetId === null) setStatus({ state: "none" });
    else void check(targetId);
  }, [targetId, check]);

  const tabFor = useCallback(
    (project: string) => pickTab(tabs, targetId, project),
    [tabs, targetId]
  );

  const filesFor = useCallback((project: string) => filesByTab[tabFor(project)?.id ?? -1] ?? [], [filesByTab, tabFor]);

  const callFor = useCallback(
    async (doc: DocTarget, cmd: BridgeCommand): Promise<BridgeResult> => {
      const tab = tabFor(doc.project);
      if (!tab) {
        return {
          ok: false,
          code: "no-access",
          error: doc.project
            ? "The Overleaf project chosen for this document isn't open in a tab. Open it and try again, or use Copy."
            : "No Overleaf project tab is open. Open your project in a tab, or use Copy."
        };
      }
      const want = doc.file.trim();
      if (want) {
        // Only block when we KNOW another file is open; if the page doesn't reveal it, carry on.
        const p = await callOverleaf(tab.id, { op: "probe" });
        if (p.ok && p.op === "probe" && p.fileHint && !sameFile(p.fileHint, want)) {
          const o = await callOverleaf(tab.id, { op: "open", name: want });
          if (!o.ok) {
            return { ok: false, code: "wrong-file", error: `Overleaf has "${p.fileHint}" open, not "${want}". ${o.error}` };
          }
        }
      }
      return callOverleaf(tab.id, cmd);
    },
    [tabFor]
  );

  return {
    tabs,
    targetId,
    setTargetId: setTargetIdState,
    status,
    tabFor,
    filesFor,
    recheck: () => {
      void refreshTabs();
      if (targetId !== null) void check(targetId);
    },
    callFor
  };
}
