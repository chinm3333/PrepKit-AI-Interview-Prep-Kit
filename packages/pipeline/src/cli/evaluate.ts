import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { generateKit } from "../pipeline.js";
import type { BatchKitResult, BatchOutput, GenerationCase } from "../types.js";
import { sleep } from "../util/retry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "../..");
const monorepoRoot = path.resolve(packageRoot, "../..");
const callerCwd = process.env.INIT_CWD || process.cwd();

loadEnv({ path: path.join(monorepoRoot, ".env") });
loadEnv({ path: path.join(packageRoot, ".env") });
loadEnv({ path: path.join(callerCwd, ".env") });
loadEnv();

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" || a === "--output") {
      out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

function resolveUserPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(callerCwd, p);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) {
    console.error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
    process.exit(1);
  }

  const inputPath = resolveUserPath(args.input);
  const outputPath = resolveUserPath(args.output);
  const raw = await fs.readFile(inputPath, "utf8");
  const cases = JSON.parse(raw) as GenerationCase[];

  if (!Array.isArray(cases)) {
    throw new Error("Input must be an array of cases");
  }

  const results: BatchKitResult[] = [];
  const started = Date.now();
  const pauseMs = Number(process.env.EVALUATE_PAUSE_MS ?? "12000");

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (i > 0 && pauseMs > 0) {
      process.stderr.write(`[evaluate] pausing ${pauseMs}ms before next case (rate limits)…\n`);
      await sleep(pauseMs);
    }
    process.stderr.write(`[evaluate] ${c.id} ... `);
    try {
      if (!c.jd || !c.company_url || !c.days) {
        throw Object.assign(new Error("Case missing jd, company_url, or days"), {
          code: "INVALID_CASE",
        });
      }
      const kit = await generateKit(c.jd, c.company_url, {
        days: c.days,
        onProgress: (e) => {
          if (e.status === "error") {
            process.stderr.write(`\n  ! ${e.step}: ${e.detail ?? ""}\n`);
          }
        },
      });
      results.push({ id: c.id, status: "ok", kit, error: null });
      process.stderr.write("ok\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        (err as { code?: string }).code ||
        (/unreachable|ENOTFOUND|HTTP 404|Invalid URL/i.test(message)
          ? "COMPANY_UNREACHABLE"
          : /rate.?limit|429/i.test(message)
            ? "RATE_LIMITED"
            : "GENERATION_FAILED");
      results.push({
        id: c.id,
        status: "failed",
        kit: null,
        error: { code, message },
      });
      process.stderr.write(`failed (${code})\n`);
      if (code === "RATE_LIMITED" && pauseMs > 0) {
        const cool = Math.max(pauseMs, 30_000);
        process.stderr.write(`[evaluate] rate limited — waiting ${cool}ms…\n`);
        await sleep(cool);
      }
    }
  }

  const output: BatchOutput = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    kits: results,
  };

  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  process.stderr.write(
    `[evaluate] wrote ${outputPath} (${results.filter((r) => r.status === "ok").length}/${results.length} ok) in ${secs}s\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
