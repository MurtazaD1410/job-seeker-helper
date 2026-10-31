import { useCallback, useEffect, useRef, useState } from "react";
import { isCancelled } from "@/lib/gemini";
import { generateOutreach } from "@/lib/outreach";
import type { Analysis, CoverPrefs, Outreach, OutreachField } from "@/lib/schema";
import { loadOutreach, saveOutreach, type JobDraft, type Settings } from "@/lib/storage";
import type { AnalysisStatus } from "./useAnalysis";

export function useOutreach() {
  const [pack, setPack] = useState<Outreach | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>({ state: "idle" });
  const abort = useRef<AbortController>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    void loadOutreach().then((p) => setPack((prev) => prev ?? p));
  }, []);

  const run = useCallback(async (settings: Settings, job: JobDraft, analysis: Analysis | null, prefs: CoverPrefs, recipient: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStatus({ state: "running", note: "" });
    try {
      const result = await generateOutreach({
        settings,
        job,
        analysis,
        tone: prefs.tone,
        language: prefs.language,
        recipient,
        signal: ctrl.signal,
        onRetry: (r) =>
          setStatus({
            state: "running",
            note: `${r.reason} Retrying in ${Math.ceil(r.waitMs / 1000)}s (attempt ${r.attempt + 1} of ${r.maxAttempts}).`
          })
      });
      if (ctrl.signal.aborted) return;
      setPack(result);
      setStatus({ state: "idle" });
      await saveOutreach(result);
    } catch (e) {
      if (ctrl.signal.aborted || isCancelled(e)) return setStatus({ state: "idle" });
      setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Your edits to a message are kept (debounced) so switching tabs doesn't lose them.
  const edit = useCallback((field: OutreachField, value: string) => {
    setPack((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveOutreach(next), 300);
      return next;
    });
  }, []);

  const cancel = useCallback(() => abort.current?.abort(), []);

  // Stops a running generation and forgets the messages. Cancels a pending save of an edit.
  const reset = useCallback(() => {
    abort.current?.abort();
    clearTimeout(timer.current);
    setPack(null);
    setStatus({ state: "idle" });
  }, []);

  return { pack, status, run, edit, cancel, reset };
}
