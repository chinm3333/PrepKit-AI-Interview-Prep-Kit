import { CONTENT_GUARD, completeJson } from "../llm/client.js";
import type {
  CompanyBrief,
  Flashcard,
  Question,
  QuestionCategory,
  Requirement,
  RoleBreakdown,
} from "../types.js";
import { sanitizeUntrustedText } from "../retrieval/crawl.js";
import { groundRequirementsToJd } from "../grounding.js";

/** Coerce model output that should be a string (arrays/objects sometimes sneak in). */
function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((v) => asText(v))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value).trim();
}

export async function extractRoleFromJd(jd: string): Promise<RoleBreakdown & { location?: string }> {
  const thin = jd.trim().length < 120;

  const result = await completeJson<{
    title: string;
    seniority: string;
    location?: string;
    responsibilities: string[];
    requirements: Array<{
      text: string;
      kind: Requirement["kind"];
      priority: Requirement["priority"];
    }>;
  }>([
    {
      role: "system",
      content: `${CONTENT_GUARD}
Extract role details from the job description.
Rules:
- Only extract requirements that appear in the text. Prefer fewer accurate items over inventing.
- priority "must" for required qualifications; "nice" for preferred/bonus/nice-to-have. When unsure, use "nice".
- kind: technical | behavioural | domain
- If the JD is extremely thin, return a short title guess and 0–2 requirements max, and empty responsibilities if unknown.
Return JSON: { title, seniority, location, responsibilities: string[], requirements: [{ text, kind, priority }] }`,
    },
    {
      role: "user",
      content: sanitizeUntrustedText(jd, "job_description"),
    },
  ]);

  const rawReqs: Requirement[] = (result.requirements ?? [])
    .filter((r) => r.text?.trim())
    .slice(0, thin ? 3 : 20)
    .map((r, i) => ({
      id: `r${i + 1}`,
      text: r.text.trim(),
      kind: r.kind ?? "technical",
      priority: r.priority === "must" ? "must" : r.priority === "nice" ? "nice" : "nice",
    }));

  const requirements = groundRequirementsToJd(jd, rawReqs);

  return {
    title: result.title?.trim() || "Untitled role",
    seniority: result.seniority?.trim() || "unspecified",
    location: result.location?.trim() || "",
    responsibilities: (result.responsibilities ?? []).filter(Boolean).slice(0, 12),
    requirements,
  };
}

export async function generateCompanyBrief(input: {
  companyUrl: string;
  pageTexts: { url: string; text: string }[];
  publicNotes: string;
}): Promise<CompanyBrief & { company: string }> {
  if (input.pageTexts.length === 0 && !input.publicNotes.trim()) {
    return {
      company: guessCompanyFromUrl(input.companyUrl),
      summary:
        "Limited public information was available for this company. The brief below is intentionally thin rather than speculative.",
      what_they_do: "Could not determine what the company does from reachable sources.",
      sources: [],
    };
  }

  const corpus = input.pageTexts
    .map((p) => sanitizeUntrustedText(`${p.url}\n${p.text}`, "company_page"))
    .join("\n\n")
    .slice(0, 14000);

  const result = await completeJson<{
    company: string;
    summary: string;
    what_they_do: string;
  }>([
    {
      role: "system",
      content: `${CONTENT_GUARD}
Write a short company brief using only the provided sources.
If the homepage was truncated or thin, still extract whatever company identity is present.
If sources are thin, say so honestly. Do not invent products, funding, or culture claims.
Return JSON: { company, summary, what_they_do }`,
    },
    {
      role: "user",
      content: `Company URL: ${input.companyUrl}\n\nSources:\n${corpus}\n\nPublic discussion notes:\n${sanitizeUntrustedText(input.publicNotes || "none", "public_discussion")}`,
    },
  ]);

  return {
    company: result.company?.trim() || guessCompanyFromUrl(input.companyUrl),
    summary: result.summary?.trim() || "Insufficient source material for a detailed brief.",
    what_they_do: result.what_they_do?.trim() || "Unknown from available sources.",
    sources: input.pageTexts.map((p) => p.url),
  };
}

export async function generateQuestionsForCategory(input: {
  category: QuestionCategory;
  requirements: Requirement[];
  roleTitle: string;
  hiringContext: string;
  publicInterviewNotes: string;
  existingPrompts?: string[];
}): Promise<Omit<Question, "id">[]> {
  const relevant = input.requirements.filter((r) => requirementMatchesCategory(r, input.category));
  if (relevant.length === 0 && input.category !== "company-fit") return [];

  const result = await completeJson<{
    questions: Array<{
      requirement_ids: string[];
      prompt: string;
      answer_outline: string;
      difficulty: 1 | 2 | 3;
    }>;
  }>([
    {
      role: "system",
      content: `${CONTENT_GUARD}
Generate interview questions for category "${input.category}" only.
Each question must reference one or more requirement ids from the list.
Use hiring-process context when present (e.g. take-home, system design round) to shape questions.
Do not duplicate existing prompts.
Aim for 1–2 questions per relevant requirement, max 8 total.
Return JSON: { questions: [{ requirement_ids, prompt, answer_outline, difficulty }] }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        role: input.roleTitle,
        requirements: relevant.length ? relevant : input.requirements.slice(0, 6),
        hiring_context: input.hiringContext.slice(0, 3000),
        public_interview_notes: input.publicInterviewNotes.slice(0, 2000),
        avoid_prompts: input.existingPrompts ?? [],
      }),
    },
  ]);

  return (result.questions ?? [])
    .map((q) => ({
      ...q,
      prompt: asText(q.prompt),
      answer_outline: asText(q.answer_outline),
    }))
    .filter((q) => q.prompt)
    .slice(0, 8)
    .map((q) => ({
      requirement_ids: (q.requirement_ids ?? []).filter((id) =>
        input.requirements.some((r) => r.id === id)
      ),
      category: input.category,
      prompt: q.prompt,
      answer_outline: q.answer_outline,
      difficulty: ([1, 2, 3].includes(q.difficulty) ? q.difficulty : 2) as 1 | 2 | 3,
    }))
    .map((q) =>
      q.requirement_ids.length
        ? q
        : {
            ...q,
            requirement_ids: relevant[0] ? [relevant[0].id] : input.requirements[0] ? [input.requirements[0].id] : [],
          }
    );
}

export async function generateGapQuestions(input: {
  gaps: Requirement[];
  roleTitle: string;
  existingPrompts: string[];
}): Promise<Omit<Question, "id">[]> {
  if (!input.gaps.length) return [];

  const result = await completeJson<{
    questions: Array<{
      requirement_ids: string[];
      category: QuestionCategory;
      prompt: string;
      answer_outline: string;
      difficulty: 1 | 2 | 3;
    }>;
  }>([
    {
      role: "system",
      content: `${CONTENT_GUARD}
These must-have requirements have no covering questions yet. Generate exactly one question per gap requirement.
Pick the best category for each. Avoid duplicating existing prompts.
Return JSON: { questions: [{ requirement_ids, category, prompt, answer_outline, difficulty }] }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        role: input.roleTitle,
        gaps: input.gaps,
        avoid_prompts: input.existingPrompts,
      }),
    },
  ]);

  return (result.questions ?? [])
    .map((q) => ({
      ...q,
      prompt: asText(q.prompt),
      answer_outline: asText(q.answer_outline),
    }))
    .filter((q) => q.prompt)
    .map((q) => ({
      requirement_ids: q.requirement_ids?.length ? q.requirement_ids : input.gaps[0] ? [input.gaps[0].id] : [],
      category: q.category ?? "technical",
      prompt: q.prompt,
      answer_outline: q.answer_outline,
      difficulty: ([1, 2, 3].includes(q.difficulty) ? q.difficulty : 2) as 1 | 2 | 3,
    }));
}

export async function generateFlashcards(input: {
  requirements: Requirement[];
  questions: Question[];
}): Promise<Omit<Flashcard, "id">[]> {
  if (!input.requirements.length) return [];

  const result = await completeJson<{
    flashcards: Array<{ front: string; back: string; requirement_ids: string[] }>;
  }>([
    {
      role: "system",
      content: `${CONTENT_GUARD}
Create concise flashcards tied to requirements (and optionally inspired by questions).
Max 12 cards. Return JSON: { flashcards: [{ front, back, requirement_ids }] }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        requirements: input.requirements,
        sample_questions: input.questions.slice(0, 10).map((q) => ({
          prompt: q.prompt,
          requirement_ids: q.requirement_ids,
        })),
      }),
    },
  ]);

  return (result.flashcards ?? [])
    .map((f) => ({
      front: asText(f.front),
      back: asText(f.back),
      requirement_ids: f.requirement_ids,
    }))
    .filter((f) => f.front && f.back)
    .slice(0, 12)
    .map((f) => ({
      front: f.front,
      back: f.back,
      requirement_ids: (f.requirement_ids ?? []).filter((id) =>
        input.requirements.some((r) => r.id === id)
      ),
    }));
}

function requirementMatchesCategory(r: Requirement, category: QuestionCategory): boolean {
  if (category === "technical") return r.kind === "technical";
  if (category === "behavioural") return r.kind === "behavioural";
  if (category === "system-design") return r.kind === "technical" || r.kind === "domain";
  if (category === "company-fit") return true;
  return false;
}

function guessCompanyFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const part = host.split(".")[0] ?? host;
    return part.charAt(0).toUpperCase() + part.slice(1);
  } catch {
    return "Unknown company";
  }
}
