// Simple pattern-based redaction of contact details before text leaves the browser.
// It keeps everything else byte-for-byte so `original` snippets still match the real resume.

const EMAIL = /(?:[A-Z0-9.%+-]|\\_|_)+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Digits with the separators seen in phone numbers; LaTeX non-breaking "~" included. No newlines.
const PHONE = /(?<![\w\\])\+?\(?\d[\d \t().\/~-]{6,}\d(?!\w)/g;
const STREET_DE = /\b[\p{L}.-]+(?:straße|strasse|str\.|allee|platz|weg|gasse)[ \t~]+\d+[a-z]?\b/giu;
const STREET_EN = /\b\d+[ \t~]+[\p{L}.-]+(?:[ \t~][\p{L}.-]+)?[ \t~](?:Street|St\.|Road|Rd\.|Avenue|Ave\.|Lane)\b/gu;
// A German-style postcode + city only at line start or after a comma, so "50000 Users" mid-sentence survives.
const POSTCODE_CITY = /(^|,[ \t]*|\\\\[ \t]*)(\d{5}[ \t~]+\p{Lu}[\p{L}-]+)/gmu;

type Kind = "email" | "phone" | "address";
type Labeler = (kind: Kind, value: string) => string;

function looksLikePhone(match: string): boolean {
  const digits = match.replace(/\D/g, "").length;
  // Year ranges like "2019 -- 2023" have 8 digits and stay.
  return digits >= 9 || (match.startsWith("+") && digits >= 7);
}

function redactWith(text: string, label: Labeler): string {
  return text
    .replace(EMAIL, (m) => label("email", m))
    .replace(PHONE, (m) => (looksLikePhone(m) ? label("phone", m) : m))
    .replace(STREET_DE, (m) => label("address", m))
    .replace(STREET_EN, (m) => label("address", m))
    .replace(POSTCODE_CITY, (_m, prefix: string, value: string) => prefix + label("address", value));
}

/** One-way redaction: "[email]", "[phone]", "[address]". */
export function redactContact(text: string): string {
  return redactWith(text, (kind) => `[${kind}]`);
}

/**
 * Reversible redaction for when the model's output must contain the real details again (the cover
 * letter). Each distinct value gets its own token ("[email-1]"); the same value always maps to the
 * same token across every text passed through one redactor.
 */
export function makeRedactor() {
  const tokenByValue = new Map<string, string>();
  const valueByToken = new Map<string, string>();
  const counters: Record<Kind, number> = { email: 0, phone: 0, address: 0 };

  const label: Labeler = (kind, value) => {
    const key = `${kind}\0${value}`;
    let token = tokenByValue.get(key);
    if (!token) {
      token = `[${kind}-${++counters[kind]}]`;
      tokenByValue.set(key, token);
      valueByToken.set(token, value);
    }
    return token;
  };

  return {
    redact: (text: string) => redactWith(text, label),
    restore: (text: string) => text.replace(TOKEN, (t) => valueByToken.get(t) ?? t)
  };
}

/** Any redaction token, indexed or not. Used to detect placeholders the model left behind. */
export const TOKEN = /\[(?:email|phone|address)(?:-\d+)?\]/g;
