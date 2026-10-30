import { describe, expect, it } from "vitest";
import { addFact, factLine, hasFact } from "@/lib/facts";

describe("facts", () => {
  it("builds a tidy fact line", () => {
    expect(factLine("Redux")).toBe("Experience with Redux.");
    expect(factLine("  Redux ", " used   Toolkit in a course project. ")).toBe("Experience with Redux: used Toolkit in a course project.");
  });

  it("appends to existing facts on a new line, without duplicating", () => {
    const once = addFact("I know Docker.", "Redux", "side project");
    expect(once).toBe("I know Docker.\nExperience with Redux: side project.");
    expect(addFact(once, "redux")).toBe(once);
    expect(addFact("", "Go")).toBe("Experience with Go.");
    expect(addFact("A\n\n", "Go")).toBe("A\nExperience with Go.");
  });

  it("detects an added fact by term, case-insensitively, but not a longer term", () => {
    const facts = "Experience with Redux Toolkit: x.\nExperience with Go.";
    expect(hasFact(facts, "go")).toBe(true);
    expect(hasFact(facts, "Redux")).toBe(false);
    expect(hasFact(facts, "Redux Toolkit")).toBe(true);
    expect(hasFact("", "Go")).toBe(false);
  });
});
