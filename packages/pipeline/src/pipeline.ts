import { applyCoverage, findUncoveredRequirements } from "./coverage.js";
import {
  extractRoleFromJd,
  generateCompanyBrief,
  generateFlashcards,
  generateGapQuestions,
  generateQuestionsForCategory,
} from "./generation/steps.js";
import {
  crawlCompanySite,
  searchPublicInterviewDiscussion,
} from "./retrieval/crawl.js";
import { allocateSchedule } from "./schedule.js";
import { repairKitIntegrity } from "./repair.js";
import type {
  Flashcard,
  Kit,
  PipelineOptions,
  Question,
  QuestionCategory,
} from "./types.js";
import { validateKitStructure } from "./validate.js";

const CATEGORIES: QuestionCategory[] = [
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
];

/** Pure helper | kept exported for tests (regen must preserve pinned/edited). */
export function filterPreservedQuestions(
  questions: Question[],
  category: QuestionCategory,
  pinnedIds: Set<string>
): Question[] {
  return questions.filter((q) => q.category !== category || pinnedIds.has(q.id));
}

function emit(
  onProgress: PipelineOptions["onProgress"],
  step: string,
  status: "started" | "done" | "skipped" | "error",
  detail?: string
) {
  onProgress?.({ step, status, detail });
}

/**
 * Full retrieval → generation → coverage loop → schedule.
 * Shared by the HTTP API and `npm run evaluate`.
 */
export async function generateKit(
  jd: string,
  companyUrl: string,
  options: PipelineOptions
): Promise<Kit> {
  const onProgress = options.onProgress;
  const maxPasses = options.maxCoveragePasses ?? 2;
  const allowPrivate =
    options.allowPrivateUrls ??
    (process.env.ALLOW_PRIVATE_URLS === "true" || process.env.NODE_ENV !== "production");

  const researchedAt = new Date().toISOString();
  const pagesUsed: string[] = [];
  const warnings: string[] = [];

  emit(onProgress, "extract_requirements", "started");
  const extracted = await extractRoleFromJd(jd);
  const extractedLocation = extracted.location ?? "";
  const role = {
    title: extracted.title,
    seniority: extracted.seniority,
    responsibilities: extracted.responsibilities,
    requirements: extracted.requirements,
  };
  emit(
    onProgress,
    "extract_requirements",
    "done",
    `${role.requirements.length} requirements (${role.requirements.filter((r) => r.priority === "must").length} must)`
  );

  emit(onProgress, "crawl_company", "started");
  const crawl = await crawlCompanySite(companyUrl, { allowPrivate });
  for (const p of crawl.pages) pagesUsed.push(p.finalUrl || p.url);
  for (const s of crawl.skipped) warnings.push(`Skipped ${s.url}: ${s.reason}`);
  emit(
    onProgress,
    "crawl_company",
    crawl.pages.length ? "done" : "skipped",
    crawl.pages.length
      ? `${crawl.pages.length} pages, ${crawl.hiringCandidates.length} hiring candidates`
      : warnings[0] ?? "Company site unreachable"
  );

  emit(onProgress, "public_discussion", "started");
  const companyGuess =
    crawl.pages[0]?.title?.split(/[|\-–]/)[0]?.trim() ||
    (() => {
      try {
        return new URL(companyUrl).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    })();
  const discussion = await searchPublicInterviewDiscussion(companyGuess, { allowPrivate });
  pagesUsed.push(...discussion.sources);
  for (const s of discussion.skipped) warnings.push(`Skipped ${s.url}: ${s.reason}`);
  emit(
    onProgress,
    "public_discussion",
    discussion.notes ? "done" : "skipped",
    discussion.notes ? "Found public discussion snippets" : "No useful public discussion found"
  );

  emit(onProgress, "company_brief", "started");
  const briefBundle = await generateCompanyBrief({
    companyUrl,
    pageTexts: crawl.pages.map((p) => ({ url: p.finalUrl || p.url, text: p.text })),
    publicNotes: discussion.notes,
  });
  emit(onProgress, "company_brief", "done");

  const hiringContext = crawl.hiringCandidates
    .map((p) => `${p.finalUrl}\n${p.text.slice(0, 2500)}`)
    .join("\n\n")
    .slice(0, 8000);

  const questions: Question[] = [];
  let qCounter = 1;
  for (const category of CATEGORIES) {
    emit(onProgress, `questions_${category}`, "started");
    try {
      const generated = await generateQuestionsForCategory({
        category,
        requirements: role.requirements,
        roleTitle: role.title,
        hiringContext,
        publicInterviewNotes: discussion.notes,
        existingPrompts: questions.map((q) => q.prompt),
      });
      for (const g of generated) {
        questions.push({ ...g, id: `q${qCounter++}` });
      }
      emit(onProgress, `questions_${category}`, "done", `${generated.length} questions`);
    } catch (err) {
      emit(
        onProgress,
        `questions_${category}`,
        "error",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  let passes = 0;
  for (let pass = 1; pass <= maxPasses; pass++) {
    passes = pass;
    const uncovered = findUncoveredRequirements(role.requirements, questions, { mustOnly: true });
    emit(
      onProgress,
      "coverage_check",
      uncovered.length ? "started" : "done",
      uncovered.length
        ? `Pass ${pass}: ${uncovered.length} uncovered must-haves`
        : `Pass ${pass}: all must-haves covered`
    );
    if (!uncovered.length) break;

    const gaps = role.requirements.filter((r) => uncovered.includes(r.id));
    try {
      const gapQs = await generateGapQuestions({
        gaps,
        roleTitle: role.title,
        existingPrompts: questions.map((q) => q.prompt),
      });
      for (const g of gapQs) {
        const ids = g.requirement_ids.filter((id) => uncovered.includes(id));
        questions.push({
          ...g,
          requirement_ids: ids.length ? ids : [gaps[0].id],
          id: `q${qCounter++}`,
        });
      }
      emit(onProgress, "coverage_fill", "done", `Added ${gapQs.length} gap questions`);
    } catch (err) {
      emit(
        onProgress,
        "coverage_fill",
        "error",
        err instanceof Error ? err.message : String(err)
      );
      break;
    }
  }

  emit(onProgress, "flashcards", "started");
  let flashcards: Flashcard[] = [];
  try {
    const generated = await generateFlashcards({
      requirements: role.requirements,
      questions,
    });
    flashcards = generated.map((f, i) => ({ ...f, id: `f${i + 1}` }));
    emit(onProgress, "flashcards", "done", `${flashcards.length} cards`);
  } catch (err) {
    emit(onProgress, "flashcards", "error", err instanceof Error ? err.message : String(err));
  }

  emit(onProgress, "schedule", "started");
  const schedule = allocateSchedule({
    daysAvailable: options.days,
    questions,
    requirements: role.requirements,
  });
  emit(onProgress, "schedule", "done", `${schedule.days_available} days`);

  let kit: Kit = {
    source: {
      company: briefBundle.company,
      company_url: companyUrl,
      role: role.title,
      location: extractedLocation,
      jd_chars: jd.length,
      researched_at: researchedAt,
      pages_used: [...new Set(pagesUsed)].filter(Boolean),
    },
    company_brief: {
      summary:
        warnings.length && !crawl.pages.length
          ? `${briefBundle.summary} Sources note: ${warnings.slice(0, 3).join("; ")}`
          : briefBundle.summary,
      what_they_do: briefBundle.what_they_do,
      sources: briefBundle.sources,
    },
    role,
    questions,
    flashcards,
    schedule,
    coverage: { uncovered_requirement_ids: [], passes },
  };

  kit = applyCoverage(kit, passes);

  const validated = validateKitStructure(kit);
  if (!validated.ok) {
    const qIds = new Set(kit.questions.map((q) => q.id));
    kit = {
      ...kit,
      schedule: {
        ...kit.schedule,
        days: kit.schedule.days.map((d) => ({
          ...d,
          question_ids: d.question_ids.filter((id) => qIds.has(id)),
          minutes: Math.round(d.minutes),
        })),
      },
    };
    const again = validateKitStructure(kit);
    if (!again.ok) {
      throw new Error(
        `Generated kit failed validation: ${again.issues.map((i) => i.message).join("; ")}`
      );
    }
    return again.kit!;
  }

  emit(onProgress, "complete", "done");
  return validated.kit!;
}

export async function regenerateSection(
  kit: Kit,
  section:
    | { type: "company_brief" }
    | { type: "schedule" }
    | { type: "question_category"; category: QuestionCategory },
  opts: {
    jd?: string;
    pinnedQuestionIds?: string[];
    allowPrivateUrls?: boolean;
    hiringContext?: string;
    publicInterviewNotes?: string;
  } = {}
): Promise<Kit> {
  if (section.type === "schedule") {
    return {
      ...kit,
      schedule: allocateSchedule({
        daysAvailable: kit.schedule.days_available,
        questions: kit.questions,
        requirements: kit.role.requirements,
      }),
    };
  }

  if (section.type === "company_brief") {
    const allowPrivate =
      opts.allowPrivateUrls ??
      (process.env.ALLOW_PRIVATE_URLS === "true" || process.env.NODE_ENV !== "production");
    const crawl = await crawlCompanySite(kit.source.company_url, { allowPrivate });
    const discussion = await searchPublicInterviewDiscussion(kit.source.company, { allowPrivate });
    const brief = await generateCompanyBrief({
      companyUrl: kit.source.company_url,
      pageTexts: crawl.pages.map((p) => ({ url: p.finalUrl || p.url, text: p.text })),
      publicNotes: discussion.notes,
    });
    return {
      ...kit,
      source: {
        ...kit.source,
        company: brief.company || kit.source.company,
        pages_used: [...new Set([...kit.source.pages_used, ...brief.sources])],
      },
      company_brief: {
        summary: brief.summary,
        what_they_do: brief.what_they_do,
        sources: brief.sources,
      },
    };
  }

  const pinned = new Set(opts.pinnedQuestionIds ?? []);
  const preserved = filterPreservedQuestions(kit.questions, section.category, pinned);

  let hiringContext = opts.hiringContext ?? "";
  let publicInterviewNotes = opts.publicInterviewNotes ?? "";
  if (!hiringContext && !publicInterviewNotes) {
    try {
      const allowPrivate =
        opts.allowPrivateUrls ??
        (process.env.ALLOW_PRIVATE_URLS === "true" || process.env.NODE_ENV !== "production");
      const crawl = await crawlCompanySite(kit.source.company_url, { allowPrivate, maxPages: 6 });
      hiringContext = crawl.hiringCandidates
        .map((p) => `${p.finalUrl}\n${p.text.slice(0, 2000)}`)
        .join("\n\n")
        .slice(0, 6000);
      const discussion = await searchPublicInterviewDiscussion(kit.source.company, { allowPrivate });
      publicInterviewNotes = discussion.notes;
    } catch {
      /* ignore crawl failures during regen */
    }
  }

  const generated = await generateQuestionsForCategory({
    category: section.category,
    requirements: kit.role.requirements,
    roleTitle: kit.role.title,
    hiringContext,
    publicInterviewNotes,
    existingPrompts: preserved.map((q) => q.prompt),
  });

  let nextId =
    Math.max(0, ...kit.questions.map((q) => Number(String(q.id).replace(/\D/g, "")) || 0)) + 1;
  const fresh: Question[] = generated.map((g) => ({ ...g, id: `q${nextId++}` }));
  const questions = [...preserved, ...fresh];
  const withCoverage = applyCoverage({ ...kit, questions }, kit.coverage.passes);
  return {
    ...withCoverage,
    schedule: allocateSchedule({
      daysAvailable: kit.schedule.days_available,
      questions,
      requirements: kit.role.requirements,
    }),
  };
}

/** Fill uncovered must-have gaps (same path as second-pass coverage). */
export async function fillCoverageGaps(kit: Kit): Promise<Kit> {
  const uncovered = findUncoveredRequirements(kit.role.requirements, kit.questions, {
    mustOnly: true,
  });
  if (!uncovered.length) {
    return applyCoverage(kit, kit.coverage.passes);
  }

  const gaps = kit.role.requirements.filter((r) => uncovered.includes(r.id));
  const gapQs = await generateGapQuestions({
    gaps,
    roleTitle: kit.role.title,
    existingPrompts: kit.questions.map((q) => q.prompt),
  });

  let nextId =
    Math.max(0, ...kit.questions.map((q) => Number(String(q.id).replace(/\D/g, "")) || 0)) + 1;
  const fresh: Question[] = gapQs.map((g) => {
    const ids = g.requirement_ids.filter((id) => uncovered.includes(id));
    return {
      ...g,
      requirement_ids: ids.length ? ids : gaps[0] ? [gaps[0].id] : [],
      id: `q${nextId++}`,
    };
  });

  const questions = [...kit.questions, ...fresh];
  return repairKitIntegrity(
    applyCoverage({ ...kit, questions }, kit.coverage.passes + 1),
    { reallocateSchedule: true }
  );
}
