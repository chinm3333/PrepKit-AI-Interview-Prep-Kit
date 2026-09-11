import * as cheerio from "cheerio";
import robotsParserImport from "robots-parser";
import { RateLimiter, withRetry } from "../util/retry.js";
import {
  assertPublicResolvedHost,
  resolveUrl,
  sameOrigin,
  validateFetchUrl,
} from "./urlSafety.js";

type RobotsFn = (url: string, contents: string) => {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
  isDisallowed(url: string, userAgent?: string): boolean | undefined;
};

const robotsParser = robotsParserImport as unknown as RobotsFn;
export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  links: { href: string; text: string }[];
  ok: boolean;
  error?: string;
}

export interface CrawlResult {
  pages: FetchedPage[];
  skipped: { url: string; reason: string }[];
  hiringCandidates: FetchedPage[];
}

const HIRING_HINTS =
  /careers?|jobs?|hiring|join.?us|work.?with.?us|life.?at|handbook|engineering.?blog|how.?we.?hire|interview|recruit/i;

const ABOUT_HINTS = /about|about.?us|our.?company|company|who.?we.?are|mission|story/i;
const fetchLimiter = new RateLimiter(400);

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function fetchPage(
  rawUrl: string,
  {
    allowPrivate = process.env.ALLOW_PRIVATE_URLS === "true" || process.env.NODE_ENV !== "production",
    timeoutMs = envInt("FETCH_TIMEOUT_MS", 15000),
    maxBytes = envInt("MAX_PAGE_BYTES", 500_000),
  }: { allowPrivate?: boolean; timeoutMs?: number; maxBytes?: number } = {}
): Promise<FetchedPage> {
  const check = validateFetchUrl(rawUrl, { allowPrivate });
  if (!check.ok || !check.url) {
    return emptyFail(rawUrl, check.reason ?? "Invalid URL");
  }

  const dns = await assertPublicResolvedHost(check.url.hostname, { allowPrivate });
  if (!dns.ok) {
    return emptyFail(rawUrl, dns.reason ?? "DNS blocked");
  }

  try {
    return await fetchLimiter.schedule(() =>
      withRetry(
        async () => {
          const { res, finalUrl } = await fetchWithSafeRedirects(check.url!.toString(), {
            allowPrivate,
            timeoutMs,
          });

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          const ctype = res.headers.get("content-type") ?? "";
          if (!/text\/html|application\/xhtml|text\/plain/i.test(ctype) && ctype) {
            return emptyFail(rawUrl, `Unsupported content-type: ${ctype}`, finalUrl);
          }

          const { buffer, truncated } = await readBodyCapped(res, maxBytes);
          const html = buffer.toString("utf8");
          const page = parseHtml(rawUrl, finalUrl, html);
          if (truncated) {
            page.error = `Truncated to ${maxBytes} bytes (page was larger)`;
          }
          return page;
        },
        { retries: 2, label: `fetch ${rawUrl}` }
      )
    );
  } catch (err) {
    return emptyFail(rawUrl, err instanceof Error ? err.message : String(err));
  }
}

async function readBodyCapped(
  res: Response,
  maxBytes: number
): Promise<{ buffer: Buffer; truncated: boolean }> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength <= maxBytes) return { buffer: buf, truncated: false };
    return { buffer: buf.subarray(0, maxBytes), truncated: true };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  return { buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))), truncated };
}

function emptyFail(url: string, error: string, finalUrl = url): FetchedPage {
  return { url, finalUrl, title: "", text: "", links: [], ok: false, error };
}

/** Follow redirects manually so each hop is re-validated (SSRF). */
async function fetchWithSafeRedirects(
  startUrl: string,
  { allowPrivate, timeoutMs }: { allowPrivate: boolean; timeoutMs: number }
): Promise<{ res: Response; finalUrl: string }> {
  let current = startUrl;
  for (let hop = 0; hop < 5; hop++) {
    const check = validateFetchUrl(current, { allowPrivate });
    if (!check.ok || !check.url) {
      throw new Error(check.reason ?? "Invalid redirect URL");
    }
    const dns = await assertPublicResolvedHost(check.url.hostname, { allowPrivate });
    if (!dns.ok) throw new Error(dns.reason ?? "Redirect to private host blocked");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(check.url.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "InterviewPrepKitBot/1.0 (+research; respectful crawler)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        },
      });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`Redirect ${res.status} without Location`);
        const next = resolveUrl(check.url.toString(), loc);
        if (!next) throw new Error("Invalid redirect location");
        current = next;
        continue;
      }

      return { res, finalUrl: check.url.toString() };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}

function parseHtml(original: string, finalUrl: string, html: string): FetchedPage {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, nav, footer").remove();
  const title = $("title").first().text().trim() || $("h1").first().text().trim();
  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);

  const links: { href: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const abs = resolveUrl(finalUrl, href);
    if (!abs) return;
    links.push({ href: abs, text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 120) });
  });

  return { url: original, finalUrl, title, text, links, ok: true };
}

async function loadRobots(origin: string, allowPrivate: boolean) {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const page = await fetchPage(robotsUrl, { allowPrivate });
  if (!page.ok) return robotsParser(robotsUrl, "");
  return robotsParser(robotsUrl, page.text);
}

function scoreLink(href: string, anchor: string): number {
  const hay = `${href} ${anchor}`;
  let score = 0;
  if (HIRING_HINTS.test(hay)) score += 8;
  if (ABOUT_HINTS.test(hay)) score += 5;
  if (/blog|handbook|culture|values|engineering/i.test(hay)) score += 3;
  if (/\.(pdf|jpg|png|zip|css|js)(\?|$)/i.test(href)) score -= 10;
  if (hay.length > 180) score -= 2;
  return score;
}

function seedPaths(origin: string): string[] {
  const paths = [
    "/about",
    "/about-us",
    "/company",
    "/our-company",
    "/careers",
    "/jobs",
    "/jobs/teams/software-development",
    "/working-at",
  ];
  return paths.map((p) => new URL(p, origin).toString());
}

/**
 * Crawl a company site: homepage → rank same-origin links → fetch promising pages.
 */
export async function crawlCompanySite(
  companyUrl: string,
  {
    allowPrivate = process.env.ALLOW_PRIVATE_URLS === "true" || process.env.NODE_ENV !== "production",
    maxPages = envInt("MAX_PAGES_PER_SITE", 12),
  }: { allowPrivate?: boolean; maxPages?: number } = {}
): Promise<CrawlResult> {
  const skipped: { url: string; reason: string }[] = [];
  const pages: FetchedPage[] = [];

  const rootCheck = validateFetchUrl(companyUrl, { allowPrivate });
  if (!rootCheck.ok || !rootCheck.url) {
    return {
      pages: [],
      skipped: [{ url: companyUrl, reason: rootCheck.reason ?? "Invalid URL" }],
      hiringCandidates: [],
    };
  }

  const origin = rootCheck.url.origin;
  const robots = await loadRobots(origin, allowPrivate);
  const ua = "InterviewPrepKitBot";

  const home = await fetchPage(rootCheck.url.toString(), { allowPrivate });
  if (!home.ok) {
    skipped.push({ url: companyUrl, reason: home.error ?? "Unreachable" });
    return { pages: [], skipped, hiringCandidates: [] };
  }
  pages.push(home);

  const candidates = new Map<string, { href: string; text: string; score: number }>();

  for (const seed of seedPaths(origin)) {
    if (robots.isDisallowed(seed, ua)) continue;
    candidates.set(seed, { href: seed, text: seed, score: scoreLink(seed, seed) + 2 });
  }

  for (const link of home.links) {
    if (!sameOrigin(origin, link.href)) continue;
    if (robots.isDisallowed(link.href, ua)) {
      skipped.push({ url: link.href, reason: "Disallowed by robots.txt" });
      continue;
    }
    const score = scoreLink(link.href, link.text);
    if (score <= 0) continue;
    const prev = candidates.get(link.href);
    if (!prev || score > prev.score) {
      candidates.set(link.href, { ...link, score });
    }
  }

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, maxPages - 1);

  for (const item of ranked) {
    const page = await fetchPage(item.href, { allowPrivate });
    if (!page.ok) {
      skipped.push({ url: item.href, reason: page.error ?? "Fetch failed" });
      continue;
    }
    pages.push(page);

    for (const link of page.links) {
      if (!sameOrigin(origin, link.href)) continue;
      if (robots.isDisallowed(link.href, ua)) continue;
      const score = scoreLink(link.href, link.text);
      if (score >= 8 && !candidates.has(link.href) && pages.length + ranked.length < maxPages + 3) {
        candidates.set(link.href, { ...link, score });
      }
    }
  }

  const extra = [...candidates.values()]
    .filter((c) => !pages.some((p) => p.finalUrl === c.href || p.url === c.href))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, maxPages - pages.length));

  for (const item of extra) {
    const page = await fetchPage(item.href, { allowPrivate });
    if (!page.ok) {
      skipped.push({ url: item.href, reason: page.error ?? "Fetch failed" });
      continue;
    }
    pages.push(page);
  }

  const hiringCandidates = pages.filter(
    (p) => HIRING_HINTS.test(`${p.finalUrl} ${p.title} ${p.text.slice(0, 500)}`)
  );

  return { pages, skipped, hiringCandidates };
}

/**
 * Lightweight public discussion search via DuckDuckGo HTML (no API key).
 * Treated as untrusted content; failures are non-fatal.
 */
export async function searchPublicInterviewDiscussion(
  companyName: string,
  {
    allowPrivate = process.env.ALLOW_PRIVATE_URLS === "true" || process.env.NODE_ENV !== "production",
  }: { allowPrivate?: boolean } = {}
): Promise<{ notes: string; sources: string[]; skipped: { url: string; reason: string }[] }> {
  const skipped: { url: string; reason: string }[] = [];
  if (!companyName.trim()) {
    return { notes: "", sources: [], skipped: [{ url: "", reason: "No company name to search" }] };
  }

  const q = encodeURIComponent(`${companyName} interview process experience`);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${q}`;
  const page = await fetchPage(searchUrl, { allowPrivate: false });
  if (!page.ok) {
    skipped.push({ url: searchUrl, reason: page.error ?? "Search failed" });
    return { notes: "", sources: [], skipped };
  }

  const notes = page.text.slice(0, 4000);
  const sources = page.links
    .map((l) => l.href)
    .filter((h) => /glassdoor|teamblind|levels\.fyi|reddit|interviewing|lever|greenhouse/i.test(h))
    .slice(0, 5);

  const fetchedNotes: string[] = [];
  for (const src of sources.slice(0, 2)) {
    const p = await fetchPage(src, { allowPrivate });
    if (!p.ok) {
      skipped.push({ url: src, reason: p.error ?? "Fetch failed" });
      continue;
    }
    fetchedNotes.push(`[${p.title}] ${p.text.slice(0, 1500)}`);
  }

  return {
    notes: [notes.slice(0, 1500), ...fetchedNotes].filter(Boolean).join("\n\n").slice(0, 6000),
    sources: [searchUrl, ...sources],
    skipped,
  };
}

/** Strip instruction-like patterns before sending page text to the model. */
export function sanitizeUntrustedText(text: string, label: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\b(ignore|disregard)\b[\s\S]{0,40}\b(instructions|prompt)\b/gi, "[filtered]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
  return `[UNTRUSTED_SOURCE:${label}]\n${cleaned}\n[/UNTRUSTED_SOURCE]`;
}
