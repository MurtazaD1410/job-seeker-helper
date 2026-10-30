import { describe, expect, it } from "vitest";
import { pickTab, projectIdFromUrl, type OverleafTab } from "@/lib/overleaf";
import { normalizeSettings } from "@/lib/storage";

const tab = (id: number, projectId: string, active = false): OverleafTab => ({
  id,
  title: `Project ${projectId}`,
  url: `https://www.overleaf.com/project/${projectId}`,
  active,
  projectId
});

describe("projectIdFromUrl", () => {
  it("extracts the project id and ignores other pages", () => {
    expect(projectIdFromUrl("https://www.overleaf.com/project/64f0a1B2c3d4e5f6a7b8c9d0")).toBe("64f0a1B2c3d4e5f6a7b8c9d0");
    expect(projectIdFromUrl("https://www.overleaf.com/project/abc123/files?x=1")).toBe("abc123");
    expect(projectIdFromUrl("https://www.overleaf.com/project")).toBe("");
    expect(projectIdFromUrl("https://example.com/")).toBe("");
  });
});

describe("pickTab", () => {
  const tabs = [tab(1, "resumeproj"), tab(2, "coverproj", true)];

  it("uses a document's own project tab, whichever tab is the default", () => {
    expect(pickTab(tabs, 1, "coverproj")?.id).toBe(2);
    expect(pickTab(tabs, 2, "resumeproj")?.id).toBe(1);
  });

  it("falls back to the default tab when the document has no project", () => {
    expect(pickTab(tabs, 2, "")?.id).toBe(2);
    expect(pickTab(tabs, null, "")).toBeUndefined();
  });

  it("returns nothing when the document's project isn't open", () => {
    expect(pickTab(tabs, 1, "closedproj")).toBeUndefined();
  });
});

describe("Overleaf settings", () => {
  it("default to empty and keep trimmed values", () => {
    expect(normalizeSettings({})).toMatchObject({ resumeOverleafProject: "", coverOverleafProject: "", resumeOverleafFile: "", coverOverleafFile: "" });
    expect(normalizeSettings({ resumeOverleafProject: " abc ", coverOverleafFile: " cover.tex " })).toMatchObject({
      resumeOverleafProject: "abc",
      coverOverleafFile: "cover.tex"
    });
  });
});
