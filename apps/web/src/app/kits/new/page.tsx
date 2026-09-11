"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, KitRecord } from "@/lib/api";

type Pair = { jd: string; companyUrl: string; days: number };

export default function NewKitPage() {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [batchNote, setBatchNote] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ kit: KitRecord }>("/kits", {
        method: "POST",
        json: { jd, companyUrl, days },
      });
      router.push(`/kits/${data.kit._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start generation");
    } finally {
      setLoading(false);
    }
  }

  async function onFile(file: File) {
    setError(null);
    setBatchNote(null);
    try {
      const text = await file.text();
      let pairs: Pair[] = [];
      if (file.name.endsWith(".json")) {
        const parsed = JSON.parse(text) as Array<{
          jd?: string;
          company_url?: string;
          companyUrl?: string;
          days?: number;
        }>;
        pairs = parsed.map((p) => ({
          jd: p.jd ?? "",
          companyUrl: p.companyUrl ?? p.company_url ?? "",
          days: p.days ?? days,
        }));
      } else {
        pairs = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line) => {
            const [a, b, c] = line.split(/\t|,/).map((s) => s.trim());
            return { jd: a, companyUrl: b, days: Number(c) || days };
          });
      }
      pairs = pairs.filter((p) => p.jd && p.companyUrl);
      if (!pairs.length) throw new Error("No valid pairs found in file");

      const data = await api<{ kits: KitRecord[] }>("/kits/batch", {
        method: "POST",
        json: { cases: pairs },
      });
      setBatchNote(`Started ${data.kits.length} kit(s). Opening the first…`);
      router.push(`/kits/${data.kits[0]._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch upload failed");
    }
  }

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <p className="label-text text-pine">Create</p>
      <h1 className="page-title">New prep kit</h1>
      <p className="page-lede">
        Paste the posting and company site. We crawl, extract requirements, and build a day-by-day kit.
      </p>

      <form onSubmit={onSubmit} className="mt-10 space-y-6">
        <label className="block">
          <span className="label-text">Job description</span>
          <textarea
            className="input-field min-h-52 resize-y leading-relaxed"
            required
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste the full posting…"
          />
        </label>
        <div className="grid gap-6 sm:grid-cols-[1fr_7rem]">
          <label className="block">
            <span className="label-text">Company website</span>
            <input
              className="input-field"
              type="url"
              required
              placeholder="https://company.com"
              value={companyUrl}
              onChange={(e) => setCompanyUrl(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label-text">Days</span>
            <input
              className="input-field"
              type="number"
              min={1}
              max={60}
              required
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}
        {batchNote && <p className="text-sm font-medium text-pine-deep">{batchNote}</p>}

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Starting research…" : "Generate kit"}
        </button>
      </form>

      <div className="mt-14 border-t border-ink-900/10 pt-10">
        <h2 className="font-display text-3xl tracking-tight text-ink-950">Batch upload</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-700">
          JSON like the evaluate cases file, or TSV/CSV of jd, company_url, days.
        </p>
        <label className="mt-5 block">
          <span className="label-text">File</span>
          <input
            className="input-field cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-ink-950 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-mist-50"
            type="file"
            accept=".json,.csv,.tsv,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </label>
      </div>
    </div>
  );
}
