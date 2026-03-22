import type { Context, Next } from "hono";

const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MB

export function bodyLimit(maxBytes: number = DEFAULT_MAX_BYTES) {
  return async (c: Context, next: Next) => {
    const contentLength = c.req.header("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      return c.json({ error: "Payload too large" }, 413);
    }
    await next();
  };
}
