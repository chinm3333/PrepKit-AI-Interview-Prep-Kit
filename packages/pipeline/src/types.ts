/** Appendix A | Kit Structure. Field names must match exactly. */

export type RequirementKind = "technical" | "behavioural" | "domain";
export type RequirementPriority = "must" | "nice";
export type QuestionCategory =
  | "technical"
  | "behavioural"
  | "system-design"
  | "company-fit";

export interface KitSource {
  company: string;
  company_url: string;
  role: string;
  location: string;
  jd_chars: number;
  researched_at: string;
  pages_used: string[];
}

export interface CompanyBrief {
  summary: string;
  what_they_do: string;
  sources: string[];
}

export interface Requirement {
  id: string;
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
}

export interface RoleBreakdown {
  title: string;
  seniority: string;
  responsibilities: string[];
  requirements: Requirement[];
}

export interface Question {
  id: string;
  requirement_ids: string[];
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
}

export interface ScheduleDay {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
}

export interface Schedule {
  days_available: number;
  days: ScheduleDay[];
}

export interface Coverage {
  uncovered_requirement_ids: string[];
  passes: number;
}

export interface Kit {
  source: KitSource;
  company_brief: CompanyBrief;
  role: RoleBreakdown;
  questions: Question[];
  flashcards: Flashcard[];
  schedule: Schedule;
  coverage: Coverage;
}

/** Persisted extras for the builder (allowed extensions beyond Appendix A). */
export type ItemOrigin = "generated" | "edited" | "user";

export interface KitMeta {
  questionOrigins?: Record<string, ItemOrigin>;
  flashcardOrigins?: Record<string, ItemOrigin>;
  pinnedQuestionIds?: string[];
  pinnedFlashcardIds?: string[];
  companyBriefEdited?: boolean;
  scheduleEdited?: boolean;
}

export interface GenerationCase {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}

export interface BatchError {
  code: string;
  message: string;
}

export interface BatchKitResult {
  id: string;
  status: "ok" | "failed";
  kit: Kit | null;
  error: BatchError | null;
}

export interface BatchOutput {
  version: "1.0";
  generated_at: string;
  kits: BatchKitResult[];
}

export type ProgressEvent =
  | { step: string; status: "started" | "done" | "skipped" | "error"; detail?: string }
  | { step: "progress"; status: "info"; detail: string };

export interface PipelineOptions {
  days: number;
  onProgress?: (event: ProgressEvent) => void;
  allowPrivateUrls?: boolean;
  maxCoveragePasses?: number;
}
