import type { Kit, Question, Requirement } from "./types.js";

/**
 * Deterministic coverage check | never delegated to the model.
 * A must-have requirement is covered when at least one question lists its id.
 */
export function findUncoveredRequirements(
  requirements: Requirement[],
  questions: Question[],
  { mustOnly = true }: { mustOnly?: boolean } = {}
): string[] {
  const covered = new Set<string>();
  for (const q of questions) {
    for (const rid of q.requirement_ids) covered.add(rid);
  }

  return requirements
    .filter((r) => (!mustOnly || r.priority === "must") && !covered.has(r.id))
    .map((r) => r.id);
}

export function applyCoverage(kit: Kit, passes: number): Kit {
  const uncovered = findUncoveredRequirements(kit.role.requirements, kit.questions, {
    mustOnly: true,
  });
  return {
    ...kit,
    coverage: {
      uncovered_requirement_ids: uncovered,
      passes,
    },
  };
}
