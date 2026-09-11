"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ token: string }>("/auth/register", {
        method: "POST",
        json: { email, password, name },
      });
      setToken(data.token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="-mx-4 -my-8 flex min-h-[calc(100vh-0px)] flex-col sm:-mx-6 sm:-my-10">
      <div className="relative flex flex-1 flex-col justify-center px-6 py-16 sm:px-10">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute right-0 top-10 h-64 w-64 rounded-full bg-pine/12 blur-3xl" />
        </div>
        <div className="relative mx-auto w-full max-w-md animate-fade-up">
          <p className="font-display text-5xl tracking-tight text-ink-950 sm:text-6xl">
            Join PrepKit
          </p>
          <p className="page-lede">Your kits stay private. Start with one posting.</p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5">
            <label className="block">
              <span className="label-text">Name</span>
              <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block">
              <span className="label-text">Email</span>
              <input
                className="input-field"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label-text">Password · min 8</span>
              <input
                className="input-field"
                type="password"
                minLength={8}
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
              {loading ? "Creating…" : "Create account"}
            </button>
          </form>
          <p className="mt-6 text-sm text-ink-700">
            Already registered?{" "}
            <Link href="/login" className="font-semibold text-pine underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
