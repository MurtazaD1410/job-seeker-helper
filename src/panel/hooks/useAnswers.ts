import { useCallback, useEffect, useRef, useState } from "react";
import { generateAnswer } from "@/lib/answers";
import { isCancelled } from "@/lib/gemini";
import type { Analysis, Answer, AnswerPrefs } from "@/lib/schema";
import { loadAnswerPrefs, loadAnswers, saveAnswerPrefs, saveAnswers, type JobDraft, type Settings } from "@/lib/storage";
import type { AnalysisStatus } from "./useAnalysis";

/** Older answers beyond this are dropped, newest first. */
const MAX_KEPT = 30;

const DEFAULT_PREFS: AnswerPrefs = { language: "auto", level: "b2", length: "medium", model: "", maxChars: 0 };

export function useAnswers() {
  const [items, setItems] = useState<Answer[]>([]);
  const [prefs, setPrefsState] = useState<AnswerPrefs>(DEFAULT_PREFS);
  const [status, setStatus] = useState<AnalysisStatus>({ state: "idle" });
  const abort = useRef<AbortController>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The latest list, readable from the async run() without waiting for a state update.
  const itemsRef = useRef<Answer[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    void loadAnswers().then((a) => setItems((prev) => (prev.length ? prev : a)));
    void loadAnswerPrefs().then(setPrefsState);
  }, []);

  const setPrefs = useCallback((patch: Partial<AnswerPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      void saveAnswerPrefs(next);
      return next;
    });
  }, []);

  // Resolves to true when an answer was added, so the tab can clear its question box.
  const run = useCallback(
    async (settings: Settings, job: JobDraft, analysis: Analysis | null, question: string): Promise<boolean> => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setStatus({ state: "running", note: "" });
      try {
        const result = await generateAnswer({
          settings,
          job,
          analysis,
          question,
          prefs,
          signal: ctrl.signal,
          onRetry: (r) =>
            setStatus({
              state: "running",
              note: `${r.reason} Retrying in ${Math.ceil(r.waitMs / 1000)}s (attempt ${r.attempt + 1} of ${r.maxAttempts}).`
            })
        });
        if (ctrl.signal.aborted) return false;
        const next = [result, ...itemsRef.current].slice(0, MAX_KEPT);
        itemsRef.current = next;
        setItems(next);
        setStatus({ state: "idle" });
        await saveAnswers(next);
        return true;
      } catch (e) {
        if (ctrl.signal.aborted || isCancelled(e)) setStatus({ state: "idle" });
        else setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [prefs]
  );

  // Your edits to an answer are kept (debounced) so switching tabs doesn't lose them.
  const edit = useCallback((id: string, value: string) => {
    setItems((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, answer: value } : a));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveAnswers(next), 300);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((a) => a.id !== id);
      clearTimeout(timer.current);
      void saveAnswers(next);
      return next;
    });
  }, []);

  const cancel = useCallback(() => abort.current?.abort(), []);

  // Stops a running generation and forgets the answers (the language level and other preferences are kept).
  const reset = useCallback(() => {
    abort.current?.abort();
    clearTimeout(timer.current);
    setItems([]);
    setStatus({ state: "idle" });
  }, []);

  return { items, prefs, setPrefs, status, run, edit, remove, cancel, reset };
}
