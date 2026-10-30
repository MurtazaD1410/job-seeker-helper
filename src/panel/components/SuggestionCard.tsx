import { Check, Copy, SquarePen, Undo2, X } from "lucide-react";
import type { Suggestion, SuggestionStates } from "@/lib/schema";
import { DiffView } from "./DiffView";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

interface Props {
  suggestion: Suggestion;
  index: number;
  state?: SuggestionStates[string];
  /** The original text no longer matches the base resume exactly (resume edited since the analysis). */
  stale: boolean;
  /** An Overleaf tab is available and nothing else is being applied right now. */
  canApply: boolean;
  onCopy: () => void;
  onSkip: () => void;
  onRestore: () => void;
  onApply: () => void;
}

export function SuggestionCard({ suggestion: s, index, state, stale, canApply, onCopy, onSkip, onRestore, onApply }: Props) {
  const status = state?.status;

  if (status === "skipped") {
    return (
      <Card className="flex items-center gap-3 p-3 text-sm text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          #{index + 1} {s.section || "Suggestion"} · skipped
        </span>
        <Button size="sm" variant="ghost" onClick={onRestore}>
          <Undo2 /> Restore
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">
          #{index + 1} {s.section || "Suggestion"}
        </span>
        {status === "applied" && <Badge variant="success">Applied</Badge>}
        {status === "copied" && <Badge variant="success">Copied</Badge>}
        {status === "failed" && <Badge variant="destructive">Apply failed</Badge>}
        {stale && <Badge variant="warning">Resume changed</Badge>}
        {s.match === "fuzzy" && !stale && (
          <Badge title="The original matched your resume only after ignoring line breaks and indentation.">Whitespace match</Badge>
        )}
      </div>

      {s.reason && <p className="text-sm text-muted-foreground">{s.reason}</p>}

      {s.keywords_covered.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Keywords covered">
          {s.keywords_covered.map((k) => (
            <li key={k}>
              <Badge variant="success">{k}</Badge>
            </li>
          ))}
        </ul>
      )}

      <DiffView original={s.original} replacement={s.replacement} />

      {stale && (
        <p role="alert" className="text-sm text-warning">
          This text no longer matches your base resume, so it can't be applied. You can still copy the replacement, or analyse again.
        </p>
      )}
      {status === "failed" && state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error} Use “Copy replacement” and paste it in Overleaf instead.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={onApply}
          disabled={!canApply || stale || status === "applied"}
          title={canApply ? undefined : "Open your Overleaf project in a tab to apply. Copy always works."}
        >
          <SquarePen /> Apply to Overleaf
        </Button>
        <Button size="sm" variant="secondary" onClick={onCopy}>
          {status === "copied" ? <Check /> : <Copy />} Copy replacement
        </Button>
        <Button size="sm" variant="ghost" onClick={onSkip}>
          <X /> Skip
        </Button>
      </div>
    </Card>
  );
}
