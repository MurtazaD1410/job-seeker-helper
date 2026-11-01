import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { clearJobData } from "@/lib/storage";
import { addFact } from "@/lib/facts";
import { useSettings } from "./hooks/useSettings";
import { SettingsTab } from "./tabs/SettingsTab";
import { JobTab } from "./tabs/JobTab";
import { CoverLetterTab } from "./tabs/CoverLetterTab";
import { LinkedInTab } from "./tabs/LinkedInTab";
import { AnswersTab } from "./tabs/AnswersTab";
import { useAnswers } from "./hooks/useAnswers";
import { useOverleaf } from "./hooks/useOverleaf";
import { usePdfBuilder } from "./hooks/usePdfBuilder";
import { PendingRestoreBanner } from "./components/BuildPdf";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Button } from "./components/ui/button";
import { useCoverLetter } from "./hooks/useCoverLetter";
import { useOutreach } from "./hooks/useOutreach";
import { ResumeTab } from "./tabs/ResumeTab";
import { Placeholder } from "./tabs/Placeholder";
import { useAnalysis } from "./hooks/useAnalysis";
import { useSuggestionState } from "./hooks/useSuggestionState";
import { useJobDraft } from "./hooks/useJobDraft";

const TABS = ["Job", "Resume", "Cover Letter", "LinkedIn", "Q&A", "Settings"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const { settings, loaded, save } = useSettings();
  const { job, setJob, reset: resetJob } = useJobDraft();
  const { analysis, status, run, cancel, reset: resetAnalysis } = useAnalysis();
  const cover = useCoverLetter();
  const outreach = useOutreach();
  const answers = useAnswers();
  const overleaf = useOverleaf();
  const builder = usePdfBuilder(overleaf);
  const suggestionState = useSuggestionState(analysis);
  const [tab, setTab] = useState<Tab>("Job");
  const [routed, setRouted] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // Bumped on "New job" so every tab starts fresh (copied flags, notices, open diffs).
  const [clearCount, setClearCount] = useState(0);

  // "New job": after applying, forget the job, analysis, suggestions, cover letter and LinkedIn drafts.
  const hasJobData = !!(job.title || job.company || job.description || analysis || cover.letter || outreach.pack || answers.items.length);
  const working =
    status.state === "running" ||
    cover.status.state === "running" ||
    outreach.status.state === "running" ||
    answers.status.state === "running" ||
    builder.state.phase === "running";
  async function clearAll() {
    setConfirmClear(false);
    resetJob();
    resetAnalysis();
    cover.reset();
    outreach.reset();
    answers.reset();
    builder.clearResult();
    await clearJobData();
    setClearCount((n) => n + 1);
    setTab("Job");
  }

  // First run: land on Settings until an API key is stored.
  useEffect(() => {
    if (loaded && !routed) {
      if (!settings.apiKey) setTab("Settings");
      setRouted(true);
    }
  }, [loaded, routed, settings.apiKey]);

  return (
    <div className="flex min-h-screen flex-col">
      <PendingRestoreBanner builder={builder} />
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="flex items-center justify-between px-4 pt-3">
          <span className="text-sm font-semibold">CV Tailor</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmClear(true)}
            disabled={!hasJobData || working}
            title={working ? "Wait for the running task to finish." : "Clear this job's description, analysis, suggestions, cover letter and LinkedIn drafts"}
          >
            <RotateCcw /> New job
          </Button>
        </div>
        <nav className="flex overflow-x-auto px-2" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      <main key={clearCount} className="flex-1 p-4">
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tab === "Settings" ? (
          <SettingsTab settings={settings} onSave={save} overleaf={overleaf} />
        ) : tab === "Job" ? (
          <JobTab
            job={job}
            setJob={setJob}
            settings={settings}
            analysis={analysis}
            status={status}
            onAnalyse={() => void run(settings, job)}
            onCancel={cancel}
            onAddFact={async (term, detail) => save({ ...settings, extraFacts: addFact(settings.extraFacts, term, detail) })}
            goSettings={() => setTab("Settings")}
            goResume={() => setTab("Resume")}
          />
        ) : tab === "Resume" ? (
          <ResumeTab
            analysis={analysis}
            settings={settings}
            states={suggestionState.items}
            overleaf={overleaf}
            builder={builder}
            setState={suggestionState.set}
            goJob={() => setTab("Job")}
          />
        ) : tab === "Cover Letter" ? (
          <CoverLetterTab
            settings={settings}
            job={job}
            analysis={analysis}
            letter={cover.letter}
            prefs={cover.prefs}
            setPrefs={cover.setPrefs}
            status={cover.status}
            overleaf={overleaf}
            builder={builder}
            onEdit={cover.edit}
            onGenerate={() => void cover.run(settings, job, analysis)}
            onCancel={cover.cancel}
            goSettings={() => setTab("Settings")}
            goJob={() => setTab("Job")}
          />
        ) : tab === "LinkedIn" ? (
          <LinkedInTab
            settings={settings}
            job={job}
            analysis={analysis}
            pack={outreach.pack}
            prefs={cover.prefs}
            setPrefs={cover.setPrefs}
            status={outreach.status}
            onGenerate={(recipient) => void outreach.run(settings, job, analysis, cover.prefs, recipient)}
            onEdit={outreach.edit}
            onCancel={outreach.cancel}
            goSettings={() => setTab("Settings")}
            goJob={() => setTab("Job")}
          />
        ) : tab === "Q&A" ? (
          <AnswersTab
            settings={settings}
            job={job}
            items={answers.items}
            prefs={answers.prefs}
            setPrefs={answers.setPrefs}
            status={answers.status}
            onAsk={(question) => answers.run(settings, job, analysis, question)}
            onEdit={answers.edit}
            onRemove={answers.remove}
            onCancel={answers.cancel}
            goSettings={() => setTab("Settings")}
          />
        ) : (
          <Placeholder name={tab} needsSetup={!settings.apiKey || !settings.baseResume} goSettings={() => setTab("Settings")} />
        )}
      </main>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this job?"
        confirmLabel="Clear"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void clearAll()}
      >
        <p>This clears the job description, the analysis, your suggestion progress, the cover letter draft, the LinkedIn messages and the Q&A answers.</p>
        <p>Kept: your settings, master resume and cover letter, and any skills you added to your extra facts. Files you already downloaded are not affected.</p>
      </ConfirmDialog>
    </div>
  );
}
