export const manifest = {
  manifest_version: 3,
  name: "CV Tailor",
  version: "0.1.0",
  description: "Tailor your LaTeX resume and cover letter (Overleaf) to a job description with Gemini.",
  minimum_chrome_version: "116",
  permissions: ["sidePanel", "storage", "activeTab", "scripting", "tabs"],
  // Any https site, so "Grab from page" works on every career site without a permission prompt.
  host_permissions: ["https://*/*"],
  background: { service_worker: "background.js", type: "module" },
  side_panel: { default_path: "sidepanel.html" },
  action: { default_title: "Open CV Tailor" },
  icons: { "16": "icon16.png", "48": "icon48.png", "128": "icon128.png" }
};
