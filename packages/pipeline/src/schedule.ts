import type { Question, Requirement, Schedule, ScheduleDay } from "./types.js";

export interface ScheduleInput {
  daysAvailable: number;
  questions: Question[];
  requirements: Requirement[];
}

function clampDays(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), 60);
}

function priorityWeight(req: Requirement | undefined): number {
  if (!req) return 1;
  return req.priority === "must" ? 3 : 1;
}

function kindOrder(kind: string): number {
  switch (kind) {
    case "technical":
      return 0;
    case "system-design":
      return 1;
    case "domain":
      return 2;
    case "behavioural":
      return 3;
    case "company-fit":
      return 4;
    default:
      return 5;
  }
}

/**
 * Deterministic schedule allocation.
 * Harder / higher-priority material earlier; every must-have appears at least once.
 */
export function allocateSchedule(input: ScheduleInput): Schedule {
  const daysAvailable = clampDays(input.daysAvailable);
  const reqById = new Map(input.requirements.map((r) => [r.id, r]));

  const scored = [...input.questions].map((q) => {
    const reqs = q.requirement_ids.map((id) => reqById.get(id)).filter(Boolean) as Requirement[];
    const must = reqs.some((r) => r.priority === "must");
    const weight =
      q.difficulty * 2 +
      (must ? 5 : 0) +
      reqs.reduce((s, r) => s + priorityWeight(r), 0) -
      kindOrder(q.category);
    return { q, weight, must };
  });

  scored.sort((a, b) => b.weight - a.weight || a.q.id.localeCompare(b.q.id));

  const buckets: Question[][] = Array.from({ length: daysAvailable }, () => []);
  scored.forEach((item, idx) => {
    const earlyBias = item.must || item.q.difficulty >= 3 ? 0.35 : 0;
    const slot = Math.min(
      daysAvailable - 1,
      Math.floor((idx / Math.max(scored.length, 1)) * daysAvailable * (1 - earlyBias))
    );
    buckets[slot].push(item.q);
  });

  const scheduledReqIds = new Set<string>();
  for (const bucket of buckets) {
    for (const q of bucket) {
      for (const rid of q.requirement_ids) scheduledReqIds.add(rid);
    }
  }

  const mustReqs = input.requirements.filter((r) => r.priority === "must");
  for (const req of mustReqs) {
    if (scheduledReqIds.has(req.id)) continue;
    const covering = input.questions.find((q) => q.requirement_ids.includes(req.id));
    if (covering) {
      buckets[0].push(covering);
      scheduledReqIds.add(req.id);
    }
  }

  const allQs = buckets.flat();
  if (allQs.length > 0) {
    for (let d = 0; d < daysAvailable; d++) {
      if (buckets[d].length === 0) {
        let donor = -1;
        let max = 1;
        for (let i = 0; i < daysAvailable; i++) {
          if (buckets[i].length > max) {
            max = buckets[i].length;
            donor = i;
          }
        }
        if (donor >= 0) {
          const moved = buckets[donor].pop();
          if (moved) buckets[d].push(moved);
        }
      }
    }
  }

  const days: ScheduleDay[] = buckets.map((qs, i) => {
    const unique = dedupeQuestions(qs);
    const categories = countCategories(unique);
    const focus = focusLabel(i + 1, daysAvailable, categories, unique.length);
    const minutes = Math.max(
      30,
      unique.reduce((sum, q) => sum + 15 + q.difficulty * 10, 0)
    );
    return {
      day: i + 1,
      focus,
      question_ids: unique.map((q) => q.id),
      minutes: Math.round(minutes),
    };
  });

  return { days_available: daysAvailable, days };
}

function dedupeQuestions(qs: Question[]): Question[] {
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const q of qs) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

function countCategories(qs: Question[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const q of qs) c[q.category] = (c[q.category] ?? 0) + 1;
  return c;
}

function focusLabel(
  day: number,
  total: number,
  categories: Record<string, number>,
  count: number
): string {
  if (count === 0) return day === total ? "Light review & rest" : "Open review";
  const top = Object.entries(categories).sort((a, b) => b[1] - a[1])[0]?.[0];
  const labels: Record<string, string> = {
    technical: "Core technical depth",
    behavioural: "Behavioural stories",
    "system-design": "System design",
    "company-fit": "Company fit & process",
  };
  if (day === 1) return `Foundations | ${labels[top ?? ""] ?? "priority topics"}`;
  if (day === total) return `Final pass | ${labels[top ?? ""] ?? "mixed review"}`;
  return labels[top ?? ""] ?? `Day ${day} focus`;
}
