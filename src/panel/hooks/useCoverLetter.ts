import { useCallback, useEffect, useRef, useState } from "react";
import { generateCoverLetter } from "@/lib/coverLetter";
import { isCancelled } from "@/lib/gemini";
import type { Analysis, CoverLetter, CoverPrefs } from "@/lib/schema";
import {
  loadCoverLetter,
  loadCoverPrefs,
  saveCoverLetter,
  saveCoverPrefs,
  type JobDraft,
  type Settings
} from "@/lib/storage";
import type { AnalysisStatus } from "./useAnalysis";

export function useCoverLetter() {
  const [letter, setLetter] = useState<CoverLetter | null>(null);
  const [prefs, setPrefsState] = useState<CoverPrefs>({ tone: "formal", language: "auto" });
  const [status, setStatus] = useState<AnalysisStatus>({ state: "idle" });
  const abort = useRef<AbortController>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    void loadCoverLetter().then((c) => setLetter((prev) => prev ?? c));
    void loadCoverPrefs().then(setPrefsState);
  }, []);

  const setPrefs = useCallback((patch: Partial<CoverPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      void saveCoverPrefs(next);
      return next;
    });
  }, []);

  const run = useCallback(
    async (settings: Settings, job: JobDraft, analysis: Analysis | null) => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setStatus({ state: "running", note: "" });
      try {
        const result = await generateCoverLetter({
          settings,
          job,
          analysis,
          tone: prefs.tone,
          language: prefs.language,
          signal: ctrl.signal,
          onRetry: (r) =>
            setStatus({
              state: "running",
              note: `${r.reason} Retrying in ${Math.ceil(r.waitMs / 1000)}s (attempt ${r.attempt + 1} of ${r.maxAttempts}).`
            })
        });
        if (ctrl.signal.aborted) return;
        setLetter(result);
        setStatus({ state: "idle" });
        await saveCoverLetter(result);
      } catch (e) {
        if (ctrl.signal.aborted || isCancelled(e)) return setStatus({ state: "idle" });
        setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [prefs]
  );

  const cancel = useCallback(() => abort.current?.abort(), []);

  // Your edits in the preview are kept (debounced) so switching tabs doesn't lose them.
  const edit = useCallback((latex: string) => {
    setLetter((prev) => {
      if (!prev) return prev;
      const next = { ...prev, latex };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveCoverLetter(next), 300);
      return next;
    });
  }, []);

  // Stops a running generation and forgets the draft (tone and language preferences are kept).
  const reset = useCallback(() => {
    abort.current?.abort();
    clearTimeout(timer.current);
    setLetter(null);
    setStatus({ state: "idle" });
  }, []);

  return { letter, prefs, setPrefs, status, run, edit, cancel, reset };
}
