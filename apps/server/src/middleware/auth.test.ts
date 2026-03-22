import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { createTestDb, seedTestUser, seedTestUserWithRoles } from "../test-utils.ts";

const testState = { db: null as ReturnType<typeof createTestDb>["db"] | null };

vi.mock("../db/index.ts", () => {
  const { createTestDb } = require("../test-utils.ts");
  const { db, schema } = createTestDb();
  testState.db = db;
  return { db, schema, initDb: vi.fn() };
});

const mockValidateSession = vi.fn();

vi.mock("../auth/session.ts", () => ({
  createSession: vi.fn(),
  validateSession: mockValidateSession,
  deleteSession: vi.fn(),
  cleanExpiredData: vi.fn(),
  startCleanupSchedule: vi.fn(),
}));

const { authMiddleware, requireRole } = await import("./auth.ts");
const { schema } = await import("../db/index.ts");

import { Hono } from "hono";

function createApp(middlewares: Function[] = [authMiddleware]) {
  const app = new Hono();
  for (const mw of middlewares) {
    app.use("/*", mw as any);
  }
  app.get("/protected", (c) => {
    const user = c.get("user");
    return c.json({ user });
  });
  return app;
}

describe("auth middleware", () => {
  beforeEach(() => {
    const db = testState.db!;
    db.delete(schema.userRoles).run();
    db.delete(schema.sessions).run();
    db.delete(schema.users).run();
    vi.clearAllMocks();
  });

  describe("authMiddleware", () => {
    it("returns 401 when no session cookie", async () => {
      const app = createApp();
      const res = await app.request(new Request("http://localhost/protected"));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 401 for invalid session", async () => {
      mockValidateSession.mockReturnValue(null);

      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/protected", {
          headers: { Cookie: "session=invalid-session-id" },
        }),
      );
      expect(res.status).toBe(401);
    });

    it("returns 401 for deleted user", async () => {
      const db = testState.db!;
      seedTestUser(db, {
        id: "deleted-user",
        email: "deleted@example.com",
        name: "Deleted",
        deletedAt: new Date(),
      });

      mockValidateSession.mockReturnValue({ userId: "deleted-user", id: "sess-1" });

      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/protected", {
          headers: { Cookie: "session=valid-session" },
        }),
      );
      expect(res.status).toBe(401);
    });

    it("sets user context with roles for valid session", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["admin"], {
        id: "active-user",
        email: "active@example.com",
        name: "Active User",
      });

      mockValidateSession.mockReturnValue({ userId: "active-user", id: "sess-1" });

      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/protected", {
          headers: { Cookie: "session=valid-session" },
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user).toMatchObject({
        id: "active-user",
        email: "active@example.com",
        name: "Active User",
        roles: ["admin"],
      });
    });
  });

  describe("requireRole", () => {
    it("allows access when user has required role", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["admin"], {
        id: "admin-user",
        email: "admin@example.com",
        name: "Admin",
      });

      mockValidateSession.mockReturnValue({ userId: "admin-user", id: "sess-1" });

      const app = createApp([authMiddleware, requireRole("admin")]);
      const res = await app.request(
        new Request("http://localhost/protected", {
          headers: { Cookie: "session=valid-session" },
        }),
      );
      expect(res.status).toBe(200);
    });

    it("returns 403 when user lacks required role", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "pilot-user",
        email: "pilot@example.com",
        name: "Pilot",
      });

      mockValidateSession.mockReturnValue({ userId: "pilot-user", id: "sess-1" });

      const app = createApp([authMiddleware, requireRole("admin")]);
      const res = await app.request(
        new Request("http://localhost/protected", {
          headers: { Cookie: "session=valid-session" },
        }),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Forbidden");
    });

    it("works with multiple allowed roles (any match)", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "multi-user",
        email: "multi@example.com",
        name: "Multi",
      });

      mockValidateSession.mockReturnValue({ userId: "multi-user", id: "sess-1" });

      const app = createApp([authMiddleware, requireRole("admin", "pilot")]);
      const res = await app.request(
        new Request("http://localhost/protected", {
          headers: { Cookie: "session=valid-session" },
        }),
      );
      expect(res.status).toBe(200);
    });
  });
});
