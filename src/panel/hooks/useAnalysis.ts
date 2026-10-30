import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeJob } from "@/lib/analysis";
import { isCancelled } from "@/lib/gemini";
import type { Analysis } from "@/lib/schema";
import { loadAnalysis, saveAnalysis, type JobDraft, type Settings } from "@/lib/storage";

export type AnalysisStatus =
  | { state: "idle" }
  | { state: "running"; note: string }
  | { state: "error"; message: string };

export function useAnalysis() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>({ state: "idle" });
  const abort = useRef<AbortController>(undefined);

  useEffect(() => {
    void loadAnalysis().then((a) => setAnalysis((prev) => prev ?? a));
  }, []);

  const run = useCallback(async (settings: Settings, job: JobDraft) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStatus({ state: "running", note: "" });
    try {
      const result = await analyzeJob({
        settings,
        job,
        signal: ctrl.signal,
        onRetry: (r) =>
          setStatus({
            state: "running",
            note: `${r.reason} Retrying in ${Math.ceil(r.waitMs / 1000)}s (attempt ${r.attempt + 1} of ${r.maxAttempts}).`
          })
      });
      if (ctrl.signal.aborted) return;
      setAnalysis(result);
      setStatus({ state: "idle" });
      await saveAnalysis(result);
    } catch (e) {
      if (ctrl.signal.aborted || isCancelled(e)) return setStatus({ state: "idle" });
      setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const cancel = useCallback(() => abort.current?.abort(), []);

  // Stops a running analysis and forgets the result.
  const reset = useCallback(() => {
    abort.current?.abort();
    setAnalysis(null);
    setStatus({ state: "idle" });
  }, []);

  return { analysis, status, run, cancel, reset };
}
