import { useState } from "react";
import { Check, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import type { OverleafApi } from "../hooks/useOverleaf";
import { Button } from "./ui/button";

// Which Overleaf tab Apply/Pull will use, and whether its editor can be reached.
export function OverleafTarget({ overleaf }: { overleaf: OverleafApi }) {
  const { tabs, targetId, setTargetId, status, recheck } = overleaf;
  const [details, setDetails] = useState(false);

  if (tabs.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        No Overleaf project is open, so Apply and Pull are off. Open your project in a tab, or use Copy and Download, which always work.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-medium">Overleaf (default tab)</span>
        {tabs.length > 1 ? (
          <select
            aria-label="Overleaf tab to use"
            value={targetId ?? ""}
            onChange={(e) => setTargetId(Number(e.target.value))}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          >
            {tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{tabs[0].title}</span>
        )}
        <Button size="icon" variant="ghost" onClick={recheck} aria-label="Check the Overleaf connection again" title="Check again">
          <RefreshCw className={status.state === "checking" ? "animate-spin" : ""} />
        </Button>
      </div>

      {status.state === "checking" && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Checking the editor…
        </p>
      )}
      {status.state === "error" && (
        <p role="alert" className="flex items-start gap-1.5 text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{status.message} Copy still works.</span>
        </p>
      )}
      {status.state === "ready" && (
        <>
          <p className={`flex items-center gap-1.5 ${status.info.readOnly ? "text-warning" : "text-success"}`}>
            <Check className="size-3.5" />
            {status.info.readOnly ? "Editor found, but it is read-only." : "Editor connected."}{" "}
            <span className="text-muted-foreground">
              {status.info.fileHint ? `${status.info.fileHint} · ` : ""}
              {status.info.docLength.toLocaleString()} characters in the open file
            </span>
          </p>
          <button type="button" onClick={() => setDetails((d) => !d)} className="w-fit cursor-pointer text-left text-muted-foreground underline">
            {details ? "Hide" : "Show"} diagnostics
          </button>
          {details && (
            <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-[11px]">
              {JSON.stringify(status.info, null, 2)}
            </pre>
          )}
        </>
      )}
      <p className="text-muted-foreground">
        Used for documents with no project chosen in Settings. Each document can have its own project and file. Ctrl+Z in Overleaf undoes an Apply.
      </p>
    </div>
  );
}
