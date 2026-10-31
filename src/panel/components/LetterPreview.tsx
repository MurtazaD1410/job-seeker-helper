import { useLayoutEffect, useMemo, useRef } from "react";
import { applyLineEdit, parseLetter } from "@/lib/letterPreview";

// A textarea that grows with its text and looks like part of the page until you focus it.
function Line({ text, onCommit }: { text: string; onCommit: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [text]);
  return (
    <textarea
      ref={ref}
      defaultValue={text}
      rows={1}
      spellCheck
      onInput={fit}
      onBlur={(e) => e.target.value !== text && onCommit(e.target.value)}
      className="block w-full resize-none overflow-hidden rounded border border-transparent bg-transparent px-1 py-0.5 text-sm leading-relaxed text-foreground hover:border-border focus:border-ring focus:outline-none"
    />
  );
}

/**
 * The letter as plain text. Prose lines can be edited in place; the change is written back into the LaTeX
 * when you leave the field. Layout lines (header, spacing, date) are shown dimmed and can't be edited here.
 */
export function LetterPreview({ latex, onChange }: { latex: string; onChange: (latex: string) => void }) {
  const lines = useMemo(() => parseLetter(latex), [latex]);

  if (!lines.length) {
    return <p className="text-sm text-muted-foreground">Nothing to preview: the letter has no document body. Use the LaTeX view.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-card p-4 shadow-sm" aria-label="Letter preview">
        {lines.map((l, i) =>
          l.kind === "gap" ? (
            <div key={`g${i}`} className="h-3" aria-hidden />
          ) : l.kind === "fixed" ? (
            <p key={l.index} className="px-1 py-0.5 text-sm leading-relaxed text-muted-foreground" title="Part of the layout. Edit it in the LaTeX view.">
              {l.text}
            </p>
          ) : (
            <Line key={`${l.index}:${l.text}`} text={l.text} onCommit={(value) => onChange(applyLineEdit(latex, l.index, value))} />
          )
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Click a paragraph to edit it. Your change is saved into the LaTeX when you click away. Use **bold** and *italic* for emphasis. Dimmed lines are layout:
        change those in the LaTeX view.
      </p>
    </div>
  );
}
