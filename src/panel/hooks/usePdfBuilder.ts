import { useCallback, useEffect, useState } from "react";
import { buildPdf, type BuildInput, type BuildOutcome } from "@/lib/buildPdf";
import { downloadBytes } from "@/lib/download";
import { loadPendingRestore, savePendingRestore, type PendingRestore } from "@/lib/pendingRestore";
import type { DocTarget, OverleafApi } from "./useOverleaf";

export type BuildState =
  | { phase: "idle" }
  | { phase: "running"; label: string; step: string }
  | { phase: "done"; label: string; fileName: string; outcome: BuildOutcome };

export interface PdfBuilder {
  state: BuildState;
  /** A backup left by a build that didn't finish restoring the Overleaf file. */
  pending: PendingRestore | null;
  run: (p: { label: string; doc: DocTarget; fileName: string } & BuildInput) => Promise<void>;
  restorePending: () => Promise<string | null>;
  dismissPending: () => Promise<void>;
  clearResult: () => void;
}

// Builds a PDF via Overleaf and keeps track of backups that still need restoring.
export function usePdfBuilder(overleaf: OverleafApi): PdfBuilder {
  const [state, setState] = useState<BuildState>({ phase: "idle" });
  const [pending, setPending] = useState<PendingRestore | null>(null);

  // On startup a leftover record means an earlier build was interrupted (this panel isn't building).
  useEffect(() => {
    void loadPendingRestore().then(setPending);
  }, []);

  const run: PdfBuilder["run"] = useCallback(
    async ({ label, doc, fileName, tailored, restoreTo, meta }) => {
      setState({ phase: "running", label, step: "Starting…" });
      const outcome = await buildPdf(
        {
          call: (cmd) => overleaf.callFor(doc, cmd),
          savePending: async (p) => {
            await savePendingRestore(p);
            setPending(p);
          },
          onStep: (step) => setState({ phase: "running", label, step })
        },
        { tailored, restoreTo, meta }
      );
      if (outcome.pdf) downloadBytes(fileName, outcome.pdf);
      setState({ phase: "done", label, fileName, outcome });
      overleaf.recheck();
    },
    [overleaf]
  );

  const restorePending = useCallback(async (): Promise<string | null> => {
    if (!pending) return null;
    const doc = { project: pending.project, file: pending.file };
    const w = await overleaf.callFor(doc, { op: "replace", text: pending.text });
    if (!w.ok || w.op !== "replace") return w.ok ? "Unexpected reply from Overleaf." : w.error;
    const check = await overleaf.callFor(doc, { op: "read" });
    const same = check.ok && check.op === "read" && check.text.replace(/\r\n?/g, "\n") === pending.text.replace(/\r\n?/g, "\n");
    if (!same) return "The restored file doesn't match the backup. Try again.";
    await savePendingRestore(null);
    setPending(null);
    overleaf.recheck();
    return null;
  }, [overleaf, pending]);

  const dismissPending = useCallback(async () => {
    await savePendingRestore(null);
    setPending(null);
  }, []);

  return { state, pending, run, restorePending, dismissPending, clearResult: () => setState({ phase: "idle" }) };
}
