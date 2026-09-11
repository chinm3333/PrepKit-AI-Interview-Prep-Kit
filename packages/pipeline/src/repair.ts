import { applyCoverage } from "./coverage.js";
import { allocateSchedule } from "./schedule.js";
import type { Kit } from "./types.js";
import { validateKitStructure } from "./validate.js";

/**
 * After builder edits, ensure referential integrity.
 * - Always drop dangling question/req refs
 * - Reallocate schedule unless the user explicitly edited it
 */
export function repairKitIntegrity(
  kit: Kit,
  { reallocateSchedule = true }: { reallocateSchedule?: boolean } = {}
): Kit {
  const reqIds = new Set(kit.role.requirements.map((r) => r.id));

  const cleanedQuestions = kit.questions.map((q) => ({
    ...q,
    requirement_ids: q.requirement_ids.filter((id) => reqIds.has(id)),
    difficulty: ([1, 2, 3].includes(q.difficulty) ? q.difficulty : 2) as 1 | 2 | 3,
  }));

  const cleanedFlashcards = kit.flashcards.map((f) => ({
    ...f,
    requirement_ids: f.requirement_ids.filter((id) => reqIds.has(id)),
  }));

  const qIds = new Set(cleanedQuestions.map((q) => q.id));

  let schedule = kit.schedule;
  if (reallocateSchedule) {
    schedule = allocateSchedule({
      daysAvailable: kit.schedule.days_available,
      questions: cleanedQuestions,
      requirements: kit.role.requirements,
    });
  } else {
    schedule = {
      days_available: kit.schedule.days_available,
      days: kit.schedule.days.map((d) => ({
        ...d,
        question_ids: d.question_ids.filter((id) => qIds.has(id)),
        minutes: Math.max(0, Math.round(Number(d.minutes) || 0)),
      })),
    };
    if (schedule.days.length !== schedule.days_available) {
      schedule = allocateSchedule({
        daysAvailable: kit.schedule.days_available,
        questions: cleanedQuestions,
        requirements: kit.role.requirements,
      });
    }
  }

  let next: Kit = applyCoverage(
    {
      ...kit,
      questions: cleanedQuestions,
      flashcards: cleanedFlashcards,
      schedule: {
        days_available: schedule.days_available,
        days: schedule.days.map((d) => ({
          ...d,
          question_ids: d.question_ids.filter((id) => qIds.has(id)),
          minutes: Math.round(d.minutes),
        })),
      },
    },
    kit.coverage.passes
  );

  const validated = validateKitStructure(next);
  if (validated.ok && validated.kit) return validated.kit;

  next = {
    ...next,
    schedule: {
      ...next.schedule,
      days: next.schedule.days.map((d) => ({
        ...d,
        question_ids: d.question_ids.filter((id) => next.questions.some((q) => q.id === id)),
      })),
    },
  };
  const again = validateKitStructure(next);
  return again.kit ?? next;
}
