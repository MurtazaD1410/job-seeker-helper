function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="text-sm font-semibold text-foreground">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function ScoreCard({ before, after }: { before: number; after: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-4">
      <Bar label="Match now" value={before} tone="bg-muted-foreground" />
      <Bar label="Estimated after edits" value={after} tone="bg-primary" />
    </div>
  );
}
