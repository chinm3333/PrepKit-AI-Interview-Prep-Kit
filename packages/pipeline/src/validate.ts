import { z } from "zod";
import type { Kit } from "./types.js";

const requirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(["technical", "behavioural", "domain"]),
  priority: z.enum(["must", "nice"]),
});

const questionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string()),
  category: z.enum(["technical", "behavioural", "system-design", "company-fit"]),
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

const flashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()),
});

const scheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int().nonnegative(),
});

const kitSchema = z.object({
  source: z.object({
    company: z.string(),
    company_url: z.string(),
    role: z.string(),
    location: z.string(),
    jd_chars: z.number().int().nonnegative(),
    researched_at: z.string(),
    pages_used: z.array(z.string()),
  }),
  company_brief: z.object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(z.string()),
  }),
  role: z.object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(requirementSchema),
  }),
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: z.object({
    days_available: z.number().int().positive(),
    days: z.array(scheduleDaySchema),
  }),
  coverage: z.object({
    uncovered_requirement_ids: z.array(z.string()),
    passes: z.number().int().nonnegative(),
  }),
});

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateKitStructure(kit: unknown): {
  ok: boolean;
  kit?: Kit;
  issues: ValidationIssue[];
} {
  const parsed = kitSchema.safeParse(kit);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join(".") || "(root)",
        message: i.message,
      })),
    };
  }

  const data = parsed.data as Kit;
  const issues: ValidationIssue[] = [];
  const reqIds = new Set(data.role.requirements.map((r) => r.id));
  const qIds = new Set(data.questions.map((q) => q.id));

  const reqIdCounts = new Map<string, number>();
  for (const r of data.role.requirements) {
    reqIdCounts.set(r.id, (reqIdCounts.get(r.id) ?? 0) + 1);
  }
  for (const [id, count] of reqIdCounts) {
    if (count > 1) issues.push({ path: "role.requirements", message: `Duplicate requirement id ${id}` });
  }

  const qIdCounts = new Map<string, number>();
  for (const q of data.questions) {
    qIdCounts.set(q.id, (qIdCounts.get(q.id) ?? 0) + 1);
    for (const rid of q.requirement_ids) {
      if (!reqIds.has(rid)) {
        issues.push({
          path: `questions.${q.id}.requirement_ids`,
          message: `Unknown requirement id ${rid}`,
        });
      }
    }
  }
  for (const [id, count] of qIdCounts) {
    if (count > 1) issues.push({ path: "questions", message: `Duplicate question id ${id}` });
  }

  const fIdCounts = new Map<string, number>();
  for (const f of data.flashcards) {
    fIdCounts.set(f.id, (fIdCounts.get(f.id) ?? 0) + 1);
    for (const rid of f.requirement_ids) {
      if (!reqIds.has(rid)) {
        issues.push({
          path: `flashcards.${f.id}.requirement_ids`,
          message: `Unknown requirement id ${rid}`,
        });
      }
    }
  }
  for (const [id, count] of fIdCounts) {
    if (count > 1) issues.push({ path: "flashcards", message: `Duplicate flashcard id ${id}` });
  }

  if (data.schedule.days.length !== data.schedule.days_available) {
    issues.push({
      path: "schedule.days",
      message: `Expected ${data.schedule.days_available} days, got ${data.schedule.days.length}`,
    });
  }

  const dayNums = data.schedule.days.map((d) => d.day).sort((a, b) => a - b);
  for (let i = 0; i < dayNums.length; i++) {
    if (dayNums[i] !== i + 1) {
      issues.push({ path: "schedule.days", message: "Day numbers must be 1..N contiguous" });
      break;
    }
  }

  for (const day of data.schedule.days) {
    if (!Number.isInteger(day.minutes)) {
      issues.push({ path: `schedule.days[${day.day}].minutes`, message: "minutes must be an integer" });
    }
    for (const qid of day.question_ids) {
      if (!qIds.has(qid)) {
        issues.push({
          path: `schedule.days[${day.day}].question_ids`,
          message: `Unknown question id ${qid}`,
        });
      }
    }
  }

  return { ok: issues.length === 0, kit: data, issues };
}
