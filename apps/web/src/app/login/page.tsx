"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ token: string }>("/auth/login", {
        method: "POST",
        json: { email, password },
      });
      setToken(data.token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="-mx-4 -my-8 flex min-h-[calc(100vh-0px)] flex-col sm:-mx-6 sm:-my-10">
      <div className="relative flex flex-1 flex-col justify-center px-6 py-16 sm:px-10">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-pine/10 blur-3xl" />
          <div className="absolute -right-16 bottom-20 h-80 w-80 rounded-full bg-ink-900/5 blur-3xl" />
        </div>

        <div className="relative mx-auto w-full max-w-md animate-fade-up">
          <p className="font-display text-6xl leading-none tracking-tight text-ink-950 sm:text-7xl">
            PrepKit
          </p>
          <p className="page-lede mt-4 animate-fade-up-delay">
            Research the company. Shape the role. Practise what matters before interview day.
          </p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5">
            <label className="block">
              <span className="label-text">Email</span>
              <input
                className="input-field"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label-text">Password</span>
              <input
                className="input-field"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-sm text-ink-700">
            No account?{" "}
            <Link href="/register" className="font-semibold text-pine underline-offset-4 hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
