import { useEffect, useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";
import { listModels } from "@/lib/gemini";
import { DEFAULT_MODEL, type Settings } from "@/lib/storage";
import type { OverleafApi } from "../hooks/useOverleaf";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { OverleafTarget } from "../components/OverleafTarget";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

interface Props {
  settings: Settings;
  onSave: (s: Settings) => Promise<void>;
  overleaf: OverleafApi;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

type PullField = "baseResume" | "baseResumeEn" | "baseCoverLetter";

const FIELD_LABEL: Record<PullField, string> = { baseResume: "German resume", baseResumeEn: "English resume", baseCoverLetter: "cover letter" };
const PROJECT_KEY = { baseResume: "resumeOverleafProject", baseResumeEn: "resumeOverleafProjectEn", baseCoverLetter: "coverOverleafProject" } as const;
const FILE_KEY = { baseResume: "resumeOverleafFile", baseResumeEn: "resumeOverleafFileEn", baseCoverLetter: "coverOverleafFile" } as const;

const PICK = "h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs";

// Where a document lives in Overleaf: which project (tab) and which file in it. Empty = use the default.
function DocPicker({
  label,
  project,
  file,
  overleaf,
  onProject,
  onFile
}: {
  label: string;
  project: string;
  file: string;
  overleaf: OverleafApi;
  onProject: (v: string) => void;
  onFile: (v: string) => void;
}) {
  const projectIds = overleaf.tabs.map((t) => t.projectId).filter(Boolean);
  const files = overleaf.filesFor(project);
  const fileOptions = file && !files.includes(file) ? [file, ...files] : files;
  const titleOf = (t: { title: string; projectId: string }) =>
    overleaf.tabs.filter((x) => x.title === t.title).length > 1 ? `${t.title} (${t.projectId.slice(-4)})` : t.title;

  return (
    <div className="flex flex-col gap-1.5">
      <select aria-label={`${label}: Overleaf project`} className={PICK} value={project} onChange={(e) => onProject(e.target.value)}>
        <option value="">{label}: the tab selected above</option>
        {project && !projectIds.includes(project) && <option value={project}>Project …{project.slice(-4)} (not open)</option>}
        {overleaf.tabs.map((t) => (
          <option key={t.id} value={t.projectId}>
            {titleOf(t)}
          </option>
        ))}
      </select>
      {files.length === 0 ? (
        <Input aria-label={`${label}: file name`} className="h-8 text-xs" spellCheck={false} placeholder="File name, e.g. main.tex (empty = the open file)" value={file} onChange={(e) => onFile(e.target.value)} />
      ) : (
        <select aria-label={`${label}: file`} className={PICK} value={file} onChange={(e) => onFile(e.target.value)}>
          <option value="">the open file</option>
          {fileOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function SettingsTab({ settings, onSave, overleaf }: Props) {
  const [pulling, setPulling] = useState<PullField | null>(null);
  const [pullNote, setPullNote] = useState<{ field: PullField; kind: "ok" | "error"; text: string } | null>(null);
  const [pendingPull, setPendingPull] = useState<{ field: PullField; text: string } | null>(null);
  const [draft, setDraft] = useState<Settings>(settings);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");

  async function loadModels() {
    setLoadingModels(true);
    setModelsError("");
    try {
      const ids = await listModels(draft.apiKey.trim());
      setModels(ids);
      if (!ids.length) setModelsError("No text models are available for this key.");
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModels(false);
    }
  }

  // Pick up external changes, but only while there are no unsaved edits.
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  useEffect(() => {
    setDraft((d) => (JSON.stringify(d) === JSON.stringify(settings) ? d : status === "saving" ? d : settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setStatus("idle");
  };

  // Fills the draft from the file open in Overleaf; nothing is saved until "Save settings".
  async function pull(field: PullField) {
    setPulling(field);
    setPullNote(null);
    const r = await overleaf.callFor({ project: draft[projectKey(field)], file: draft[fileKey(field)] }, { op: "read" });
    setPulling(null);
    const squash = (t: string) => t.replace(/\s+/g, " ").trim();
    // A resume must not be a copy of another master text, or the wrong Overleaf file is open.
    const others = (["baseResume", "baseResumeEn", "baseCoverLetter"] as const).filter((f) => f !== field && draft[f].trim());
    const clash = others.find((f) => squash(r.ok && r.op === "read" ? r.text : "") === squash(draft[f]));
    if (!r.ok || r.op !== "read") {
      setPullNote({ field, kind: "error", text: r.ok ? "Unexpected reply from Overleaf." : r.error });
    } else if (clash) {
      setPullNote({
        field,
        kind: "error",
        text: `That is identical to your ${FIELD_LABEL[clash]}, so the wrong Overleaf file is probably open. Set the file names above, or open the right file first.`
      });
    } else if (draft[field].trim() && draft[field] !== r.text) {
      setPendingPull({ field, text: r.text });
    } else {
      finishPull(field, r.text);
    }
  }

  function finishPull(field: PullField, text: string) {
    set(field, text);
    setPendingPull(null);
    setPullNote({ field, kind: "ok", text: `Read ${text.length.toLocaleString()} characters from the open Overleaf file. Click "Save settings" to keep it.` });
  }

  const projectKey = (field: PullField) => PROJECT_KEY[field];
  const fileKey = (field: PullField) => FILE_KEY[field];

  const pullControls = (field: PullField) => (
    <div className="flex flex-col gap-1.5">
      <DocPicker
        label={field === "baseCoverLetter" ? "Cover letter" : field === "baseResumeEn" ? "English resume" : "German resume"}
        project={draft[projectKey(field)]}
        file={draft[fileKey(field)]}
        overleaf={overleaf}
        // A different project has different files, so the file choice starts over.
        onProject={(v) => {
          set(projectKey(field), v);
          set(fileKey(field), "");
        }}
        onFile={(v) => set(fileKey(field), v)}
      />
      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!overleaf.tabFor(draft[projectKey(field)]) || pulling !== null}
          onClick={() => void pull(field)}
          title={!overleaf.tabFor(draft[projectKey(field)]) ? "That Overleaf project isn't open in a tab." : undefined}
        >
          {pulling === field ? <Loader2 className="animate-spin" /> : <Download />} Pull from Overleaf
        </Button>
      </div>
      {pullNote?.field === field && (
        <span role={pullNote.kind === "error" ? "alert" : "status"} className={`text-xs ${pullNote.kind === "error" ? "text-destructive" : "text-success"}`}>
          {pullNote.text}
        </span>
      )}
    </div>
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    try {
      await onSave(draft);
      setStatus("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <OverleafTarget overleaf={overleaf} />

      <Field label="Gemini API key" hint="Stored only in this browser (chrome.storage.local). Get one at aistudio.google.com.">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="AIza…"
          value={draft.apiKey}
          onChange={(e) => set("apiKey", e.target.value)}
        />
      </Field>

      <Field label="Model" hint={`Any Gemini model ID. Default: ${DEFAULT_MODEL}`}>
        <Input
          spellCheck={false}
          placeholder={DEFAULT_MODEL}
          value={draft.model}
          onChange={(e) => set("model", e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void loadModels()} disabled={!draft.apiKey.trim() || loadingModels}>
            {loadingModels && <Loader2 className="animate-spin" />}
            Show available models
          </Button>
          {models.length > 0 && (
            <select
              aria-label="Available models"
              value={models.includes(draft.model) ? draft.model : ""}
              onChange={(e) => e.target.value && set("model", e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Pick one of {models.length}…</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </div>
        {modelsError && (
          <span role="alert" className="text-xs text-destructive">
            {modelsError}
          </span>
        )}
      </Field>

      <Field label="Base resume, German (LaTeX)" hint="Used for German job postings, and for English ones while no English resume is set.">
        <Textarea
          rows={12}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder="\documentclass{article} …"
          value={draft.baseResume}
          onChange={(e) => set("baseResume", e.target.value)}
        />
      </Field>
      {pullControls("baseResume")}

      <Field label="Base resume, English (LaTeX, optional)" hint="Used for English job postings. Leave empty to always use the German resume.">
        <Textarea
          rows={12}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder="\documentclass{article} …"
          value={draft.baseResumeEn}
          onChange={(e) => set("baseResumeEn", e.target.value)}
        />
      </Field>
      {pullControls("baseResumeEn")}

      <Field label="Base cover letter (LaTeX)">
        <Textarea
          rows={10}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder="\documentclass{letter} …"
          value={draft.baseCoverLetter}
          onChange={(e) => set("baseCoverLetter", e.target.value)}
        />
      </Field>
      {pullControls("baseCoverLetter")}

      <Field
        label="Extra facts about me (optional)"
        hint="Skills or experience you can honestly claim that aren't on your resume yet. The model may treat these as supported."
      >
        <Textarea
          rows={4}
          value={draft.extraFacts}
          onChange={(e) => set("extraFacts", e.target.value)}
        />
      </Field>

      <Field
        label="Willingness to learn (optional)"
        hint="Kept separate from the facts above on purpose: it shows your attitude, but never counts as experience with a skill. It's only used to phrase eagerness to learn."
      >
        <Textarea rows={3} value={draft.learningNote} onChange={(e) => set("learningNote", e.target.value)} />
      </Field>

      <div className="grid grid-cols-1 gap-4">
        <Field
          label="Resume file name"
          hint="Use {company} and {role}. The extension adds .tex. Example: Murtaza_Dhariwala_Lebenslauf_admeritia.tex"
        >
          <Input spellCheck={false} value={draft.resumeFileName} onChange={(e) => set("resumeFileName", e.target.value)} />
        </Field>
        <Field label="English resume file name" hint="Same placeholders. Used when the English resume is chosen.">
          <Input spellCheck={false} value={draft.resumeFileNameEn} onChange={(e) => set("resumeFileNameEn", e.target.value)} />
        </Field>
        <Field label="Cover letter file name" hint="Same placeholders. Legal forms like GmbH are dropped from {company}.">
          <Input spellCheck={false} value={draft.coverFileName} onChange={(e) => set("coverFileName", e.target.value)} />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--primary)]"
          checked={draft.redactContact}
          onChange={(e) => set("redactContact", e.target.checked)}
        />
        <span>
          Strip email, phone and address before sending to Gemini
          <span className="block text-xs text-muted-foreground">Simple pattern-based redaction; check your text if it matters.</span>
        </span>
      </label>

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-border bg-background px-4 py-3">
        <Button type="submit" disabled={!dirty || status === "saving"}>
          {status === "saving" ? "Saving…" : "Save settings"}
        </Button>
        {status === "saved" && !dirty && (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check className="size-4" /> Saved
          </span>
        )}
        {status === "error" && <span className="text-sm text-destructive">Couldn't save: {error}</span>}
        {dirty && status !== "saving" && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
      </div>
      <ConfirmDialog
        open={pendingPull !== null}
        title="Replace your master text?"
        confirmLabel="Replace"
        onCancel={() => setPendingPull(null)}
        onConfirm={() => pendingPull && finishPull(pendingPull.field, pendingPull.text)}
      >
        <p>
          The {pendingPull ? FIELD_LABEL[pendingPull.field] : "master text"} field already has different text. Replace it with the file open in
          Overleaf? Nothing is saved until you click "Save settings".
        </p>
      </ConfirmDialog>
    </form>
  );
}
