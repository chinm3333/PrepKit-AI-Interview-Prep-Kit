import { Router } from "express";
import { z } from "zod";
import {
  allocateSchedule,
  applyCoverage,
  fillCoverageGaps,
  generateKit,
  regenerateSection,
  repairKitIntegrity,
  validateKitStructure,
  type Kit,
  type QuestionCategory,
} from "@trao/pipeline";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { KitModel } from "../models/Kit.js";
import { hashKitInput } from "./auth.js";

export const kitsRouter = Router();
kitsRouter.use(requireAuth);

const createSchema = z.object({
  jd: z.string().min(1),
  companyUrl: z.string().url(),
  days: z.number().int().min(1).max(60),
  title: z.string().optional(),
});

const batchSchema = z.object({
  cases: z.array(
    z.object({
      jd: z.string().min(1),
      companyUrl: z.string().url(),
      days: z.number().int().min(1).max(60),
      title: z.string().optional(),
    })
  ),
});

kitsRouter.get("/", async (req, res, next) => {
  try {
    const kits = await KitModel.find({ userId: req.user!.id })
      .select("-jd")
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ kits });
  } catch (err) {
    next(err);
  }
});

kitsRouter.get("/:id", async (req, res, next) => {
  try {
    const kit = await KitModel.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
    if (!kit) throw new HttpError(404, "Kit not found", "NOT_FOUND");
    res.json({ kit });
  } catch (err) {
    next(err);
  }
});

kitsRouter.post("/", async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const contentHash = hashKitInput(body.jd, body.companyUrl, body.days);

    const existing = await KitModel.findOne({
      userId: req.user!.id,
      contentHash,
      status: { $in: ["queued", "running", "ready"] },
    });
    if (existing) {
      return res.status(200).json({ kit: existing, deduped: true });
    }

    const doc = await KitModel.create({
      userId: req.user!.id,
      title: body.title || "Generating…",
      jd: body.jd,
      companyUrl: body.companyUrl,
      days: body.days,
      status: "queued",
      progress: [],
      contentHash,
      meta: {
        questionOrigins: {},
        flashcardOrigins: {},
        pinnedQuestionIds: [],
        pinnedFlashcardIds: [],
      },
    });

    void runGeneration(String(doc._id));
    res.status(201).json({ kit: doc, deduped: false });
  } catch (err) {
    next(err);
  }
});

kitsRouter.post("/batch", async (req, res, next) => {
  try {
    const body = batchSchema.parse(req.body);
    const created = [];
    for (const c of body.cases) {
      const contentHash = hashKitInput(c.jd, c.companyUrl, c.days);
      const existing = await KitModel.findOne({
        userId: req.user!.id,
        contentHash,
        status: { $in: ["queued", "running", "ready"] },
      });
      if (existing) {
        created.push(existing);
        continue;
      }
      const doc = await KitModel.create({
        userId: req.user!.id,
        title: c.title || "Generating…",
        jd: c.jd,
        companyUrl: c.companyUrl,
        days: c.days,
        status: "queued",
        progress: [],
        contentHash,
        meta: {
          questionOrigins: {},
          flashcardOrigins: {},
          pinnedQuestionIds: [],
          pinnedFlashcardIds: [],
        },
      });
      void runGeneration(String(doc._id));
      created.push(doc);
    }
    res.status(201).json({ kits: created });
  } catch (err) {
    next(err);
  }
});

kitsRouter.patch("/:id", async (req, res, next) => {
  try {
    const doc = await KitModel.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!doc) throw new HttpError(404, "Kit not found", "NOT_FOUND");
    if (!doc.kit) throw new HttpError(409, "Kit not ready", "NOT_READY");

    const body = z
      .object({
        kit: z.unknown().optional(),
        meta: z.record(z.unknown()).optional(),
        title: z.string().optional(),
      })
      .parse(req.body);

    if (body.title) doc.title = body.title;

    if (body.kit) {
      const scheduleEdited =
        (body.meta && typeof (body.meta as { scheduleEdited?: boolean }).scheduleEdited === "boolean"
          ? (body.meta as { scheduleEdited?: boolean }).scheduleEdited
          : doc.meta.scheduleEdited) === true;

      const repaired = repairKitIntegrity(body.kit as Kit, {
        reallocateSchedule: !scheduleEdited,
      });
      const validated = validateKitStructure(repaired);
      if (!validated.ok) {
        throw new HttpError(400, "Invalid kit structure", "INVALID_KIT", validated.issues);
      }
      doc.kit = validated.kit!;
    }

    if (body.meta) {
      const meta = body.meta as Record<string, unknown>;
      const prevOrigins = mapToRecord(doc.meta.questionOrigins);
      const nextOrigins = mapToRecord(meta.questionOrigins);
      const prevF = mapToRecord(doc.meta.flashcardOrigins);
      const nextF = mapToRecord(meta.flashcardOrigins);

      const mergePins = (incoming: unknown, previous: string[] | undefined) => {
        if (Array.isArray(incoming)) return incoming as string[];
        return previous ?? [];
      };

      doc.meta = {
        ...doc.meta,
        companyBriefEdited:
          typeof meta.companyBriefEdited === "boolean"
            ? meta.companyBriefEdited
            : doc.meta.companyBriefEdited,
        scheduleEdited:
          typeof meta.scheduleEdited === "boolean"
            ? meta.scheduleEdited
            : doc.meta.scheduleEdited,
        questionOrigins: { ...prevOrigins, ...nextOrigins } as never,
        flashcardOrigins: { ...prevF, ...nextF } as never,
        pinnedQuestionIds: mergePins(meta.pinnedQuestionIds, doc.meta.pinnedQuestionIds),
        pinnedFlashcardIds: mergePins(meta.pinnedFlashcardIds, doc.meta.pinnedFlashcardIds),
      } as typeof doc.meta;
    }

    if (doc.kit) {
      const qIds = new Set(doc.kit.questions.map((q) => q.id));
      const fIds = new Set(doc.kit.flashcards.map((f) => f.id));
      doc.meta.pinnedQuestionIds = (doc.meta.pinnedQuestionIds ?? []).filter((id) => qIds.has(id));
      doc.meta.pinnedFlashcardIds = (doc.meta.pinnedFlashcardIds ?? []).filter((id) => fIds.has(id));
      doc.meta.questionOrigins = pruneRecord(mapToRecord(doc.meta.questionOrigins), qIds) as never;
      doc.meta.flashcardOrigins = pruneRecord(mapToRecord(doc.meta.flashcardOrigins), fIds) as never;
    }

    await doc.save();
    res.json({ kit: doc });
  } catch (err) {
    next(err);
  }
});

kitsRouter.post("/:id/regenerate", async (req, res, next) => {
  try {
    const doc = await KitModel.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!doc?.kit) throw new HttpError(404, "Kit not found or not ready", "NOT_FOUND");

    const body = z
      .object({
        section: z.enum(["company_brief", "schedule", "question_category"]),
        category: z
          .enum(["technical", "behavioural", "system-design", "company-fit"])
          .optional(),
      })
      .parse(req.body);

    const pinned = doc.meta?.pinnedQuestionIds ?? [];
    let nextKit: Kit;

    if (body.section === "company_brief") {
      nextKit = await regenerateSection(doc.kit, { type: "company_brief" });
      doc.meta.companyBriefEdited = false;
    } else if (body.section === "schedule") {
      nextKit = await regenerateSection(doc.kit, { type: "schedule" });
      doc.meta.scheduleEdited = false;
    } else {
      if (!body.category) {
        throw new HttpError(400, "category required", "VALIDATION");
      }
      const origins = mapToRecord(doc.meta.questionOrigins);
      const preserveIds = new Set<string>([
        ...pinned,
        ...doc.kit.questions
          .filter((q) => origins[q.id] === "edited" || origins[q.id] === "user")
          .map((q) => q.id),
      ]);
      nextKit = await regenerateSection(
        doc.kit,
        { type: "question_category", category: body.category as QuestionCategory },
        { pinnedQuestionIds: [...preserveIds] }
      );
      const oldIds = new Set(doc.kit.questions.map((q) => q.id));
      for (const q of nextKit.questions) {
        if (!oldIds.has(q.id)) {
          setOrigin(doc, "questionOrigins", q.id, "generated");
        }
      }
    }

    const validated = validateKitStructure(nextKit);
    if (!validated.ok) {
      throw new HttpError(500, "Regenerated kit invalid", "INVALID_KIT", validated.issues);
    }
    doc.kit = validated.kit!;
    await doc.save();
    res.json({ kit: doc });
  } catch (err) {
    next(err);
  }
});

kitsRouter.post("/:id/practice", async (req, res, next) => {
  try {
    const doc = await KitModel.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!doc?.kit) throw new HttpError(404, "Kit not found", "NOT_FOUND");

    const body = z
      .object({
        flashcardId: z.string(),
        confidence: z.number().int().min(1).max(5),
      })
      .parse(req.body);

    const existing = doc.practice.find((p) => p.flashcardId === body.flashcardId);
    if (existing) {
      existing.confidence = body.confidence;
      existing.seenCount += 1;
      existing.lastSeenAt = new Date();
    } else {
      doc.practice.push({
        flashcardId: body.flashcardId,
        confidence: body.confidence,
        seenCount: 1,
        lastSeenAt: new Date(),
      });
    }
    await doc.save();
    res.json({ practice: doc.practice });
  } catch (err) {
    next(err);
  }
});

kitsRouter.get("/:id/practice/next", async (req, res, next) => {
  try {
    const doc = await KitModel.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
    if (!doc?.kit) throw new HttpError(404, "Kit not found", "NOT_FOUND");

    const cards = doc.kit.flashcards ?? [];
    const state = new Map(doc.practice.map((p) => [p.flashcardId, p]));

    const ordered = [...cards].sort((a, b) => {
      const sa = state.get(a.id);
      const sb = state.get(b.id);
      const ca = sa?.confidence ?? 0;
      const cb = sb?.confidence ?? 0;
      if (!sa && sb) return -1;
      if (sa && !sb) return 1;
      if (ca !== cb) return ca - cb;
      const ta = sa?.lastSeenAt ? new Date(sa.lastSeenAt).getTime() : 0;
      const tb = sb?.lastSeenAt ? new Date(sb.lastSeenAt).getTime() : 0;
      return ta - tb;
    });

    const covered = cards.filter((c) => (state.get(c.id)?.seenCount ?? 0) > 0).length;
    res.json({
      orderedIds: ordered.map((c) => c.id),
      cards: ordered,
      covered,
      total: cards.length,
      practice: doc.practice,
    });
  } catch (err) {
    next(err);
  }
});

kitsRouter.post("/:id/fill-gaps", async (req, res, next) => {
  try {
    const doc = await KitModel.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!doc?.kit) throw new HttpError(404, "Kit not found or not ready", "NOT_FOUND");

    const nextKit = await fillCoverageGaps(doc.kit);
    const validated = validateKitStructure(nextKit);
    if (!validated.ok) {
      throw new HttpError(500, "Gap fill produced invalid kit", "INVALID_KIT", validated.issues);
    }

    const oldIds = new Set(doc.kit.questions.map((q) => q.id));
    for (const q of validated.kit!.questions) {
      if (!oldIds.has(q.id)) setOrigin(doc, "questionOrigins", q.id, "generated");
    }

    doc.kit = validated.kit!;
    doc.meta.scheduleEdited = false;
    await doc.save();
    res.json({ kit: doc });
  } catch (err) {
    next(err);
  }
});

kitsRouter.get("/:id/weak-spots", async (req, res, next) => {
  try {
    const doc = await KitModel.findOne({ _id: req.params.id, userId: req.user!.id }).lean();
    if (!doc?.kit) throw new HttpError(404, "Kit not found", "NOT_FOUND");

    const reqById = new Map(doc.kit.role.requirements.map((r) => [r.id, r]));
    const uncovered = (doc.kit.coverage.uncovered_requirement_ids ?? [])
      .map((id) => reqById.get(id))
      .filter(Boolean);

    const practice = new Map(doc.practice.map((p) => [p.flashcardId, p]));
    const weakCards = [...doc.kit.flashcards]
      .map((c) => {
        const s = practice.get(c.id);
        return {
          id: c.id,
          front: c.front,
          confidence: s?.confidence ?? null,
          seenCount: s?.seenCount ?? 0,
          score: s ? s.confidence : 0,
        };
      })
      .sort((a, b) => {
        if (a.seenCount === 0 && b.seenCount > 0) return -1;
        if (b.seenCount === 0 && a.seenCount > 0) return 1;
        return a.score - b.score;
      })
      .slice(0, 8);

    const hardQuestions = [...doc.kit.questions]
      .filter((q) => q.difficulty >= 3)
      .slice(0, 6)
      .map((q) => ({ id: q.id, prompt: q.prompt, category: q.category, difficulty: q.difficulty }));

    res.json({
      uncoveredRequirements: uncovered,
      weakFlashcards: weakCards,
      hardQuestions,
      practiceCovered: doc.practice.filter((p) => p.seenCount > 0).length,
      practiceTotal: doc.kit.flashcards.length,
    });
  } catch (err) {
    next(err);
  }
});

kitsRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await KitModel.deleteOne({ _id: req.params.id, userId: req.user!.id });
    if (!result.deletedCount) throw new HttpError(404, "Kit not found", "NOT_FOUND");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const running = new Set<string>();

async function runGeneration(kitId: string) {
  if (running.has(kitId)) return;
  running.add(kitId);
  try {
    const doc = await KitModel.findById(kitId);
    if (!doc) return;
    doc.status = "running";
    doc.progress = [];
    doc.error = null;
    await doc.save();

    const kit = await generateKit(doc.jd, doc.companyUrl, {
      days: doc.days,
      onProgress: async (event) => {
        await KitModel.updateOne(
          { _id: kitId },
          {
            $push: {
              progress: {
                step: event.step,
                status: event.status,
                detail: event.detail,
                at: new Date(),
              },
            },
          }
        );
      },
    });

    const validated = validateKitStructure(kit);
    if (!validated.ok) {
      throw new Error(validated.issues.map((i) => i.message).join("; "));
    }

    const finalKit = applyCoverage(
      {
        ...validated.kit!,
        schedule: allocateSchedule({
          daysAvailable: validated.kit!.schedule.days_available,
          questions: validated.kit!.questions,
          requirements: validated.kit!.role.requirements,
        }),
      },
      validated.kit!.coverage.passes
    );

    const origins: Record<string, string> = {};
    for (const q of finalKit.questions) origins[q.id] = "generated";
    const fOrigins: Record<string, string> = {};
    for (const f of finalKit.flashcards) fOrigins[f.id] = "generated";

    await KitModel.updateOne(
      { _id: kitId },
      {
        $set: {
          status: "ready",
          kit: finalKit,
          title: `${finalKit.source.company} | ${finalKit.role.title}`,
          "meta.questionOrigins": origins,
          "meta.flashcardOrigins": fOrigins,
          error: null,
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await KitModel.updateOne(
      { _id: kitId },
      {
        $set: {
          status: "failed",
          error: {
            code: /unreachable|ENOTFOUND|Invalid URL/i.test(message)
              ? "COMPANY_UNREACHABLE"
              : "GENERATION_FAILED",
            message,
          },
        },
      }
    );
  } finally {
    running.delete(kitId);
  }
}

function mapToRecord(value: unknown): Record<string, string> {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (typeof value === "object") return value as Record<string, string>;
  return {};
}

function pruneRecord(record: Record<string, string>, keep: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (keep.has(k)) out[k] = v;
  }
  return out;
}

function setOrigin(
  doc: InstanceType<typeof KitModel>,
  field: "questionOrigins" | "flashcardOrigins",
  id: string,
  origin: string
) {
  const current = mapToRecord(doc.meta[field]);
  current[id] = origin;
  doc.meta[field] = current as never;
}
