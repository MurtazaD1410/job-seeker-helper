import { Button } from "../components/ui/button";

// Stand-in until the tab is built in a later milestone.
export function Placeholder({ name, needsSetup, goSettings }: { name: string; needsSetup: boolean; goSettings: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
      <p>The {name} tab is coming in a later milestone.</p>
      {needsSetup && (
        <>
          <p>Add your Gemini API key and base resume first.</p>
          <Button size="sm" variant="secondary" onClick={goSettings}>
            Open Settings
          </Button>
        </>
      )}
    </div>
  );
}
