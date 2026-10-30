// "Extra facts" lines that the user adds from a keyword chip ("I have used this"), one per skill.

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function factLine(term: string, detail = ""): string {
  const d = clean(detail);
  return `Experience with ${clean(term)}${d ? `: ${d.replace(/[.\s]+$/, "")}` : ""}.`;
}

/** Whether `facts` already contains a line added for this term (case-insensitive). */
export function hasFact(facts: string, term: string): boolean {
  const prefix = `experience with ${clean(term).toLowerCase()}`;
  return facts.split("\n").some((line) => {
    const l = line.trim().toLowerCase();
    if (!l.startsWith(prefix)) return false;
    const rest = l.slice(prefix.length);
    return rest === "" || /^[:.]/.test(rest);
  });
}

/** Appends a fact line for `term` unless one exists already. */
export function addFact(facts: string, term: string, detail = ""): string {
  if (hasFact(facts, term)) return facts;
  const base = facts.replace(/\s+$/, "");
  return `${base ? `${base}\n` : ""}${factLine(term, detail)}`;
}
