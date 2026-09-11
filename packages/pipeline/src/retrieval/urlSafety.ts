import dns from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_RANGES = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^\[?::1\]?$/,
];

export interface UrlValidationResult {
  ok: boolean;
  url?: URL;
  reason?: string;
}

export function isPrivateHostOrIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  if (PRIVATE_RANGES.some((re) => re.test(h))) return true;
  if (isIP(h) && PRIVATE_RANGES.some((re) => re.test(h))) return true;
  return false;
}

export function validateFetchUrl(
  raw: string,
  { allowPrivate = false }: { allowPrivate?: boolean } = {}
): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, reason: "Only http/https URLs are allowed" };
  }

  if (isPrivateHostOrIp(url.hostname) && !allowPrivate) {
    return { ok: false, reason: "Private/loopback addresses are blocked in production" };
  }

  return { ok: true, url };
}

/**
 * Resolve DNS and reject if any A/AAAA record is private (DNS rebinding defense).
 */
export async function assertPublicResolvedHost(
  hostname: string,
  { allowPrivate = false }: { allowPrivate?: boolean } = {}
): Promise<{ ok: boolean; reason?: string }> {
  if (allowPrivate) return { ok: true };
  if (isPrivateHostOrIp(hostname)) {
    return { ok: false, reason: "Private/loopback addresses are blocked" };
  }
  if (isIP(hostname)) return { ok: true };

  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length) return { ok: false, reason: "Host could not be resolved" };
    for (const r of records) {
      if (isPrivateHostOrIp(r.address)) {
        return {
          ok: false,
          reason: `Host resolves to private address ${r.address}`,
        };
      }
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "DNS lookup failed",
    };
  }
}

export function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin;
  } catch {
    return false;
  }
}
