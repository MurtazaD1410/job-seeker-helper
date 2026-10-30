import { extractJobFromPage, type GrabResult, type GrabSource } from "@/content/jobGrabber";
import { JOB_SITE_ORIGINS } from "@/manifest";

export type { GrabResult, GrabSource };

export const SOURCE_LABEL: Record<GrabSource, string> = {
  selection: "your text selection",
  site: "the job site's description block",
  "structured-data": "the page's job-posting data",
  fallback: "the largest text block on the page",
  none: "nothing"
};

/** The origin pattern to request if `url` belongs to a known job site, else null. */
export function jobSiteOriginFor(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const hit = JOB_SITE_ORIGINS.some((pattern) => {
    const base = pattern.replace(/^https:\/\/\*\./, "").replace(/\/\*$/, "");
    return u.protocol === "https:" && (u.hostname === base || u.hostname.endsWith(`.${base}`));
  });
  return hit ? `${u.origin}/*` : null;
}

async function runExtractor(tabId: number): Promise<GrabResult> {
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: extractJobFromPage });
  const result = frame?.result as GrabResult | undefined;
  if (!result) throw new Error("The page returned no data.");
  return result;
}

/** Reads the job description from the active tab. Throws an Error with a user-readable message. */
export async function grabFromActiveTab(): Promise<GrabResult & { url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active tab to read from.");
  if (!/^https?:/.test(tab.url)) throw new Error("This kind of page can't be read. Open the job posting in a normal tab.");
  if (new URL(tab.url).hostname.endsWith("overleaf.com")) {
    throw new Error("That's the Overleaf tab. Switch to the job posting tab and try again.");
  }

  let result: GrabResult;
  try {
    result = await runExtractor(tab.id);
  } catch (first) {
    // No access yet: ask for the site's optional permission (a click is a user gesture), then retry.
    const origin = jobSiteOriginFor(tab.url);
    if (!origin) {
      throw new Error(
        "CV Tailor can't read this tab. Click the CV Tailor toolbar icon while on the page, or paste the text manually."
      );
    }
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [origin] });
    } catch {
      // fall through to the message below
    }
    if (!granted) {
      throw new Error(`Access to ${new URL(origin).hostname} was not granted. Allow it, or paste the text manually.`);
    }
    try {
      result = await runExtractor(tab.id);
    } catch {
      throw new Error(first instanceof Error ? first.message : "Couldn't read the page.");
    }
  }

  if (result.source === "none" || !result.text) {
    throw new Error(
      "Couldn't find a job description on this page. Select the text on the page and grab again, or paste it manually."
    );
  }
  return { ...result, url: tab.url };
}
