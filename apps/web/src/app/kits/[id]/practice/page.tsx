"use client";

import { Suspense } from "react";
import PracticeInner from "./PracticeInner";

export default function PracticePage() {
  return (
    <Suspense fallback={<p className="text-ink-700">Loading practice…</p>}>
      <PracticeInner />
    </Suspense>
  );
}
