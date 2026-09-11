import type { Requirement } from "./types.js";

export function groundRequirementsToJd(jd: string, requirements: Requirement[]): Requirement[] {
  const hay = normalize(jd);
  if (!hay) return [];

  const kept: Requirement[] = [];
  for (const req of requirements) {
    if (isGrounded(hay, req.text)) {
      kept.push(req);
    }
  }

  return kept.map((r, i) => ({ ...r, id: `r${i + 1}` }));
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ").replace(/\s+/g, " ").trim();
}

function significantTokens(text: string): string[] {
  const stop = new Set([
    "a", "an", "the", "and", "or", "of", "to", "in", "for", "with", "on", "at",
    "by", "from", "as", "is", "are", "be", "been", "being", "have", "has", "had",
    "years", "year", "experience", "strong", "ability", "skills", "knowledge",
    "understanding", "familiarity", "proficient", "plus", "etc", "must", "have",
  ]);
  return normalize(text)
    .split(" ")
    .filter((t) => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t));
}

export function isGrounded(hayOrJd: string, text: string): boolean {
  const hay = normalize(hayOrJd);
  const tokens = significantTokens(text);
  if (tokens.length === 0) {
    const raw = normalize(text);
    return raw.length >= 2 && hay.includes(raw);
  }
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits / tokens.length >= 0.7;
}
