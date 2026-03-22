import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { Hono } from "hono";
import { rateLimit } from "./rate-limit.ts";

describe("rateLimit middleware", () => {
  const originalTrustProxy = process.env.TRUST_PROXY;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.TRUST_PROXY = "true";
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.TRUST_PROXY = originalTrustProxy;
  });

  function createApp(max: number, windowMs: number) {
    const app = new Hono();
    app.use("*", rateLimit({ max, windowMs }));
    app.get("/test", (c) => c.json({ ok: true }));
    return app;
  }

  it("allows requests under the limit", async () => {
    const app = createApp(3, 60_000);
    const req = new Request("http://localhost/test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    const res = await app.request(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("2");
  });

  it("blocks requests over the limit with 429", async () => {
    const app = createApp(2, 60_000);

    for (let i = 0; i < 2; i++) {
      const res = await app.request(
        new Request("http://localhost/test", {
          headers: { "x-forwarded-for": "1.2.3.4" },
        }),
      );
      expect(res.status).toBe(200);
    }

    const res = await app.request(
      new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/too many requests/i);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("tracks different IPs independently", async () => {
    const app = createApp(1, 60_000);

    const res1 = await app.request(
      new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "1.1.1.1" },
      }),
    );
    expect(res1.status).toBe(200);

    const res2 = await app.request(
      new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "2.2.2.2" },
      }),
    );
    expect(res2.status).toBe(200);

    // First IP is now blocked
    const res3 = await app.request(
      new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "1.1.1.1" },
      }),
    );
    expect(res3.status).toBe(429);
  });

  it("resets after the window expires", async () => {
    const app = createApp(1, 60_000);

    const res1 = await app.request(
      new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      }),
    );
    expect(res1.status).toBe(200);

    const res2 = await app.request(
      new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      }),
    );
    expect(res2.status).toBe(429);

    // Advance past the window
    vi.advanceTimersByTime(61_000);

    const res3 = await app.request(
      new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      }),
    );
    expect(res3.status).toBe(200);
  });

  it("supports custom key function", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({
        max: 1,
        windowMs: 60_000,
        keyFn: (c) => c.req.header("x-api-key") || "anon",
      }),
    );
    app.get("/test", (c) => c.json({ ok: true }));

    const res1 = await app.request(
      new Request("http://localhost/test", {
        headers: { "x-api-key": "key-a" },
      }),
    );
    expect(res1.status).toBe(200);

    // Same key = blocked
    const res2 = await app.request(
      new Request("http://localhost/test", {
        headers: { "x-api-key": "key-a" },
      }),
    );
    expect(res2.status).toBe(429);

    // Different key = allowed
    const res3 = await app.request(
      new Request("http://localhost/test", {
        headers: { "x-api-key": "key-b" },
      }),
    );
    expect(res3.status).toBe(200);
  });
});
