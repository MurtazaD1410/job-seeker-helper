// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { extractJobFromPage, type GrabResult } from "@/content/jobGrabber";
import { jobSiteOriginFor, pickBest } from "@/lib/grabJob";

// jsdom has no innerText; approximate it with textContent.
Object.defineProperty(HTMLElement.prototype, "innerText", {
  configurable: true,
  get() {
    return this.textContent;
  }
});

// Chrome serialises the function and runs it detached from this module, so do the same here:
// any reference to an outer-scope helper would throw a ReferenceError.
const run = (): GrabResult => new Function(`return (${extractJobFromPage.toString()})()`)();

const LONG = "We are looking for an engineer who loves TypeScript and distributed systems. ".repeat(6);

function setPage(html: string, url = "https://example.com/job", title = "") {
  // vitest exposes the JSDOM instance, which lets us change the page URL (hostname).
  (globalThis as unknown as { jsdom: { reconfigure(o: { url: string }): void } }).jsdom.reconfigure({ url });
  document.title = title;
  document.body.innerHTML = html;
  window.getSelection()?.removeAllRanges();
}

describe("extractJobFromPage", () => {
  beforeEach(() => setPage(""));

  it("runs as a detached, serialised function", () => {
    setPage("<main></main>");
    expect(run().source).toBe("none");
  });

  it("prefers the text selection", () => {
    setPage(`<main><p id="p">${LONG}</p></main>`);
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("p")!);
    window.getSelection()!.addRange(range);
    const r = run();
    expect(r.source).toBe("selection");
    expect(r.text).toContain("TypeScript");
  });

  it("uses known site selectors and detects title/company", () => {
    setPage(
      `<h1 class="top-card-layout__title">Backend Engineer</h1>
       <a class="topcard__org-name-link">Acme GmbH</a>
       <div class="show-more-less-html__markup">${LONG}</div>
       <main>${"unrelated ".repeat(100)}</main>`,
      "https://www.linkedin.com/jobs/view/1"
    );
    const r = run();
    expect(r.source).toBe("site");
    expect(r.title).toBe("Backend Engineer");
    expect(r.company).toBe("Acme GmbH");
    expect(r.text).not.toContain("unrelated");
  });

  it("falls back to schema.org JobPosting JSON-LD, converting HTML to text", () => {
    const ld = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "JobPosting",
          title: "Data Engineer",
          hiringOrganization: { name: "Initech" },
          description: `<p>Intro</p><ul><li>Python &amp; SQL</li><li>${LONG}</li></ul><img src=x onerror="window.__pwned=1">`
        }
      ]
    };
    setPage(`<script type="application/ld+json">${JSON.stringify(ld)}</script><main>short</main>`);
    const r = run();
    expect(r.source).toBe("structured-data");
    expect(r.title).toBe("Data Engineer");
    expect(r.company).toBe("Initech");
    expect(r.text).toContain("- Python & SQL");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("falls back to the largest text block in main, skipping nav links", () => {
    setPage(
      `<main>
         <nav>${'<a href="#">menu item</a>'.repeat(60)}</nav>
         <div id="job"><h1>Designer</h1><p>${LONG}</p></div>
       </main>`
    );
    const r = run();
    expect(r.source).toBe("fallback");
    expect(r.text).toContain("TypeScript");
    expect(r.text).not.toContain("menu item");
    expect(r.title).toBe("Designer");
  });

  it("parses Greenhouse-style document titles", () => {
    setPage(`<main>${LONG}</main>`, "https://boards.greenhouse.io/acme/jobs/1", "Job Application for SRE at Acme");
    const r = run();
    expect(r.title).toBe("SRE");
    expect(r.company).toBe("Acme");
  });

  it("reads Personio pages made of several content blocks, and the company from the title", () => {
    setPage(
      `<main><div class="page_jobContainer detail-wrapper">
         <h1 class="detail-title job-position-title">Studentische Hilfskraft im Software Development</h1>
         <button>Auf diese Stelle bewerben</button>
         <div class="detail-content-block detail-content-block-conditions">
           <div class="jb-description-item"><h2>Deine Aufgaben</h2><ul><li>${LONG}</li></ul></div>
         </div>
         <div class="detail-content-block detail-content-block-about-us"><h2>Über uns</h2><p>Wir sind admeritia.</p></div>
       </div></main>`,
      "https://admeritia.jobs.personio.com/job/2632482",
      "Studentische Hilfskraft im Software Development | Jobs bei admeritia GmbH"
    );
    const r = run();
    expect(r.source).toBe("site");
    expect(r.title).toBe("Studentische Hilfskraft im Software Development");
    expect(r.company).toBe("admeritia GmbH");
    expect(r.text).toContain("Deine Aufgaben");
    expect(r.text).toContain("Über uns");
    expect(r.text).not.toContain("bewerben");
  });

  it("reads the open Workwise job (nested main > article) and not the results list or filters", () => {
    setPage(
      `<main><div class="filters"><button>Weitere Filter</button></div>
         <ul>${"<li><a href='#'>Another job in Berlin</a></li>".repeat(40)}</ul>
         <main class="box"><article><h1>Werkstudent Softwareentwicklung (m/w/d)</h1><p>${LONG}</p><h2>Dein Profil</h2><p>Ende der Anzeige.</p></article></main></main>`,
      "https://www.workwise.io/jobsuche?id=66561"
    );
    const r = run();
    expect(r.source).toBe("site");
    expect(r.title).toBe("Werkstudent Softwareentwicklung (m/w/d)");
    expect(r.company).toBe("");
    expect(r.text).toContain("Ende der Anzeige.");
    expect(r.text).not.toContain("Another job");
    expect(r.text).not.toContain("Weitere Filter");
  });

  it("reads Indeed's current description block and not the results list beside it", () => {
    setPage(
      `<main><ul class="jobsearch-ResultsList">${"<li><a href='#'>Another job in Fulda</a></li>".repeat(60)}</ul>
         <div><h1 class="jobsearch-JobInfoHeader-title">Softwareentwickler (m/w/d)</h1>
         <div class="react-native-html-content simple-job-description-html"><p>${LONG}</p></div></div></main>`,
      "https://de.indeed.com/viewjob?jk=4560a26ed3dce067"
    );
    const r = run();
    expect(r.source).toBe("site");
    expect(r.title).toBe("Softwareentwickler (m/w/d)");
    expect(r.text).toContain("TypeScript");
    expect(r.text).not.toContain("Another job");
  });

  it("reads Indeed's title from the page title and the company from the first line of its info block", () => {
    setPage(
      `<main><div data-testid="company-info-title-row" class="css-g5y9jx">Mit KI in die IT: Dein Neustart als Full Stack Entwickler (m/w/d)</div>
         <div data-testid="company-info-metadata" class="css-g5y9jx">Syntex GmbH
·
4.2
36037 Fulda
Homeoffice</div>
         <div class="react-native-html-content simple-job-description-html"><p>${LONG}</p></div></main>`,
      "https://de.indeed.com/viewjob?jk=4560a26ed3dce067",
      "Mit KI in die IT: Dein Neustart als Full Stack Entwickler (m/w/d) - 36037 Fulda - Indeed.com"
    );
    const r = run();
    expect(r.title).toBe("Mit KI in die IT: Dein Neustart als Full Stack Entwickler (m/w/d)");
    expect(r.company).toBe("Syntex GmbH");
  });

  it("keeps ' - ' inside an Indeed job title", () => {
    setPage(`<main><div class="simple-job-description-html"><p>${LONG}</p></div></main>`, "https://de.indeed.com/viewjob?jk=1", "Frontend - React - Entwickler - Fulda - Indeed.com");
    expect(run().title).toBe("Frontend - React - Entwickler");
  });

  it("returns source none when nothing useful is on the page", () => {
    setPage("<main><p>Hi</p></main>");
    expect(run().source).toBe("none");
  });
});

describe("jobSiteOriginFor", () => {
  it("asks for the page's own origin on any https site", () => {
    expect(jobSiteOriginFor("https://www.linkedin.com/jobs/view/1")).toBe("https://www.linkedin.com/*");
    expect(jobSiteOriginFor("https://acme.wd3.myworkdayjobs.com/en-US/x")).toBe("https://acme.wd3.myworkdayjobs.com/*");
    expect(jobSiteOriginFor("https://tytantechnologiesgmbh.recruitee.com/o/unsolicited-application")).toBe("https://tytantechnologiesgmbh.recruitee.com/*");
    expect(jobSiteOriginFor("https://example.com/careers?id=1")).toBe("https://example.com/*");
  });

  it("rejects insecure and invalid URLs", () => {
    expect(jobSiteOriginFor("http://www.linkedin.com/")).toBeNull();
    expect(jobSiteOriginFor("nonsense")).toBeNull();
  });
});

describe("pickBest", () => {
  const r = (source: "selection" | "site" | "structured-data" | "fallback" | "none", len: number) => ({ source, text: "x".repeat(len), title: "", company: "" });

  it("prefers the job frame over a page-wide guess, even if the guess is longer", () => {
    expect(pickBest([r("fallback", 9000), r("site", 1500)])?.source).toBe("site");
  });

  it("ranks selection > site > structured data > fallback and breaks ties by length", () => {
    expect(pickBest([r("site", 100), r("selection", 40)])?.source).toBe("selection");
    expect(pickBest([r("structured-data", 100), r("fallback", 500)])?.source).toBe("structured-data");
    expect(pickBest([r("site", 100), r("site", 300)])?.text.length).toBe(300);
  });

  it("returns undefined for no results", () => {
    expect(pickBest([])).toBeUndefined();
  });
});
