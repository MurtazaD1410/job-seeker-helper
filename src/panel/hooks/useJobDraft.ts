import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_JOB, loadJobDraft, saveJobDraft, type JobDraft } from "@/lib/storage";

// Holds the job being worked on. Persisted (debounced) so closing the panel doesn't lose it.
export function useJobDraft() {
  const [job, setJobState] = useState<JobDraft>(EMPTY_JOB);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hydrated = useRef(false);

  useEffect(() => {
    void loadJobDraft().then((j) => {
      // Don't clobber anything typed before the stored draft arrived.
      if (!hydrated.current) setJobState(j);
      hydrated.current = true;
    });
  }, []);

  const setJob = useCallback((patch: Partial<JobDraft>) => {
    hydrated.current = true;
    setJobState((prev) => {
      const next = { ...prev, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveJobDraft(next), 300);
      return next;
    });
  }, []);

  // Back to an empty job. Cancels a pending save so the old draft can't be written again.
  const reset = useCallback(() => {
    clearTimeout(timer.current);
    hydrated.current = true;
    setJobState(EMPTY_JOB);
  }, []);

  return { job, setJob, reset };
}
