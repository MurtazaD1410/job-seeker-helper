import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { downloadText } from "@/lib/download";
import { DiffView } from "./DiffView";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

interface Props {
  title: string;
  fileName: string;
  latex: string;
  /** What the diff is shown against (your master). */
  original: string;
  /** e.g. "3 of 4 suggestions included". */
  summary: string;
  issues: string[];
  disabled?: boolean;
  /** Extra buttons shown next to Download/Copy (e.g. Build PDF). */
  children?: React.ReactNode;
}

export function ExportCard({ title, fileName, latex, original, summary, issues, disabled, children }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [showDiff, setShowDiff] = useState(false);

  async function copy() {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(latex);
      setCopied(true);
    } catch {
      setCopyError("Couldn't access the clipboard. Use Download instead.");
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{summary}</div>
        <div className="mt-1 break-all font-mono text-xs">{fileName}</div>
      </div>

      {issues.length > 0 && (
        <ul role="alert" className="flex list-disc flex-col gap-1 pl-5 text-xs text-warning">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => downloadText(fileName, latex)} disabled={disabled}>
          <Download /> Download .tex
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void copy()} disabled={disabled}>
          {copied ? <Check /> : <Copy />} Copy full LaTeX
        </Button>
        {children}
      </div>
      {copyError && (
        <p role="alert" className="text-xs text-destructive">
          {copyError}
        </p>
      )}

      <details onToggle={(e) => setShowDiff(e.currentTarget.open)} className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Show all changes vs. your master</summary>
        {showDiff && (
          <div className="mt-2">
            <DiffView original={original} replacement={latex} />
          </div>
        )}
      </details>
    </Card>
  );
}
