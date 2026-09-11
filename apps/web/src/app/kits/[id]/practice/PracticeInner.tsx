"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, KitPayload } from "@/lib/api";

type Card = KitPayload["flashcards"][number];

export default function PracticeInner() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const focus = search.get("focus");
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [covered, setCovered] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<{
      cards: Card[];
      covered: number;
      total: number;
    }>(`/kits/${id}/practice/next`);
    let ordered = [...data.cards];
    if (focus) {
      const i = ordered.findIndex((c) => c.id === focus);
      if (i > 0) {
        const [hit] = ordered.splice(i, 1);
        ordered = [hit, ...ordered];
      }
    }
    setCards(ordered);
    setCovered(data.covered);
    setTotal(data.total);
    setIndex(0);
    setFlipped(false);
  }, [id, focus]);

  useEffect(() => {
    (async () => {
      try {
        await api("/auth/me");
        await load();
      } catch {
        router.replace("/login");
      }
    })();
  }, [load, router]);

  const card = cards[index];

  async function rate(confidence: number) {
    if (!card) return;
    try {
      await api(`/kits/${id}/practice`, {
        method: "POST",
        json: { flashcardId: card.id, confidence },
      });
      if (index + 1 >= cards.length) await load();
      else {
        setIndex((i) => i + 1);
        setFlipped(false);
        setCovered((c) => Math.min(total, c + 1));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save confidence");
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
      if (flipped && ["1", "2", "3", "4", "5"].includes(e.key)) void rate(Number(e.key));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, card?.id, index, cards.length]);

  if (!cards.length && total === 0) {
    return (
      <div className="animate-fade-up py-16 text-center">
        <p className="text-ink-700">No flashcards in this kit yet.</p>
        <Link href={`/kits/${id}`} className="btn-ghost mt-4 text-pine">
          Back to kit
        </Link>
      </div>
    );
  }

  if (!card) {
    return <p className="animate-fade-in py-16 text-center text-ink-600">Loading practice…</p>;
  }

  return (
    <div className="mx-auto max-w-xl animate-fade-up">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/kits/${id}`} className="btn-ghost -ml-3 text-pine">
          ← Back to kit
        </Link>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          {covered}/{total} · {index + 1}/{cards.length}
        </p>
      </div>

      <p className="label-text mt-8 text-pine">Practice</p>
      <h1 className="font-display text-4xl tracking-tight text-ink-950">Flashcards</h1>
      <p className="mt-2 text-sm text-ink-700">
        Weakest first{focus ? ` · started on ${focus}` : ""}. Space flips · 1–5 rates.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        className="focus-ring group relative mt-10 flex min-h-64 w-full flex-col items-center justify-center border border-ink-900/10 bg-white/80 px-8 py-12 text-center shadow-lift backdrop-blur-sm transition duration-300 hover:border-pine/30"
        onClick={() => setFlipped((f) => !f)}
        aria-pressed={flipped}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-500 transition group-hover:text-pine">
          {flipped ? "Answer" : "Prompt"} · click or Space
        </span>
        <span className="mt-5 font-display text-3xl leading-snug tracking-tight text-ink-950 sm:text-4xl">
          {flipped ? card.back : card.front}
        </span>
      </button>

      {flipped && (
        <div className="mt-8 animate-fade-up">
          <p className="label-text">Confidence</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className="focus-ring min-w-[3rem] rounded-lg border border-ink-900/12 bg-white px-4 py-2.5 text-sm font-semibold transition hover:border-pine hover:bg-pine hover:text-white"
                onClick={() => void rate(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">1 = guessing · 5 = solid</p>
        </div>
      )}
    </div>
  );
}
