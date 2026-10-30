// Job sites are optional host permissions; requested when "Grab from page" is first used on one.
export const JOB_SITE_ORIGINS = [
  "https://*.linkedin.com/*",
  "https://*.stepstone.de/*",
  "https://*.indeed.com/*",
  "https://*.indeed.de/*",
  "https://*.xing.com/*",
  "https://*.greenhouse.io/*",
  "https://*.lever.co/*",
  "https://*.myworkdayjobs.com/*",
  "https://*.personio.de/*",
  "https://*.personio.com/*"
];

export const manifest = {
  manifest_version: 3,
  name: "CV Tailor",
  version: "0.1.0",
  description: "Tailor your LaTeX resume and cover letter (Overleaf) to a job description with Gemini.",
  minimum_chrome_version: "116",
  permissions: ["sidePanel", "storage", "activeTab", "scripting", "tabs"],
  host_permissions: ["https://www.overleaf.com/*", "https://generativelanguage.googleapis.com/*"],
  optional_host_permissions: JOB_SITE_ORIGINS,
  background: { service_worker: "background.js", type: "module" },
  side_panel: { default_path: "sidepanel.html" },
  action: { default_title: "Open CV Tailor" },
  icons: { "16": "icon16.png", "48": "icon48.png", "128": "icon128.png" }
};
