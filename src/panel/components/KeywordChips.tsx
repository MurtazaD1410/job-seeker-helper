import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { hasFact } from "@/lib/facts";
import type { Keyword, Status } from "@/lib/schema";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const VARIANT = { present: "success", missing_but_supported: "warning", missing_not_supported: "destructive" } as const;
const LABEL: Record<Status, string> = {
  present: "In your resume",
  missing_but_supported: "Missing, but you can honestly add it",
  missing_not_supported: "Not supported by your resume (click if you have used it)"
};

interface Props {
  keywords: Keyword[];
  extraFacts: string;
  /** Adds "Experience with <term>" to the user's extra facts. */
  onAddFact: (term: string, detail: string) => Promise<void>;
}

export function KeywordChips({ keywords, extraFacts, onAddFact }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = keywords.find((k) => k.term === open);

  function toggle(k: Keyword) {
    setOpen((cur) => (cur === k.term ? null : k.term));
    setDetail("");
    setError("");
  }

  async function add(k: Keyword) {
    setBusy(true);
    setError("");
    try {
      await onAddFact(k.term, detail);
      setOpen(null);
      setDetail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const group = (title: string, list: Keyword[]) =>
    list.length === 0 ? null : (
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        <ul className="flex flex-wrap gap-1.5">
          {list.map((k) => {
            const added = k.status !== "present" && hasFact(extraFacts, k.term);
            const inner = (
              <>
                {added ? <Check className="mr-1 size-3" /> : k.status !== "present" ? <Plus className="mr-1 size-3 opacity-70" /> : null}
                {k.term}
                <span className="sr-only"> ({LABEL[k.status]})</span>
              </>
            );
            return (
              <li key={k.term}>
                {k.status === "present" ? (
                  <Badge variant="success" title={`${k.category} · ${LABEL[k.status]}`}>
                    {inner}
                  </Badge>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggle(k)}
                    aria-expanded={open === k.term}
                    title={added ? "Added to your facts" : `${k.category} · ${LABEL[k.status]}`}
                    className="cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Badge variant={VARIANT[k.status]}>{inner}</Badge>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      {group("Must-have", keywords.filter((k) => k.importance === "must-have"))}
      {group("Nice-to-have", keywords.filter((k) => k.importance === "nice-to-have"))}

      {selected && (
        <div role="group" aria-label={`Add ${selected.term} as a skill`} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          {hasFact(extraFacts, selected.term) ? (
            <p className="text-sm">
              <b>{selected.term}</b> is already in your extra facts. Re-analyse to get a suggestion for it.
            </p>
          ) : (
            <>
              <p className="text-sm">
                <b>{selected.term}</b>{" "}
                {selected.status === "missing_not_supported"
                  ? "isn't backed by your resume. Have you actually worked with it?"
                  : "could be added more clearly. Want to confirm it as a skill?"}{" "}
                If so, it goes into your extra facts, and the next analysis can add it to your skills or a bullet.
              </p>
              <Input
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="Optional detail, e.g. used Redux Toolkit in a course project"
                aria-label="Optional detail"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void add(selected)} disabled={busy}>
                  Yes, I've used it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Only add what you could honestly talk about in an interview.</p>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-success" />In resume</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-warning" />Can add honestly</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-destructive" />No evidence</span>
      </div>
    </div>
  );
}
