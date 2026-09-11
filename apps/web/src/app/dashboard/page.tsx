"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, KitRecord } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [kits, setKits] = useState<KitRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api("/auth/me");
        const data = await api<{ kits: KitRecord[] }>("/kits");
        if (!cancelled) setKits(data.kits);
      } catch {
        if (!cancelled) router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!kits && !error) {
    return (
      <div className="animate-fade-in py-20 text-center text-ink-600">
        Loading your kits…
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="label-text text-pine">Library</p>
          <h1 className="page-title">Your kits</h1>
          <p className="page-lede">
            Each kit is researched from the company site and shaped around the posting you pasted.
          </p>
        </div>
        <Link href="/kits/new" className="btn-primary">
          New kit
        </Link>
      </div>

      {error && (
        <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      {kits && kits.length === 0 && (
        <div className="mt-14 animate-fade-up-delay border-y border-ink-900/10 py-16 text-center">
          <p className="font-display text-3xl text-ink-950">Nothing here yet</p>
          <p className="mx-auto mt-3 max-w-md text-ink-700">
            Paste a job description and company URL | PrepKit crawls, extracts, and builds your schedule.
          </p>
          <Link href="/kits/new" className="btn-primary mt-8">
            Create your first kit
          </Link>
        </div>
      )}

      <ul className="mt-12 divide-y divide-ink-900/10 border-y border-ink-900/10">
        {kits?.map((k, i) => (
          <li
            key={k._id}
            className="animate-fade-up"
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
          >
            <Link
              href={`/kits/${k._id}`}
              className="focus-ring group flex flex-col gap-3 py-5 transition hover:bg-white/40 sm:flex-row sm:items-center sm:justify-between sm:px-2"
            >
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold tracking-tight text-ink-950 group-hover:text-pine">
                  {k.title}
                </p>
                <p className="mt-0.5 truncate text-sm text-ink-600">{k.companyUrl}</p>
              </div>
              <StatusBadge status={k.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: KitRecord["status"] }) {
  const styles: Record<string, string> = {
    ready: "bg-pine-wash text-pine-deep",
    running: "bg-amber-100 text-amber-950",
    queued: "bg-mist-200 text-ink-800",
    failed: "bg-red-100 text-red-900",
  };
  return (
    <span className={`status-chip shrink-0 ${styles[status]}`}>
      {status === "running" ? "generating" : status}
    </span>
  );
}
