import { useMemo } from "react";
import { diffSnippet } from "@/lib/latex";

const BLOCK = "whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed";

// Two stacked blocks, original and replacement, with changed words highlighted in each.
export function DiffView({ original, replacement }: { original: string; replacement: string }) {
  const parts = useMemo(() => diffSnippet(original, replacement), [original, replacement]);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Original</div>
        <pre className={BLOCK}>
          {parts
            .filter((p) => !p.added)
            .map((p, i) =>
              p.removed ? (
                <del key={i} className="rounded-sm bg-destructive/20 text-destructive no-underline">
                  {p.value}
                </del>
              ) : (
                <span key={i}>{p.value}</span>
              )
            )}
        </pre>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Replacement</div>
        <pre className={BLOCK}>
          {parts
            .filter((p) => !p.removed)
            .map((p, i) =>
              p.added ? (
                <ins key={i} className="rounded-sm bg-success/20 text-success no-underline">
                  {p.value}
                </ins>
              ) : (
                <span key={i}>{p.value}</span>
              )
            )}
        </pre>
      </div>
    </div>
  );
}
