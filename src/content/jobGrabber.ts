export type GrabSource = "selection" | "site" | "structured-data" | "fallback" | "none";

export interface GrabResult {
  text: string;
  title: string;
  company: string;
  source: GrabSource;
}

/**
 * Extracts the job description from the current page. Injected into the tab with
 * chrome.scripting.executeScript({ func }), which serialises the function, so it must stay
 * self-contained: no imports or references to anything outside its own body.
 *
 * Order: text selection -> known site selectors -> schema.org JobPosting JSON-LD -> largest
 * text block inside main/article.
 */
export function extractJobFromPage(): GrabResult {
  const MIN_LEN = 200;
  const MAX_LEN = 20000;
  const host = location.hostname.toLowerCase();

  const clean = (s: string) =>
    s
      .replace(/\r/g, "")
      .replace(/[ \t ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  const textOf = (el: Element | null): string => (el ? clean((el as HTMLElement).innerText ?? el.textContent ?? "") : "");
  const firstText = (selectors: string[]): string => {
    for (const sel of selectors) {
      try {
        const t = textOf(document.querySelector(sel));
        if (t) return t;
      } catch {
        // invalid selector for this engine: skip
      }
    }
    return "";
  };
  const meta = (name: string): string =>
    clean(
      document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content") ?? ""
    );

  // Selectors are best effort and will drift as the sites change.
  const sites: { name: string; host: RegExp; description: string[]; all?: boolean; title: string[]; company: string[] }[] = [
    {
      name: "linkedin",
      host: /(^|\.)linkedin\.com$/,
      description: [
        ".jobs-description__content",
        ".jobs-box__html-content",
        "#job-details",
        ".show-more-less-html__markup",
        ".description__text"
      ],
      title: [
        ".job-details-jobs-unified-top-card__job-title",
        ".jobs-unified-top-card__job-title",
        ".top-card-layout__title",
        "h1"
      ],
      company: [
        ".job-details-jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name",
        ".topcard__org-name-link",
        ".top-card-layout__card a[href*='/company/']"
      ]
    },
    {
      name: "stepstone",
      host: /(^|\.)stepstone\.[a-z.]+$/,
      description: [
        "[data-at='job-ad-content']",
        "[data-testid='job-description']",
        "[data-genesis-element='JOB_AD_CONTENT']",
        ".listing-content"
      ],
      title: ["[data-at='header-job-title']", "h1"],
      company: ["[data-at='metadata-company-name']", "[data-at='header-company-name']"]
    },
    {
      name: "indeed",
      host: /(^|\.)indeed\.[a-z.]+$/,
      description: ["#jobDescriptionText", ".jobsearch-JobComponent-description", ".jobsearch-jobDescriptionText"],
      title: [".jobsearch-JobInfoHeader-title", "[data-testid='jobsearch-JobInfoHeader-title']", "h1"],
      company: ["[data-testid='inlineHeader-companyName']", "[data-company-name='true']"]
    },
    {
      name: "xing",
      host: /(^|\.)xing\.com$/,
      description: ["[data-testid='job-posting-description']", "[data-testid='job-description']", "[class*='description']"],
      title: ["[data-testid='job-posting-title']", "h1"],
      company: ["[data-testid='company-name']", "[data-testid='job-posting-company-name']"]
    },
    {
      name: "greenhouse",
      host: /(^|\.)greenhouse\.io$/,
      description: [".job__description", "#content", "#app_body"],
      title: [".app-title", ".job__title h1", "h1"],
      company: [".company-name"]
    },
    {
      name: "lever",
      host: /(^|\.)lever\.co$/,
      description: ["[data-qa='job-description']", ".posting-page .content", ".section-wrapper.page-full-width"],
      title: [".posting-headline h2", "h2"],
      company: []
    },
    {
      name: "workday",
      host: /(^|\.)myworkdayjobs\.com$/,
      description: ["[data-automation-id='jobPostingDescription']"],
      title: ["[data-automation-id='jobPostingHeader']", "h2"],
      company: []
    },
    {
      name: "personio",
      host: /(^|\.)personio\.(de|com)$/,
      // Current Personio pages split the posting into several .detail-content-block sections.
      description: [".detail-content-block", "[data-qa='job-description']", ".job-description"],
      all: true,
      title: [".job-position-title", "h1"],
      company: []
    }
  ];
  const site = sites.find((s) => s.host.test(host));

  // schema.org JobPosting (most career pages publish one for Google Jobs).
  const htmlToText = (html: string): string => {
    const spaced = html.replace(/<li[^>]*>/gi, "\n- ").replace(/<\/(p|div|h[1-6]|ul|ol|li)>|<br\s*\/?>/gi, "\n");
    // DOMParser yields an inert document: nothing in the markup runs or loads.
    return clean(new DOMParser().parseFromString(spaced, "text/html").body.textContent ?? "");
  };
  const findJobPosting = (): { description: string; title: string; company: string } | null => {
    const stack: unknown[] = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        stack.push(JSON.parse(s.textContent ?? ""));
      } catch {
        // malformed JSON-LD: ignore
      }
    });
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      if (!node || typeof node !== "object") continue;
      const o = node as Record<string, unknown>;
      if (Array.isArray(o["@graph"])) stack.push(...(o["@graph"] as unknown[]));
      const type = o["@type"];
      const isJob = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
      if (!isJob) continue;
      const org = o.hiringOrganization;
      const orgName = typeof org === "string" ? org : ((org as Record<string, unknown> | undefined)?.name as string | undefined);
      return {
        description: typeof o.description === "string" ? htmlToText(o.description) : "",
        title: typeof o.title === "string" ? clean(o.title) : "",
        company: typeof orgName === "string" ? clean(orgName) : ""
      };
    }
    return null;
  };
  const posting = findJobPosting();

  // Title and company: site selectors -> JSON-LD -> page metadata. Always best effort.
  const docTitle = clean(document.title);
  let title = (site && firstText(site.title)) || posting?.title || "";
  let company = (site && firstText(site.company)) || posting?.company || "";
  if (!title || !company) {
    const gh = docTitle.match(/^Job Application for (.+) at (.+)$/i);
    if (gh) {
      title = title || gh[1];
      company = company || gh[2];
    } else if (site?.name === "personio") {
      // "Title | Jobs bei Company" (also "Jobs at", "Karriere bei", "Careers at")
      const pt = docTitle.match(/^(.+?)\s*\|\s*(?:Jobs|Karriere|Careers)\s+(?:bei|at)\s+(.+)$/i);
      if (pt) {
        title = title || pt[1];
        company = company || pt[2];
      }
    } else if (site?.name === "lever" && docTitle.includes(" - ")) {
      const [c, ...rest] = docTitle.split(" - ");
      company = company || c;
      title = title || rest.join(" - ");
    }
  }
  if (!company) company = meta("og:site_name");
  if (!title) title = textOf(document.querySelector("h1")) || meta("og:title");
  title = title.slice(0, 200);
  company = company.slice(0, 200);

  const done = (text: string, source: GrabSource): GrabResult => ({
    text: text.length > MAX_LEN ? text.slice(0, MAX_LEN) : text,
    title,
    company,
    source
  });

  // 1. Text selection
  const selection = clean(window.getSelection()?.toString() ?? "");
  if (selection.length >= 30) return done(selection, "selection");

  // 2. Known site selectors, then structured data
  const allText = (selectors: string[]): string => {
    for (const sel of selectors) {
      try {
        const parts = Array.from(document.querySelectorAll(sel)).map(textOf).filter(Boolean);
        if (parts.length) return parts.join("\n\n");
      } catch {
        // invalid selector: skip
      }
    }
    return "";
  };
  const siteText = site ? (site.all ? allText(site.description) : firstText(site.description)) : "";
  if (siteText.length >= MIN_LEN) return done(siteText, "site");
  if (posting && posting.description.length >= MIN_LEN) return done(posting.description, "structured-data");

  // 3. Largest text block inside main / article, discounting link-heavy blocks (menus, lists)
  const root = document.querySelector("main, [role='main']") ?? document.querySelector("article") ?? document.body;
  let best: Element = root;
  let bestScore = -Infinity;
  const candidates = [root, ...Array.from(root.querySelectorAll("article, section, div")).slice(0, 2000)];
  for (const el of candidates) {
    if (el !== root && el.closest("nav, header, footer, aside, form")) continue;
    const len = (el.textContent ?? "").length;
    let linkLen = 0;
    el.querySelectorAll("a").forEach((a) => (linkLen += (a.textContent ?? "").length));
    const score = len - 2 * linkLen;
    if (score >= bestScore) {
      best = el;
      bestScore = score;
    }
  }
  const blockText = textOf(best);
  if (blockText.length >= MIN_LEN) return done(blockText, "fallback");

  return done("", "none");
}
