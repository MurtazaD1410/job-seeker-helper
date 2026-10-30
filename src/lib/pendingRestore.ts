import { z } from "zod";

// A backup of the Overleaf file as it should be after a PDF build. It is written before the build touches
// the file and removed once the file has been restored, so an interrupted build (panel closed, browser
// crash) can always be undone from it.

export const PendingRestoreSchema = z.object({
  text: z.string(),
  /** Overleaf project id and file name of the document that was changed. */
  project: z.string(),
  file: z.string(),
  /** Project/tab title, for the banner. */
  title: z.string(),
  saved_at: z.number()
});
export type PendingRestore = z.infer<typeof PendingRestoreSchema>;

const KEY = "pendingRestore";

export async function loadPendingRestore(): Promise<PendingRestore | null> {
  const stored = await chrome.storage.local.get(KEY);
  const parsed = PendingRestoreSchema.safeParse(stored[KEY]);
  return parsed.success ? parsed.data : null;
}

export async function savePendingRestore(p: PendingRestore | null): Promise<void> {
  if (p) await chrome.storage.local.set({ [KEY]: p });
  else await chrome.storage.local.remove(KEY);
}
