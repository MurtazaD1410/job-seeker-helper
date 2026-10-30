const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };

// Trailing legal forms are noise in a file name: "admeritia GmbH" -> "admeritia".
const LEGAL_FORM = /[\s,]+(?:gmbh|mbh|ag|se|kg|ug|e\.?\s?v\.?|inc\.?|ltd\.?|llc|corp\.?|co\.?|&)\s*$/i;

/** ASCII-only, underscore-separated, safe in any file system. */
export function slug(value: string, max = 40): string {
  return value
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max)
    .replace(/_+$/, "");
}

export function companySlug(company: string): string {
  let c = company.trim();
  for (let prev = ""; prev !== c; ) {
    prev = c;
    c = c.replace(LEGAL_FORM, "");
  }
  return slug(c);
}

/**
 * Fills {company} and {role} in a file name template and adds the extension.
 * "Murtaza_Dhariwala_Lebenslauf_{company}" + "admeritia GmbH" -> "Murtaza_Dhariwala_Lebenslauf_admeritia.tex"
 */
export function buildFileName(template: string, job: { company: string; role: string }, ext: string): string {
  const values: Record<string, string> = {
    company: companySlug(job.company) || "Company",
    role: slug(job.role) || "Role"
  };
  const base = template
    .replace(/\{(company|role)\}/gi, (_m, key: string) => values[key.toLowerCase()])
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${base || "document"}.${ext}`;
}
