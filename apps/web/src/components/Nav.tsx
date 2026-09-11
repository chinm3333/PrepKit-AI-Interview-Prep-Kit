"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const hide = pathname === "/login" || pathname === "/register";
  if (hide) return null;

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setToken(null);
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-ink-900/[0.07] bg-mist-50/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <Link
          href="/dashboard"
          className="focus-ring group flex items-baseline gap-2 rounded-lg"
        >
          <span className="font-display text-2xl tracking-tight text-ink-950 transition group-hover:text-pine">
            PrepKit
          </span>
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500 sm:inline">
            Interview prep
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            href="/dashboard"
            className={`nav-link ${pathname.startsWith("/dashboard") ? "nav-link-active" : ""}`}
          >
            Kits
          </Link>
          <Link
            href="/kits/new"
            className={`nav-link ${pathname.startsWith("/kits/new") ? "nav-link-active" : ""}`}
          >
            New kit
          </Link>
          <button type="button" onClick={logout} className="btn-ghost ml-1">
            Log out
          </button>
        </nav>
      </div>
    </header>
  );
}
