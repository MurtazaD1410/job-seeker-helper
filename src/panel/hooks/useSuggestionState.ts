import { useCallback, useEffect, useRef, useState } from "react";
import type { Analysis, SuggestionStates } from "@/lib/schema";
import { loadSuggestionState, saveSuggestionState } from "@/lib/storage";

type Entry = SuggestionStates[string];

// Copied / skipped / applied / failed per suggestion, persisted for the current analysis run.
export function useSuggestionState(analysis: Analysis | null) {
  const [items, setItems] = useState<SuggestionStates>({});
  const ref = useRef(items);
  const runId = analysis?.created_at;

  useEffect(() => {
    ref.current = {};
    setItems({});
    if (runId === undefined) return;
    let alive = true;
    void loadSuggestionState(runId).then((loaded) => {
      if (!alive) return;
      ref.current = loaded;
      setItems(loaded);
    });
    return () => {
      alive = false;
    };
  }, [runId]);

  /** Set a suggestion's state, or clear it with `null`. */
  const set = useCallback(
    (id: string, entry: Entry | null) => {
      const next = { ...ref.current };
      if (entry) next[id] = entry;
      else delete next[id];
      ref.current = next;
      setItems(next);
      if (runId !== undefined) void saveSuggestionState(runId, next);
    },
    [runId]
  );

  return { items, set };
}
