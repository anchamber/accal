import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { createTestDb, seedTestUserWithRoles } from "../test-utils.ts";

const testState = { db: null as ReturnType<typeof createTestDb>["db"] | null };

vi.mock("../db/index.ts", () => {
  const { createTestDb } = require("../test-utils.ts");
  const { db, schema } = createTestDb();
  testState.db = db;
  return { db, schema, initDb: vi.fn() };
});

let activeUserId = "test-user-1";

vi.mock("../auth/session.ts", () => ({
  createSession: vi.fn(),
  validateSession: vi.fn((id: string) => {
    if (id === "valid-session") {
      return {
        id: "valid-session",
        userId: activeUserId,
        expiresAt: new Date(Date.now() + 86400000),
      };
    }
    return null;
  }),
  deleteSession: vi.fn(),
  cleanExpiredData: vi.fn(),
  startCleanupSchedule: vi.fn(),
}));

const { default: userRoutes } = await import("./users.ts");
const { schema } = await import("../db/index.ts");

import { Hono } from "hono";

function createApp() {
  const app = new Hono();
  app.route("/api/users", userRoutes);
  return app;
}

function authedRequest(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Cookie", "session=valid-session");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

describe("users routes", () => {
  beforeEach(() => {
    const db = testState.db!;
    db.delete(schema.userRoles).run();
    db.delete(schema.users).run();
    activeUserId = "test-user-1";

    seedTestUserWithRoles(db, ["admin", "sdl"]);
  });

  describe("PATCH /api/users/:id/roles - last admin guard", () => {
    it("prevents removing admin from the only admin", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/users/test-user-1/roles", {
          method: "PATCH",
          body: JSON.stringify({ roles: ["sdl", "manifest"] }),
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Cannot remove the last admin");

      // Verify admin role was NOT removed
      const db = testState.db!;
      const roles = db
        .select()
        .from(schema.userRoles)
        .where(require("drizzle-orm").eq(schema.userRoles.userId, "test-user-1"))
        .all()
        .map((r: { role: string }) => r.role);
      expect(roles).toContain("admin");
    });

    it("allows removing admin when another admin exists", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["admin"], {
        id: "test-user-2",
        email: "admin2@example.com",
        name: "Admin 2",
        oauthProvider: "github",
        oauthId: "999",
      });

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/users/test-user-1/roles", {
          method: "PATCH",
          body: JSON.stringify({ roles: ["sdl"] }),
        }),
      );
      expect(res.status).toBe(200);

      const roles = db
        .select()
        .from(schema.userRoles)
        .where(require("drizzle-orm").eq(schema.userRoles.userId, "test-user-1"))
        .all()
        .map((r: { role: string }) => r.role);
      expect(roles).not.toContain("admin");
      expect(roles).toContain("sdl");
    });

    it("allows updating roles when admin is kept", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/users/test-user-1/roles", {
          method: "PATCH",
          body: JSON.stringify({ roles: ["admin", "pilot"] }),
        }),
      );
      expect(res.status).toBe(200);

      const db = testState.db!;
      const roles = db
        .select()
        .from(schema.userRoles)
        .where(require("drizzle-orm").eq(schema.userRoles.userId, "test-user-1"))
        .all()
        .map((r: { role: string }) => r.role);
      expect(roles).toContain("admin");
      expect(roles).toContain("pilot");
      expect(roles).not.toContain("sdl");
    });
  });
});
