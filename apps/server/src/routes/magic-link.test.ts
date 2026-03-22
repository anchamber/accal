import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-utils.ts";

const testState = { db: null as ReturnType<typeof createTestDb>["db"] | null };

vi.mock("../db/index.ts", () => {
  const { createTestDb } = require("../test-utils.ts");
  const { db, schema } = createTestDb();
  testState.db = db;
  return { db, schema, initDb: vi.fn() };
});

vi.mock("../auth/email.ts", () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../auth/session.ts", () => ({
  createSession: vi.fn().mockReturnValue("new-session-id"),
  validateSession: vi.fn(),
  deleteSession: vi.fn(),
  cleanExpiredData: vi.fn(),
  startCleanupSchedule: vi.fn(),
}));

const { default: magicLinkRoutes } = await import("./magic-link.ts");
const { sendMagicLinkEmail } = await import("../auth/email.ts");
const { schema } = await import("../db/index.ts");

import { Hono } from "hono";

function createApp() {
  const app = new Hono();
  app.route("/api/auth/magic-link", magicLinkRoutes);
  return app;
}

describe("magic-link routes", () => {
  beforeEach(() => {
    const db = testState.db!;
    db.delete(schema.magicLinkTokens).run();
    db.delete(schema.userRoles).run();
    db.delete(schema.sessions).run();
    db.delete(schema.users).run();
    vi.clearAllMocks();
  });

  describe("POST /api/auth/magic-link/send", () => {
    it("sends a magic link email for valid email", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/auth/magic-link/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
          body: JSON.stringify({ email: "user@example.com" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(sendMagicLinkEmail).toHaveBeenCalledOnce();
      expect(sendMagicLinkEmail).toHaveBeenCalledWith("user@example.com", expect.any(String));
    });

    it("creates a token in the database", async () => {
      const app = createApp();
      await app.request(
        new Request("http://localhost/api/auth/magic-link/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
          body: JSON.stringify({ email: "user@example.com" }),
        }),
      );

      const db = testState.db!;
      const tokens = db.select().from(schema.magicLinkTokens).all();
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.email).toBe("user@example.com");
    });

    it("rejects invalid email", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/auth/magic-link/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
          body: JSON.stringify({ email: "not-an-email" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 500 when email sending fails", async () => {
      vi.mocked(sendMagicLinkEmail).mockRejectedValueOnce(new Error("SMTP down"));

      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/auth/magic-link/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
          body: JSON.stringify({ email: "user@example.com" }),
        }),
      );
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toMatch(/failed to send/i);
    });

    it("cleans up previous tokens for the same email", async () => {
      const db = testState.db!;
      db.insert(schema.magicLinkTokens)
        .values({
          id: "old-token",
          email: "user@example.com",
          expiresAt: new Date(Date.now() + 60000),
        })
        .run();

      const app = createApp();
      await app.request(
        new Request("http://localhost/api/auth/magic-link/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
          body: JSON.stringify({ email: "user@example.com" }),
        }),
      );

      const tokens = db.select().from(schema.magicLinkTokens).all();
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.id).not.toBe("old-token");
    });
  });

  describe("GET /api/auth/magic-link/verify", () => {
    it("creates a new user and session for valid token", async () => {
      const db = testState.db!;
      db.insert(schema.magicLinkTokens)
        .values({
          id: "valid-token",
          email: "new@example.com",
          expiresAt: new Date(Date.now() + 60000),
        })
        .run();

      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/auth/magic-link/verify?token=valid-token", {
          redirect: "manual",
        }),
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/");

      // User was created
      const users = db.select().from(schema.users).all();
      expect(users).toHaveLength(1);
      expect(users[0]!.email).toBe("new@example.com");
      expect(users[0]!.oauthProvider).toBeNull();

      // Token was consumed
      const tokens = db.select().from(schema.magicLinkTokens).all();
      expect(tokens).toHaveLength(0);
    });

    it("links to existing user with same email", async () => {
      const db = testState.db!;
      db.insert(schema.users)
        .values({
          id: "existing-user",
          email: "existing@example.com",
          name: "Existing",
          oauthProvider: "google",
          oauthId: "456",
        })
        .run();
      db.insert(schema.magicLinkTokens)
        .values({
          id: "valid-token",
          email: "existing@example.com",
          expiresAt: new Date(Date.now() + 60000),
        })
        .run();

      const app = createApp();
      await app.request(
        new Request("http://localhost/api/auth/magic-link/verify?token=valid-token", {
          redirect: "manual",
        }),
      );

      // No new user created
      const users = db.select().from(schema.users).all();
      expect(users).toHaveLength(1);
      expect(users[0]!.id).toBe("existing-user");
    });

    it("rejects invalid token", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/auth/magic-link/verify?token=nonexistent"),
      );
      expect(res.status).toBe(400);
    });

    it("rejects expired token", async () => {
      const db = testState.db!;
      db.insert(schema.magicLinkTokens)
        .values({
          id: "expired-token",
          email: "user@example.com",
          expiresAt: new Date(Date.now() - 1000),
        })
        .run();

      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/auth/magic-link/verify?token=expired-token"),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/expired/i);
    });

    it("redirects to login error page for deleted user", async () => {
      const db = testState.db!;
      db.insert(schema.users)
        .values({
          id: "deleted-user",
          email: "deleted@example.com",
          name: "Deleted User",
          deletedAt: new Date(),
        })
        .run();
      db.insert(schema.magicLinkTokens)
        .values({
          id: "deleted-token",
          email: "deleted@example.com",
          expiresAt: new Date(Date.now() + 60000),
        })
        .run();

      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/auth/magic-link/verify?token=deleted-token", {
          redirect: "manual",
        }),
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/#/login?error=account-deleted");
    });

    it("returns 400 when token query parameter is missing", async () => {
      const app = createApp();
      const res = await app.request(new Request("http://localhost/api/auth/magic-link/verify"));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("grants admin role to first user", async () => {
      const db = testState.db!;
      db.insert(schema.magicLinkTokens)
        .values({
          id: "first-token",
          email: "admin@example.com",
          expiresAt: new Date(Date.now() + 60000),
        })
        .run();

      const app = createApp();
      await app.request(
        new Request("http://localhost/api/auth/magic-link/verify?token=first-token", {
          redirect: "manual",
        }),
      );

      const users = db.select().from(schema.users).all();
      const roles = db
        .select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, users[0]!.id))
        .all();
      expect(roles).toHaveLength(1);
      expect(roles[0]!.role).toBe("admin");
    });
  });
});
