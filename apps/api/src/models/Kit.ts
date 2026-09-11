import mongoose, { Schema } from "mongoose";
import type { Kit, KitMeta } from "@trao/pipeline";

export type KitStatus = "queued" | "running" | "ready" | "failed";

export interface PracticeCardState {
  flashcardId: string;
  confidence: number; // 1-5
  seenCount: number;
  lastSeenAt?: Date;
}

export interface KitDocument {
  userId: mongoose.Types.ObjectId;
  title: string;
  jd: string;
  companyUrl: string;
  days: number;
  status: KitStatus;
  progress: Array<{ step: string; status: string; detail?: string; at: Date }>;
  error?: { code: string; message: string } | null;
  kit?: Kit | null;
  meta: KitMeta;
  practice: PracticeCardState[];
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const kitSchema = new Schema<KitDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, default: "Untitled kit" },
    jd: { type: String, required: true },
    companyUrl: { type: String, required: true },
    days: { type: Number, required: true },
    status: {
      type: String,
      enum: ["queued", "running", "ready", "failed"],
      default: "queued",
      index: true,
    },
    progress: [
      {
        step: String,
        status: String,
        detail: String,
        at: { type: Date, default: Date.now },
      },
    ],
    error: {
      code: String,
      message: String,
    },
    kit: { type: Schema.Types.Mixed, default: null },
    meta: {
      questionOrigins: { type: Map, of: String, default: {} },
      flashcardOrigins: { type: Map, of: String, default: {} },
      pinnedQuestionIds: { type: [String], default: [] },
      pinnedFlashcardIds: { type: [String], default: [] },
      companyBriefEdited: { type: Boolean, default: false },
      scheduleEdited: { type: Boolean, default: false },
    },
    practice: [
      {
        flashcardId: String,
        confidence: { type: Number, default: 3 },
        seenCount: { type: Number, default: 0 },
        lastSeenAt: Date,
      },
    ],
    contentHash: { type: String, index: true },
  },
  { timestamps: true }
);

kitSchema.index({ userId: 1, contentHash: 1 });

export const KitModel = mongoose.model<KitDocument>("Kit", kitSchema);
