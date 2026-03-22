import type { Context, Next } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Max requests per window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Key extractor — defaults to IP */
  keyFn?: (c: Context) => string;
}

export function rateLimit(options: RateLimitOptions) {
  const { max, windowMs, keyFn } = options;
  const store = new Map<string, RateLimitEntry>();

  // Periodically clean stale entries to prevent memory leaks
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of store) {
        if (entry.resetAt <= now) store.delete(key);
      }
    },
    Math.max(windowMs, 60_000),
  );

  return async (c: Context, next: Next) => {
    const key = keyFn ? keyFn(c) : getClientIp(c);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many requests, please try again later" }, 429);
    }

    await next();
  };
}

function getClientIp(c: Context): string {
  // Only trust proxy headers when explicitly configured
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
    const realIp = c.req.header("x-real-ip");
    if (realIp) return realIp;
  }
  // Fall back to direct connection info
  return c.env?.remoteAddress ?? "unknown";
}
