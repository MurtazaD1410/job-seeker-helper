import { useCallback, useEffect, useRef, useState } from "react";
import { isCancelled } from "@/lib/gemini";
import { generateInterview } from "@/lib/interview";
import type { Analysis, InterviewPack, InterviewPrefs } from "@/lib/schema";
import {
  loadInterview,
  loadInterviewNotes,
  loadInterviewPrefs,
  saveInterview,
  saveInterviewNotes,
  saveInterviewPrefs,
  type JobDraft,
  type Settings
} from "@/lib/storage";
import type { AnalysisStatus } from "./useAnalysis";

const DEFAULT_PREFS: InterviewPrefs = { language: "auto", model: "" };

export function useInterview() {
  const [pack, setPack] = useState<InterviewPack | null>(null);
  const [notes, setNotesState] = useState("");
  const [prefs, setPrefsState] = useState<InterviewPrefs>(DEFAULT_PREFS);
  const [status, setStatus] = useState<AnalysisStatus>({ state: "idle" });
  const abort = useRef<AbortController>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    void loadInterview().then((p) => setPack((prev) => prev ?? p));
    void loadInterviewNotes().then((n) => setNotesState((prev) => prev || n));
    void loadInterviewPrefs().then(setPrefsState);
  }, []);

  const setPrefs = useCallback((patch: Partial<InterviewPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      void saveInterviewPrefs(next);
      return next;
    });
  }, []);

  // Notes are kept (debounced) so switching tabs doesn't lose them.
  const setNotes = useCallback((value: string) => {
    setNotesState(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveInterviewNotes(value), 300);
  }, []);

  const run = useCallback(
    async (settings: Settings, job: JobDraft, analysis: Analysis | null) => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setStatus({ state: "running", note: "" });
      try {
        const result = await generateInterview({
          settings,
          job,
          analysis,
          notes,
          prefs,
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
        await saveInterview(result);
      } catch (e) {
        if (ctrl.signal.aborted || isCancelled(e)) return setStatus({ state: "idle" });
        setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [notes, prefs]
  );

  const cancel = useCallback(() => abort.current?.abort(), []);

  // Stops a running generation and forgets the pack and notes (the language and model preferences are kept).
  const reset = useCallback(() => {
    abort.current?.abort();
    clearTimeout(timer.current);
    setPack(null);
    setNotesState("");
    setStatus({ state: "idle" });
  }, []);

  return { pack, notes, setNotes, prefs, setPrefs, status, run, cancel, reset };
}
