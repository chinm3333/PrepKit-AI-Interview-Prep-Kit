"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, KitPayload, KitRecord } from "@/lib/api";

const CATEGORIES = ["technical", "behavioural", "system-design", "company-fit"] as const;
type Tab = "brief" | "role" | "questions" | "flashcards" | "schedule" | "weakspots";

type WeakSpots = {
  uncoveredRequirements: Array<{ id: string; text: string; priority: string; kind: string }>;
  weakFlashcards: Array<{
    id: string;
    front: string;
    confidence: number | null;
    seenCount: number;
  }>;
  hardQuestions: Array<{ id: string; prompt: string; category: string; difficulty: number }>;
  practiceCovered: number;
  practiceTotal: number;
};

export default function KitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [record, setRecord] = useState<KitRecord | null>(null);
  const [tab, setTab] = useState<Tab>("brief");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [regenBusy, setRegenBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<KitPayload | null>(null);
  const [weak, setWeak] = useState<WeakSpots | null>(null);
  const draftRef = useRef<KitPayload | null>(null);
  draftRef.current = draft;

  const load = useCallback(async () => {
    const data = await api<{ kit: KitRecord }>(`/kits/${id}`);
    setRecord(data.kit);
    if (data.kit.kit) setDraft(structuredClone(data.kit.kit));
  }, [id]);

  const loadWeak = useCallback(async () => {
    try {
      setWeak(await api<WeakSpots>(`/kits/${id}/weak-spots`));
    } catch {
      /* ignore */
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api("/auth/me");
        await load();
      } catch {
        if (!cancelled) router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, router]);

  useEffect(() => {
    if (!record || (record.status !== "queued" && record.status !== "running")) return;
    const t = setInterval(() => void load().catch(() => undefined), 2000);
    return () => clearInterval(t);
  }, [record?.status, load]);

  useEffect(() => {
    if (record?.status === "ready") void loadWeak();
  }, [record?.status, record?.updatedAt, loadWeak]);

  const pinned = useMemo(
    () => new Set(record?.meta?.pinnedQuestionIds ?? []),
    [record?.meta?.pinnedQuestionIds]
  );
  const pinnedCards = useMemo(
    () => new Set(record?.meta?.pinnedFlashcardIds ?? []),
    [record?.meta?.pinnedFlashcardIds]
  );

  async function persist(next: KitPayload, metaPatch?: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ kit: KitRecord }>(`/kits/${id}`, {
        method: "PATCH",
        json: { kit: next, meta: metaPatch },
      });
      setRecord(data.kit);
      if (data.kit.kit) setDraft(structuredClone(data.kit.kit));
      void loadWeak();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function regenerate(
    section: "company_brief" | "schedule" | "question_category",
    category?: string
  ) {
    setRegenBusy(section + (category ?? ""));
    setError(null);
    try {
      const data = await api<{ kit: KitRecord }>(`/kits/${id}/regenerate`, {
        method: "POST",
        json: { section, category },
      });
      setRecord(data.kit);
      if (data.kit.kit) setDraft(structuredClone(data.kit.kit));
      void loadWeak();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setRegenBusy(null);
    }
  }

  async function fillGaps() {
    setRegenBusy("fill-gaps");
    setError(null);
    try {
      const data = await api<{ kit: KitRecord }>(`/kits/${id}/fill-gaps`, { method: "POST" });
      setRecord(data.kit);
      if (data.kit.kit) setDraft(structuredClone(data.kit.kit));
      void loadWeak();
      setTab("questions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gap fill failed");
    } finally {
      setRegenBusy(null);
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "brief", label: "Company brief" },
    { key: "role", label: "Role" },
    { key: "questions", label: "Questions" },
    { key: "flashcards", label: "Flashcards" },
    { key: "schedule", label: "Schedule" },
    { key: "weakspots", label: "Weak spots" },
  ];

  function onTabKey(e: React.KeyboardEvent) {
    const keys = tabs.map((t) => t.key);
    const i = keys.indexOf(tab);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setTab(keys[(i + 1) % keys.length]);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setTab(keys[(i - 1 + keys.length) % keys.length]);
    }
  }

  if (!record) return <p className="text-ink-700">Loading kit…</p>;
  if (record.status === "queued" || record.status === "running") {
    return <ProgressView record={record} />;
  }
  if (record.status === "failed") {
    return (
      <div className="animate-fade-up border-y border-red-200/80 bg-red-50/80 py-12">
        <h1 className="font-display text-4xl text-red-950">Generation failed</h1>
        <p className="mt-3 max-w-xl text-red-900/90">
          {record.error?.message ?? "Something went wrong."}
        </p>
        <Link href="/kits/new" className="btn-primary mt-8 bg-ink-950 hover:bg-ink-900">
          Try another kit
        </Link>
      </div>
    );
  }
  if (!draft) return <p className="text-ink-700">Kit has no payload.</p>;

  const needsAttention =
    weak &&
    (weak.uncoveredRequirements.length > 0 ||
      weak.weakFlashcards.some((c) => c.seenCount === 0 || (c.confidence ?? 5) <= 2));

  const weakestCardId = weak?.weakFlashcards[0]?.id;

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="label-text text-pine">Prep kit</p>
          <h1 className="page-title break-words">{record.title}</h1>
          <p className="mt-3 text-ink-700">
            {draft.source.company}
            {draft.source.location ? ` · ${draft.source.location}` : ""} ·{" "}
            {draft.schedule.days_available} days · passes {draft.coverage.passes}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/kits/${id}/practice${weakestCardId ? `?focus=${weakestCardId}` : ""}`}
            className="btn-primary bg-ink-950 hover:bg-ink-900"
          >
            Practice flashcards
          </Link>
          <span className="text-xs font-medium text-ink-500" aria-live="polite">
            {saving ? "Saving…" : ""}
          </span>
        </div>
      </div>

      {needsAttention && (
        <button
          type="button"
          onClick={() => setTab("weakspots")}
          className="focus-ring mt-8 w-full border border-amber-300/70 bg-amber-50/90 px-5 py-4 text-left transition hover:bg-amber-50"
        >
          <span className="text-sm font-semibold text-amber-950">Weak spots need attention</span>
          <span className="mt-1 block text-sm text-amber-900/80">
            {weak!.uncoveredRequirements.length} uncovered must-have
            {weak!.uncoveredRequirements.length === 1 ? "" : "s"}
            {" · "}
            practice {weak!.practiceCovered}/{weak!.practiceTotal} | open report
          </span>
        </button>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <div
        className="mt-10 flex flex-wrap gap-1.5 border-b border-ink-900/10 pb-3"
        role="tablist"
        aria-label="Kit sections"
        onKeyDown={onTabKey}
      >
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            className={`tab-btn ${tab === key ? "tab-btn-active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "brief" && (
          <section role="tabpanel" id="panel-brief" aria-labelledby="tab-brief" className="space-y-4">
            <div className="flex justify-between gap-2">
              <h2 className="font-display text-2xl">Company brief</h2>
              <button
                type="button"
                className="btn-secondary disabled:opacity-50"
                disabled={!!regenBusy}
                onClick={() => void regenerate("company_brief")}
              >
                {regenBusy === "company_brief" ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
            <Field
              label="Summary"
              value={draft.company_brief.summary}
              multiline
              onChange={(v) =>
                setDraft({ ...draft, company_brief: { ...draft.company_brief, summary: v } })
              }
              onCommit={(v) =>
                void persist(
                  { ...draftRef.current!, company_brief: { ...draftRef.current!.company_brief, summary: v } },
                  { companyBriefEdited: true }
                )
              }
            />
            <Field
              label="What they do"
              value={draft.company_brief.what_they_do}
              multiline
              onChange={(v) =>
                setDraft({
                  ...draft,
                  company_brief: { ...draft.company_brief, what_they_do: v },
                })
              }
              onCommit={(v) =>
                void persist(
                  {
                    ...draftRef.current!,
                    company_brief: { ...draftRef.current!.company_brief, what_they_do: v },
                  },
                  { companyBriefEdited: true }
                )
              }
            />
          </section>
        )}

        {tab === "role" && (
          <RolePanel draft={draft} setDraft={setDraft} onPersist={persist} />
        )}

        {tab === "questions" && (
          <QuestionsPanel
            draft={draft}
            pinned={pinned}
            regenBusy={regenBusy}
            onDraft={setDraft}
            onPersist={persist}
            onRegenerateCategory={(cat) => void regenerate("question_category", cat)}
          />
        )}

        {tab === "flashcards" && (
          <FlashcardsPanel
            draft={draft}
            pinnedCards={pinnedCards}
            onDraft={setDraft}
            onPersist={persist}
          />
        )}

        {tab === "schedule" && (
          <SchedulePanel
            draft={draft}
            regenBusy={regenBusy}
            onDraft={setDraft}
            onPersist={persist}
            onRebuild={() => void regenerate("schedule")}
            onJumpQuestions={() => setTab("questions")}
          />
        )}

        {tab === "weakspots" && (
          <section role="tabpanel" id="panel-weakspots" aria-labelledby="tab-weakspots" className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl">Weak spots</h2>
                <p className="mt-1 text-sm text-ink-700">
                  Uncovered must-haves and low-confidence cards | act on them here.
                </p>
              </div>
              {weak && weak.uncoveredRequirements.length > 0 && (
                <button
                  type="button"
                  className="btn-primary disabled:opacity-50"
                  disabled={!!regenBusy}
                  onClick={() => void fillGaps()}
                >
                  {regenBusy === "fill-gaps" ? "Filling gaps…" : "Generate missing questions"}
                </button>
              )}
            </div>
            {!weak ? (
              <p className="text-ink-700">Loading report…</p>
            ) : (
              <>
                <div>
                  <h3 className="text-sm font-medium uppercase tracking-wide text-ink-700">
                    Uncovered must-haves
                  </h3>
                  {weak.uncoveredRequirements.length === 0 ? (
                    <p className="mt-2 text-sm text-teal-800">All must-haves have a question.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {weak.uncoveredRequirements.map((r) => (
                        <li key={r.id} className="rounded-lg bg-amber-50 px-3 py-2 text-sm">
                          <code className="text-xs">{r.id}</code> {r.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-medium uppercase tracking-wide text-ink-700">
                    Flashcards to drill ({weak.practiceCovered}/{weak.practiceTotal})
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {weak.weakFlashcards.map((c) => (
                      <li key={c.id} className="rounded-lg bg-white/70 px-3 py-2 text-sm">
                        <Link
                          href={`/kits/${id}/practice?focus=${c.id}`}
                          className="focus-ring font-medium text-pine underline-offset-2 hover:underline"
                        >
                          {c.front}
                        </Link>
                        <span className="ml-2 text-xs text-ink-700">
                          {c.seenCount === 0
                            ? "unseen"
                            : `confidence ${c.confidence}/5 · seen ${c.seenCount}×`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-medium uppercase tracking-wide text-ink-700">
                    Hard questions
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {weak.hardQuestions.map((q) => (
                      <li key={q.id} className="rounded-lg bg-white/70 px-3 py-2 text-sm">
                        <button
                          type="button"
                          className="focus-ring text-left"
                          onClick={() => setTab("questions")}
                        >
                          <code className="text-xs">{q.id}</code> [{q.category}] {q.prompt}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ProgressView({ record }: { record: KitRecord }) {
  const steps = record.progress ?? [];
  return (
    <div className="animate-fade-up">
      <p className="label-text text-pine">Working</p>
      <h1 className="page-title">Building your kit</h1>
      <p className="page-lede">
        Research and generation run as a sequence. This view updates as each step finishes.
      </p>
      <div className="surface mt-10 overflow-hidden">
        <div className="h-1 w-full bg-mist-200">
          <div
            className="shimmer-bar h-full transition-all duration-500"
            style={{ width: `${Math.min(95, 10 + steps.length * 7)}%` }}
          />
        </div>
        <ul className="divide-y divide-ink-900/[0.06]">
          {steps.length === 0 && (
            <li className="px-6 py-5 text-ink-600">Queued | waiting to start…</li>
          )}
          {steps.map((s, i) => (
            <li
              key={`${s.step}-${i}`}
              className="flex items-start gap-4 px-6 py-4 animate-fade-in"
            >
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-sm ${
                  s.status === "done"
                    ? "bg-pine"
                    : s.status === "error"
                      ? "bg-red-500"
                      : s.status === "skipped"
                        ? "bg-ink-500"
                        : "bg-amber-400 animate-pulse-line"
                }`}
                aria-hidden
              />
              <div>
                <p className="text-sm font-semibold capitalize text-ink-950">
                  {s.step.replace(/_/g, " ")}
                </p>
                {s.detail && <p className="mt-0.5 text-sm text-ink-600">{s.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onCommit,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  multiline?: boolean;
}) {
  const initial = useRef(value);
  useEffect(() => {
    initial.current = value;
    // only sync when switching fields/items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);
  const cls = "input-field";
  return (
    <label className="block text-sm">
      <span className="label-text">{label}</span>
      {multiline ? (
        <textarea
          className={`${cls} min-h-28 leading-relaxed`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            initial.current = value;
          }}
          onBlur={(e) => {
            if (e.target.value !== initial.current) onCommit(e.target.value);
          }}
        />
      ) : (
        <input
          className={cls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            initial.current = value;
          }}
          onBlur={(e) => {
            if (e.target.value !== initial.current) onCommit(e.target.value);
          }}
        />
      )}
    </label>
  );
}

function RolePanel({
  draft,
  setDraft,
  onPersist,
}: {
  draft: KitPayload;
  setDraft: (k: KitPayload) => void;
  onPersist: (k: KitPayload, meta?: Record<string, unknown>) => void;
}) {
  return (
    <section role="tabpanel" id="panel-role" aria-labelledby="tab-role" className="space-y-4">
      <Field
        label="Title"
        value={draft.role.title}
        onChange={(v) => setDraft({ ...draft, role: { ...draft.role, title: v } })}
        onCommit={(v) =>
          void onPersist({ ...draft, role: { ...draft.role, title: v }, source: { ...draft.source, role: v } })
        }
      />
      <Field
        label="Seniority"
        value={draft.role.seniority}
        onChange={(v) => setDraft({ ...draft, role: { ...draft.role, seniority: v } })}
        onCommit={(v) => void onPersist({ ...draft, role: { ...draft.role, seniority: v } })}
      />
      <div>
        <h3 className="text-sm font-medium uppercase tracking-wide text-ink-700">Responsibilities</h3>
        <ul className="mt-2 space-y-2">
          {draft.role.responsibilities.map((r, i) => (
            <li key={i}>
              <Field
                label={`#${i + 1}`}
                value={r}
                onChange={(v) => {
                  const responsibilities = [...draft.role.responsibilities];
                  responsibilities[i] = v;
                  setDraft({ ...draft, role: { ...draft.role, responsibilities } });
                }}
                onCommit={(v) => {
                  const responsibilities = [...draft.role.responsibilities];
                  responsibilities[i] = v;
                  void onPersist({ ...draft, role: { ...draft.role, responsibilities } });
                }}
              />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-medium uppercase tracking-wide text-ink-700">Requirements</h3>
        <ul className="mt-3 space-y-3">
          {draft.role.requirements.map((r) => (
            <li key={r.id} className="rounded-lg bg-white/60 px-3 py-3">
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <code>{r.id}</code>
                <select
                  className="focus-ring rounded border border-ink-900/15 bg-white px-2 py-1"
                  value={r.priority}
                  onChange={(e) => {
                    const requirements = draft.role.requirements.map((x) =>
                      x.id === r.id ? { ...x, priority: e.target.value } : x
                    );
                    const next = { ...draft, role: { ...draft.role, requirements } };
                    setDraft(next);
                    void onPersist(next);
                  }}
                >
                  <option value="must">must</option>
                  <option value="nice">nice</option>
                </select>
                <select
                  className="focus-ring rounded border border-ink-900/15 bg-white px-2 py-1"
                  value={r.kind}
                  onChange={(e) => {
                    const requirements = draft.role.requirements.map((x) =>
                      x.id === r.id ? { ...x, kind: e.target.value } : x
                    );
                    const next = { ...draft, role: { ...draft.role, requirements } };
                    setDraft(next);
                    void onPersist(next);
                  }}
                >
                  <option value="technical">technical</option>
                  <option value="behavioural">behavioural</option>
                  <option value="domain">domain</option>
                </select>
              </div>
              <Field
                label="Text"
                value={r.text}
                onChange={(v) => {
                  const requirements = draft.role.requirements.map((x) =>
                    x.id === r.id ? { ...x, text: v } : x
                  );
                  setDraft({ ...draft, role: { ...draft.role, requirements } });
                }}
                onCommit={(v) => {
                  const requirements = draft.role.requirements.map((x) =>
                    x.id === r.id ? { ...x, text: v } : x
                  );
                  void onPersist({ ...draft, role: { ...draft.role, requirements } });
                }}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function QuestionsPanel({
  draft,
  pinned,
  regenBusy,
  onDraft,
  onPersist,
  onRegenerateCategory,
}: {
  draft: KitPayload;
  pinned: Set<string>;
  regenBusy: string | null;
  onDraft: (k: KitPayload) => void;
  onPersist: (k: KitPayload, meta?: Record<string, unknown>) => void;
  onRegenerateCategory: (c: string) => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const visible = draft.questions.filter((q) => filter === "all" || q.category === filter);

  function commit(questions: KitPayload["questions"], meta?: Record<string, unknown>) {
    const next = { ...draft, questions };
    onDraft(next);
    void onPersist(next, meta);
  }

  function moveVisible(id: string, dir: -1 | 1) {
    const ids = visible.map((q) => q.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const a = ids[i];
    const b = ids[j];
    const ia = draft.questions.findIndex((q) => q.id === a);
    const ib = draft.questions.findIndex((q) => q.id === b);
    const questions = [...draft.questions];
    [questions[ia], questions[ib]] = [questions[ib], questions[ia]];
    commit(questions);
  }

  function addQuestion() {
    const n =
      Math.max(0, ...draft.questions.map((q) => Number(String(q.id).replace(/\D/g, "")) || 0)) + 1;
    const q = {
      id: `q${n}`,
      requirement_ids: draft.role.requirements[0] ? [draft.role.requirements[0].id] : [],
      category: "technical" as const,
      prompt: "New question",
      answer_outline: "",
      difficulty: 2 as const,
    };
    commit([...draft.questions, q], {
      questionOrigins: { [q.id]: "user" },
      pinnedQuestionIds: [...pinned, q.id],
    });
  }

  return (
    <section role="tabpanel" id="panel-questions" aria-labelledby="tab-questions" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-2xl">Question bank</h2>
        <button type="button" className="btn-primary" onClick={addQuestion}>
          Add question
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`focus-ring rounded-md px-2.5 py-1 text-xs ${filter === "all" ? "bg-ink-900 text-white" : "bg-white/70"}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <div key={c} className="flex items-center gap-1">
            <button
              type="button"
              className={`focus-ring rounded-md px-2.5 py-1 text-xs ${filter === c ? "bg-ink-900 text-white" : "bg-white/70"}`}
              onClick={() => setFilter(c)}
            >
              {c}
            </button>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-50"
              disabled={!!regenBusy}
              onClick={() => onRegenerateCategory(c)}
              title={`Regenerate ${c}`}
            >
              Regenerate
            </button>
          </div>
        ))}
      </div>
      <ul className="space-y-3">
        {visible.map((q) => (
          <li key={q.id} className="surface-quiet p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <code>{q.id}</code>
              <select
                className="focus-ring rounded border border-ink-900/15 bg-white px-2 py-1"
                value={q.category}
                onChange={(e) => {
                  const questions = draft.questions.map((x) =>
                    x.id === q.id ? { ...x, category: e.target.value } : x
                  );
                  commit(questions, { questionOrigins: { [q.id]: "edited" } });
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1">
                diff
                <select
                  className="focus-ring rounded border border-ink-900/15 bg-white px-2 py-1"
                  value={q.difficulty}
                  onChange={(e) => {
                    const difficulty = Number(e.target.value) as 1 | 2 | 3;
                    const questions = draft.questions.map((x) =>
                      x.id === q.id ? { ...x, difficulty } : x
                    );
                    commit(questions, { questionOrigins: { [q.id]: "edited" } });
                  }}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              {pinned.has(q.id) && <span className="text-pine-deep">pinned</span>}
              <div className="ml-auto flex gap-1">
                <button type="button" className="focus-ring px-2" onClick={() => moveVisible(q.id, -1)} aria-label="Move up">
                  ↑
                </button>
                <button type="button" className="focus-ring px-2" onClick={() => moveVisible(q.id, 1)} aria-label="Move down">
                  ↓
                </button>
                <button
                  type="button"
                  className="focus-ring px-2"
                  onClick={() => {
                    const set = new Set(pinned);
                    if (set.has(q.id)) set.delete(q.id);
                    else set.add(q.id);
                    void onPersist(draft, { pinnedQuestionIds: [...set] });
                  }}
                >
                  Pin
                </button>
                <button
                  type="button"
                  className="focus-ring px-2 text-red-700"
                  onClick={() =>
                    commit(
                      draft.questions.filter((x) => x.id !== q.id),
                      { pinnedQuestionIds: [...pinned].filter((p) => p !== q.id) }
                    )
                  }
                >
                  Delete
                </button>
              </div>
            </div>
            <p className="mb-1 text-xs font-medium text-ink-700">Covers requirements</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {draft.role.requirements.map((r) => {
                const on = q.requirement_ids.includes(r.id);
                return (
                  <label key={r.id} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const requirement_ids = on
                          ? q.requirement_ids.filter((id) => id !== r.id)
                          : [...q.requirement_ids, r.id];
                        const questions = draft.questions.map((x) =>
                          x.id === q.id ? { ...x, requirement_ids } : x
                        );
                        commit(questions, { questionOrigins: { [q.id]: "edited" } });
                      }}
                    />
                    {r.id}
                  </label>
                );
              })}
            </div>
            <Field
              label="Prompt"
              value={q.prompt}
              multiline
              onChange={(v) =>
                onDraft({
                  ...draft,
                  questions: draft.questions.map((x) => (x.id === q.id ? { ...x, prompt: v } : x)),
                })
              }
              onCommit={(v) => {
                const questions = draft.questions.map((x) =>
                  x.id === q.id ? { ...x, prompt: v } : x
                );
                commit(questions, {
                  questionOrigins: { [q.id]: "edited" },
                  pinnedQuestionIds: [...new Set([...pinned, q.id])],
                });
              }}
            />
            <div className="mt-2">
              <Field
                label="Answer outline"
                value={q.answer_outline}
                multiline
                onChange={(v) =>
                  onDraft({
                    ...draft,
                    questions: draft.questions.map((x) =>
                      x.id === q.id ? { ...x, answer_outline: v } : x
                    ),
                  })
                }
                onCommit={(v) => {
                  const questions = draft.questions.map((x) =>
                    x.id === q.id ? { ...x, answer_outline: v } : x
                  );
                  commit(questions, {
                    questionOrigins: { [q.id]: "edited" },
                    pinnedQuestionIds: [...new Set([...pinned, q.id])],
                  });
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FlashcardsPanel({
  draft,
  pinnedCards,
  onDraft,
  onPersist,
}: {
  draft: KitPayload;
  pinnedCards: Set<string>;
  onDraft: (k: KitPayload) => void;
  onPersist: (k: KitPayload, meta?: Record<string, unknown>) => void;
}) {
  function commit(flashcards: KitPayload["flashcards"], meta?: Record<string, unknown>) {
    const next = { ...draft, flashcards };
    onDraft(next);
    void onPersist(next, meta);
  }

  return (
    <section role="tabpanel" id="panel-flashcards" aria-labelledby="tab-flashcards" className="space-y-4">
      <div className="flex justify-between">
        <h2 className="font-display text-2xl">Flashcards</h2>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            const n =
              Math.max(
                0,
                ...draft.flashcards.map((f) => Number(String(f.id).replace(/\D/g, "")) || 0)
              ) + 1;
            const card = {
              id: `f${n}`,
              front: "Front",
              back: "Back",
              requirement_ids: draft.role.requirements[0] ? [draft.role.requirements[0].id] : [],
            };
            commit([...draft.flashcards, card], {
              flashcardOrigins: { [card.id]: "user" },
              pinnedFlashcardIds: [...pinnedCards, card.id],
            });
          }}
        >
          Add card
        </button>
      </div>
      <ul className="space-y-3">
        {draft.flashcards.map((f) => (
          <li key={f.id} className="surface-quiet p-4">
            <div className="mb-2 flex gap-2 text-xs">
              <code>{f.id}</code>
              {pinnedCards.has(f.id) && <span className="text-pine-deep">pinned</span>}
              <button
                type="button"
                className="focus-ring ml-auto px-2"
                onClick={() => {
                  const set = new Set(pinnedCards);
                  if (set.has(f.id)) set.delete(f.id);
                  else set.add(f.id);
                  void onPersist(draft, { pinnedFlashcardIds: [...set] });
                }}
              >
                Pin
              </button>
              <button
                type="button"
                className="focus-ring px-2 text-red-700"
                onClick={() =>
                  commit(
                    draft.flashcards.filter((x) => x.id !== f.id),
                    { pinnedFlashcardIds: [...pinnedCards].filter((p) => p !== f.id) }
                  )
                }
              >
                Delete
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field
                label="Front"
                value={f.front}
                multiline
                onChange={(v) =>
                  onDraft({
                    ...draft,
                    flashcards: draft.flashcards.map((x) =>
                      x.id === f.id ? { ...x, front: v } : x
                    ),
                  })
                }
                onCommit={(v) => {
                  const flashcards = draft.flashcards.map((x) =>
                    x.id === f.id ? { ...x, front: v } : x
                  );
                  commit(flashcards, {
                    flashcardOrigins: { [f.id]: "edited" },
                    pinnedFlashcardIds: [...new Set([...pinnedCards, f.id])],
                  });
                }}
              />
              <Field
                label="Back"
                value={f.back}
                multiline
                onChange={(v) =>
                  onDraft({
                    ...draft,
                    flashcards: draft.flashcards.map((x) =>
                      x.id === f.id ? { ...x, back: v } : x
                    ),
                  })
                }
                onCommit={(v) => {
                  const flashcards = draft.flashcards.map((x) =>
                    x.id === f.id ? { ...x, back: v } : x
                  );
                  commit(flashcards, {
                    flashcardOrigins: { [f.id]: "edited" },
                    pinnedFlashcardIds: [...new Set([...pinnedCards, f.id])],
                  });
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SchedulePanel({
  draft,
  regenBusy,
  onDraft,
  onPersist,
  onRebuild,
  onJumpQuestions,
}: {
  draft: KitPayload;
  regenBusy: string | null;
  onDraft: (k: KitPayload) => void;
  onPersist: (k: KitPayload, meta?: Record<string, unknown>) => void;
  onRebuild: () => void;
  onJumpQuestions: () => void;
}) {
  function updateDay(day: number, patch: Partial<KitPayload["schedule"]["days"][0]>) {
    const days = draft.schedule.days.map((d) => (d.day === day ? { ...d, ...patch } : d));
    const next = { ...draft, schedule: { ...draft.schedule, days } };
    onDraft(next);
    return next;
  }

  return (
    <section role="tabpanel" id="panel-schedule" aria-labelledby="tab-schedule" className="space-y-4">
      <div className="flex justify-between gap-2">
        <h2 className="font-display text-2xl">Study schedule</h2>
        <button
          type="button"
          className="btn-secondary disabled:opacity-50"
          disabled={!!regenBusy}
          onClick={onRebuild}
        >
          {regenBusy === "schedule" ? "Rebuilding…" : "Rebuild schedule"}
        </button>
      </div>
      <ol className="space-y-3">
        {draft.schedule.days.map((d) => (
          <li key={d.day} className="surface-quiet px-4 py-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Field
                label={`Day ${d.day} focus`}
                value={d.focus}
                onChange={(v) => updateDay(d.day, { focus: v })}
                onCommit={(v) =>
                  void onPersist(updateDay(d.day, { focus: v }), { scheduleEdited: true })
                }
              />
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-ink-800">Minutes</span>
                <input
                  type="number"
                  min={0}
                  className="focus-ring w-28 rounded-lg border border-ink-900/15 bg-white/80 px-3 py-2 text-sm"
                  value={d.minutes}
                  onChange={(e) => updateDay(d.day, { minutes: Number(e.target.value) || 0 })}
                  onBlur={(e) =>
                    void onPersist(
                      updateDay(d.day, { minutes: Math.round(Number(e.target.value) || 0) }),
                      { scheduleEdited: true }
                    )
                  }
                />
              </label>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {d.question_ids.map((qid) => {
                const q = draft.questions.find((x) => x.id === qid);
                return (
                  <li key={qid}>
                    <button
                      type="button"
                      className="focus-ring text-left text-pine underline-offset-2 hover:underline"
                      onClick={onJumpQuestions}
                    >
                      <code className="text-xs">{qid}</code>
                      {q ? ` | ${q.prompt.slice(0, 90)}${q.prompt.length > 90 ? "…" : ""}` : ""}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
