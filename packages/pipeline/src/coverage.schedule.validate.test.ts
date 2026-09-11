import { describe, expect, it } from "vitest";
import { findUncoveredRequirements, applyCoverage } from "./coverage.js";
import { allocateSchedule } from "./schedule.js";
import { validateKitStructure } from "./validate.js";
import { repairKitIntegrity } from "./repair.js";
import { groundRequirementsToJd, isGrounded } from "./grounding.js";
import {
  validateFetchUrl,
  isPrivateHostOrIp,
  resolveUrl,
} from "./retrieval/urlSafety.js";
import { filterPreservedQuestions } from "./pipeline.js";
import type { Kit, Question, Requirement } from "./types.js";

const requirements: Requirement[] = [
  { id: "r1", text: "5+ years React", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentors juniors", kind: "behavioural", priority: "must" },
  { id: "r3", text: "GraphQL nice to have", kind: "technical", priority: "nice" },
];

const questions: Question[] = [
  {
    id: "q1",
    requirement_ids: ["r1"],
    category: "technical",
    prompt: "Explain React reconciliation",
    answer_outline: "...",
    difficulty: 2,
  },
];

function baseKit(over: Partial<Kit> = {}): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "https://example.com",
      role: "Engineer",
      location: "",
      jd_chars: 10,
      researched_at: new Date().toISOString(),
      pages_used: [],
    },
    company_brief: { summary: "s", what_they_do: "w", sources: [] },
    role: {
      title: "Engineer",
      seniority: "mid",
      responsibilities: ["Build things"],
      requirements,
    },
    questions: [
      questions[0],
      {
        id: "q2",
        requirement_ids: ["r2"],
        category: "behavioural",
        prompt: "Mentoring story",
        answer_outline: "",
        difficulty: 2,
      },
    ],
    flashcards: [{ id: "f1", front: "Q", back: "A", requirement_ids: ["r1"] }],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "a", question_ids: ["q1"], minutes: 45 },
        { day: 2, focus: "b", question_ids: ["q2"], minutes: 40 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 2 },
    ...over,
  };
}

describe("coverage", () => {
  it("finds uncovered must-haves only by default", () => {
    expect(findUncoveredRequirements(requirements, questions)).toEqual(["r2"]);
  });

  it("applyCoverage writes uncovered ids and passes", () => {
    const kit = applyCoverage(
      {
        role: { title: "x", seniority: "", responsibilities: [], requirements },
        questions,
      } as Kit,
      2
    );
    expect(kit.coverage).toEqual({ uncovered_requirement_ids: ["r2"], passes: 2 });
  });
});

describe("schedule", () => {
  it("creates exactly N days and includes must-have questions", () => {
    const qs: Question[] = [
      ...questions,
      {
        id: "q2",
        requirement_ids: ["r2"],
        category: "behavioural",
        prompt: "Tell me about mentoring",
        answer_outline: "...",
        difficulty: 3,
      },
      {
        id: "q3",
        requirement_ids: ["r3"],
        category: "technical",
        prompt: "GraphQL basics",
        answer_outline: "...",
        difficulty: 1,
      },
    ];
    const schedule = allocateSchedule({ daysAvailable: 5, questions: qs, requirements });
    expect(schedule.days).toHaveLength(5);
    const allIds = new Set(schedule.days.flatMap((d) => d.question_ids));
    expect(allIds.has("q1")).toBe(true);
    expect(allIds.has("q2")).toBe(true);
  });

  it("supports 1-day and 60-day clamps", () => {
    expect(allocateSchedule({ daysAvailable: 1, questions, requirements }).days).toHaveLength(1);
    expect(allocateSchedule({ daysAvailable: 60, questions, requirements }).days).toHaveLength(60);
  });
});

describe("validateKitStructure", () => {
  it("accepts a minimal valid kit", () => {
    expect(validateKitStructure(baseKit()).ok).toBe(true);
  });

  it("rejects unknown flashcard requirement ids", () => {
    const result = validateKitStructure(
      baseKit({
        flashcards: [{ id: "f1", front: "Q", back: "A", requirement_ids: ["nope"] }],
      })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects unknown schedule question ids", () => {
    const result = validateKitStructure(
      baseKit({
        questions: [],
        flashcards: [],
        role: { title: "E", seniority: "", responsibilities: [], requirements: [] },
        schedule: {
          days_available: 1,
          days: [{ day: 1, focus: "x", question_ids: ["missing"], minutes: 30 }],
        },
      })
    );
    expect(result.ok).toBe(false);
  });
});

describe("repairKitIntegrity", () => {
  it("removes dangling schedule refs after question delete and reallocates", () => {
    const kit = baseKit({
      questions: [questions[0]],
      schedule: {
        days_available: 2,
        days: [
          { day: 1, focus: "a", question_ids: ["q1", "q2"], minutes: 45 },
          { day: 2, focus: "b", question_ids: ["q2"], minutes: 40 },
        ],
      },
    });
    const repaired = repairKitIntegrity(kit);
    const ids = repaired.schedule.days.flatMap((d) => d.question_ids);
    expect(ids.every((id) => id === "q1")).toBe(true);
    expect(validateKitStructure(repaired).ok).toBe(true);
  });

  it("preserves user schedule when reallocateSchedule is false", () => {
    const kit = baseKit({
      schedule: {
        days_available: 2,
        days: [
          { day: 1, focus: "Custom focus", question_ids: ["q1"], minutes: 99 },
          { day: 2, focus: "Also custom", question_ids: ["q2"], minutes: 33 },
        ],
      },
    });
    const repaired = repairKitIntegrity(kit, { reallocateSchedule: false });
    expect(repaired.schedule.days[0].focus).toBe("Custom focus");
    expect(repaired.schedule.days[0].minutes).toBe(99);
  });
});

describe("groundRequirementsToJd", () => {
  it("keeps requirements grounded in a rich JD", () => {
    const jd =
      "We need 5+ years React experience. Mentors juniors. GraphQL is a nice to have.";
    const kept = groundRequirementsToJd(jd, requirements);
    expect(kept.some((r) => /React/i.test(r.text))).toBe(true);
  });

  it("drops invented requirements on a thin JD", () => {
    const jd = "Software Engineer\nApply now.";
    const invented: Requirement[] = [
      {
        id: "r1",
        text: "10 years Kubernetes and Terraform expertise",
        kind: "technical",
        priority: "must",
      },
    ];
    expect(groundRequirementsToJd(jd, invented)).toHaveLength(0);
  });

  it("does not demote weak single-token invents to nice", () => {
    const jd = "Engineer with experience building products.";
    const invented: Requirement[] = [
      {
        id: "r1",
        text: "Deep expertise in Rust async runtimes and WASM",
        kind: "technical",
        priority: "must",
      },
    ];
    expect(groundRequirementsToJd(jd, invented)).toHaveLength(0);
    expect(isGrounded(jd, invented[0].text)).toBe(false);
  });
});

describe("urlSafety / SSRF helpers", () => {
  it("blocks private hosts when allowPrivate is false", () => {
    expect(validateFetchUrl("http://127.0.0.1/x", { allowPrivate: false }).ok).toBe(false);
    expect(validateFetchUrl("http://192.168.1.1/", { allowPrivate: false }).ok).toBe(false);
    expect(isPrivateHostOrIp("10.0.0.5")).toBe(true);
  });

  it("blocks private redirect targets resolved from Location headers", () => {
    const next = resolveUrl("https://example.com/path", "http://127.0.0.1/secret");
    expect(next).toBeTruthy();
    expect(validateFetchUrl(next!, { allowPrivate: false }).ok).toBe(false);
  });

  it("allows public https and local fixtures when opted in", () => {
    expect(validateFetchUrl("https://example.com/careers", { allowPrivate: false }).ok).toBe(true);
    expect(validateFetchUrl("http://localhost:8099/acme/", { allowPrivate: true }).ok).toBe(true);
  });
});

describe("filterPreservedQuestions (regen pin/edit)", () => {
  it("keeps pinned questions in the regenerated category", () => {
    const qs: Question[] = [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "A",
        answer_outline: "",
        difficulty: 2,
      },
      {
        id: "q2",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "B pinned",
        answer_outline: "",
        difficulty: 2,
      },
      {
        id: "q3",
        requirement_ids: ["r2"],
        category: "behavioural",
        prompt: "C",
        answer_outline: "",
        difficulty: 1,
      },
    ];
    const preserved = filterPreservedQuestions(qs, "technical", new Set(["q2"]));
    expect(preserved.map((q) => q.id).sort()).toEqual(["q2", "q3"]);
  });
});
