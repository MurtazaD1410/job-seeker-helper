import { describe, expect, it } from "vitest";
import { redactContact } from "@/lib/redact";

describe("redactContact", () => {
  it("redacts emails, including LaTeX mailto links and escaped underscores", () => {
    expect(redactContact("john.doe@example.com")).toBe("[email]");
    expect(redactContact(String.raw`\href{mailto:john\_doe@mail.example.de}{john\_doe@mail.example.de}`)).toBe(
      String.raw`\href{mailto:[email]}{[email]}`
    );
  });

  it("redacts phone numbers", () => {
    expect(redactContact("+49 171 1234567")).toBe("[phone]");
    expect(redactContact("Tel: 0171/1234567")).toBe("Tel: [phone]");
    expect(redactContact("+49~171~1234567")).toBe("[phone]");
    expect(redactContact("(030) 123 456 78")).toBe("[phone]");
  });

  it("leaves dates, years and metrics alone", () => {
    for (const t of ["2019 -- 2023", "01.02.2020", "Sept 2019 - Mar 2021", "Processed 1,234,567 rows", "v3.12.1"]) {
      expect(redactContact(t)).toBe(t);
    }
  });

  it("redacts street addresses and postcode + city lines", () => {
    expect(redactContact("Musterstraße 12")).toBe("[address]");
    expect(redactContact("Hauptstr. 5a, 10115 Berlin")).toBe("[address], [address]");
    expect(redactContact("221 Baker Street")).toBe("[address]");
    expect(redactContact("10115 Berlin")).toBe("[address]");
  });

  it("does not mistake mid-sentence numbers for postcodes", () => {
    expect(redactContact("Served 50000 Users daily")).toBe("Served 50000 Users daily");
  });

  it("keeps surrounding LaTeX untouched", () => {
    const src = String.raw`\textbf{Jane} \\ jane@x.io \quad +49 171 1234567 \\ \section{Skills}`;
    expect(redactContact(src)).toBe(String.raw`\textbf{Jane} \\ [email] \quad [phone] \\ \section{Skills}`);
  });
});
