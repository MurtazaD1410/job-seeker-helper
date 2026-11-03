import type { Language } from "./schema";
import type { Settings } from "./storage";

export interface ResumeSource {
  /** The language of the resume actually used (German if no English one is set up). */
  language: Language;
  text: string;
  /** Overleaf project id and file for this resume; empty = the selected tab / the open file. */
  project: string;
  file: string;
  fileName: string;
}

/** The master resume for a language. English falls back to the German one while no English resume is set. */
export function resumeFor(settings: Settings, language: Language): ResumeSource {
  if (language === "en" && settings.baseResumeEn.trim()) {
    return {
      language: "en",
      text: settings.baseResumeEn,
      project: settings.resumeOverleafProjectEn,
      file: settings.resumeOverleafFileEn,
      fileName: settings.resumeFileNameEn
    };
  }
  return {
    language: "de",
    text: settings.baseResume,
    project: settings.resumeOverleafProject,
    file: settings.resumeOverleafFile,
    fileName: settings.resumeFileName
  };
}
