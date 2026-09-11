export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    retries = 3,
    baseDelayMs = 800,
    label = "operation",
    shouldRetry = (err: unknown) => isRetryable(err),
  }: {
    retries?: number;
    baseDelayMs?: number;
    label?: string;
    shouldRetry?: (err: unknown) => boolean;
  } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`);
}

export function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|timeout|ECONNRESET|ETIMEDOUT|503|502|overloaded|RESOURCE_EXHAUSTED/i.test(
    msg
  );
}

export class RateLimiter {
  private queue: Promise<void> = Promise.resolve();
  private lastAt = 0;

  constructor(private minIntervalMs: number) {}

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = Math.max(0, this.minIntervalMs - (Date.now() - this.lastAt));
      if (wait) await sleep(wait);
      this.lastAt = Date.now();
      return fn();
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
