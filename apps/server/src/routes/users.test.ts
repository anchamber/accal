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
  deleteAllUserSessions: vi.fn(),
  cleanExpiredData: vi.fn(),
  startCleanupSchedule: vi.fn(),
}));

const { default: userRoutes } = await import("./users.ts");
const { schema } = await import("../db/index.ts");

import { eq } from "drizzle-orm";
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

function unauthRequest(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

/** Helper: create a jump day and return its id */
function createJumpDay(db: NonNullable<typeof testState.db>, date: string, id?: string) {
  const jumpDayId = id ?? `jd-${date}`;
  db.insert(schema.jumpDays).values({ id: jumpDayId, date }).run();
  return jumpDayId;
}

/** Helper: create an assignment */
function createAssignment(
  db: NonNullable<typeof testState.db>,
  jumpDayId: string,
  userId: string,
  role: string,
) {
  db.insert(schema.assignments)
    .values({ jumpDayId, userId, role } as typeof schema.assignments.$inferInsert)
    .run();
}

/** Helper: get a date string N days from now */
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("users routes", () => {
  beforeEach(() => {
    const db = testState.db!;
    db.delete(schema.assignments).run();
    db.delete(schema.jumpDays).run();
    db.delete(schema.passkeyCredentials).run();
    db.delete(schema.sessions).run();
    db.delete(schema.userRoles).run();
    db.delete(schema.users).run();
    activeUserId = "test-user-1";

    seedTestUserWithRoles(db, ["admin", "sdl"]);
  });

  // ──────────────────────────────────────────────────────────────
  // PATCH /api/users/me/name
  // ──────────────────────────────────────────────────────────────
  describe("PATCH /api/users/me/name", () => {
    it("updates name successfully", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/users/me/name", {
          method: "PATCH",
          body: JSON.stringify({ name: "New Name" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.name).toBe("New Name");

      // Verify in DB
      const db = testState.db!;
      const user = db.select().from(schema.users).where(eq(schema.users.id, "test-user-1")).get();
      expect(user!.name).toBe("New Name");
    });

    it("returns 400 for empty name", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/users/me/name", {
          method: "PATCH",
          body: JSON.stringify({ name: "" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for missing body", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/users/me/name", {
          method: "PATCH",
          body: "not-json",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for name exceeding 100 chars", async () => {
      const app = createApp();
      const longName = "A".repeat(101);
      const res = await app.request(
        authedRequest("/api/users/me/name", {
          method: "PATCH",
          body: JSON.stringify({ name: longName }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("trims whitespace from name", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/users/me/name", {
          method: "PATCH",
          body: JSON.stringify({ name: "  Trimmed Name  " }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("Trimmed Name");
    });

    it("returns 401 without auth", async () => {
      const app = createApp();
      const res = await app.request(
        unauthRequest("/api/users/me/name", {
          method: "PATCH",
          body: JSON.stringify({ name: "Hacker" }),
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/users (admin list)
  // ──────────────────────────────────────────────────────────────
  describe("GET /api/users", () => {
    it("returns all active users with roles", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "test-user-2",
        email: "user2@example.com",
        name: "User Two",
        oauthProvider: "github",
        oauthId: "456",
      });

      const app = createApp();
      const res = await app.request(authedRequest("/api/users"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);

      const user1 = body.find((u: { id: string }) => u.id === "test-user-1");
      expect(user1.roles).toContain("admin");
      expect(user1.roles).toContain("sdl");

      const user2 = body.find((u: { id: string }) => u.id === "test-user-2");
      expect(user2.roles).toContain("pilot");
    });

    it("filters out deleted users", async () => {
      const db = testState.db!;
      // Create a deleted user
      seedTestUserWithRoles(db, ["pilot"], {
        id: "deleted-user",
        email: "deleted@example.com",
        name: "Deleted User",
        oauthProvider: "github",
        oauthId: "789",
        deletedAt: new Date(),
      });

      const app = createApp();
      const res = await app.request(authedRequest("/api/users"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("test-user-1");
    });

    it("returns 403 for non-admin", async () => {
      const db = testState.db!;
      // Create a non-admin user and switch to them
      seedTestUserWithRoles(db, ["pilot"], {
        id: "regular-user",
        email: "regular@example.com",
        name: "Regular",
        oauthProvider: "github",
        oauthId: "555",
      });
      activeUserId = "regular-user";

      const app = createApp();
      const res = await app.request(authedRequest("/api/users"));
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // PATCH /api/users/:id/roles
  // ──────────────────────────────────────────────────────────────
  describe("PATCH /api/users/:id/roles", () => {
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
        .where(eq(schema.userRoles.userId, "test-user-1"))
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
        .where(eq(schema.userRoles.userId, "test-user-1"))
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
        .where(eq(schema.userRoles.userId, "test-user-1"))
        .all()
        .map((r: { role: string }) => r.role);
      expect(roles).toContain("admin");
      expect(roles).toContain("pilot");
      expect(roles).not.toContain("sdl");
    });

    it("returns 404 for non-existent user", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/users/non-existent/roles", {
          method: "PATCH",
          body: JSON.stringify({ roles: ["pilot"] }),
        }),
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("User not found");
    });

    it("returns 400 for invalid role names", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/users/test-user-1/roles", {
          method: "PATCH",
          body: JSON.stringify({ roles: ["admin", "not_a_real_role"] }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 403 for non-admin user", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "regular-user",
        email: "regular@example.com",
        name: "Regular",
        oauthProvider: "github",
        oauthId: "555",
      });
      activeUserId = "regular-user";

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/users/test-user-1/roles", {
          method: "PATCH",
          body: JSON.stringify({ roles: ["pilot"] }),
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/users/:id/delete-preview
  // ──────────────────────────────────────────────────────────────
  describe("GET /api/users/:id/delete-preview", () => {
    it("shows future assignments that will be freed", async () => {
      const db = testState.db!;
      const targetUser = seedTestUserWithRoles(db, ["pilot"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target",
        oauthProvider: "github",
        oauthId: "777",
      });

      const futureDate = dateOffset(7);
      const futureJdId = createJumpDay(db, futureDate);
      createAssignment(db, futureJdId, targetUser.id, "pilot");

      const app = createApp();
      const res = await app.request(authedRequest(`/api/users/${targetUser.id}/delete-preview`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.futureAssignments).toHaveLength(1);
      expect(body.futureAssignments[0].date).toBe(futureDate);
      expect(body.futureAssignments[0].role).toBe("pilot");
    });

    it("does NOT include past assignments in preview", async () => {
      const db = testState.db!;
      const targetUser = seedTestUserWithRoles(db, ["pilot"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target",
        oauthProvider: "github",
        oauthId: "777",
      });

      const pastDate = dateOffset(-7);
      const pastJdId = createJumpDay(db, pastDate);
      createAssignment(db, pastJdId, targetUser.id, "pilot");

      const futureDate = dateOffset(7);
      const futureJdId = createJumpDay(db, futureDate);
      createAssignment(db, futureJdId, targetUser.id, "pilot");

      const app = createApp();
      const res = await app.request(authedRequest(`/api/users/${targetUser.id}/delete-preview`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.futureAssignments).toHaveLength(1);
      expect(body.futureAssignments[0].date).toBe(futureDate);
    });

    it("returns 400 when trying to preview own deletion", async () => {
      const app = createApp();
      const res = await app.request(authedRequest("/api/users/test-user-1/delete-preview"));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Cannot delete yourself");
    });

    it("returns preview for admin target when multiple admins exist", async () => {
      // Note: The "last admin" guard in delete-preview is unreachable via API because
      // the requester must be admin (requireRole), so adminCount is always >= 2 when
      // previewing another admin. We verify the happy path works with multiple admins.
      const db = testState.db!;
      seedTestUserWithRoles(db, ["admin"], {
        id: "other-admin",
        email: "other@example.com",
        name: "Other Admin",
        oauthProvider: "github",
        oauthId: "888",
      });

      const app = createApp();
      const res = await app.request(authedRequest("/api/users/other-admin/delete-preview"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.futureAssignments).toHaveLength(0);
    });

    it("returns 404 for non-existent user", async () => {
      const app = createApp();
      const res = await app.request(authedRequest("/api/users/non-existent/delete-preview"));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("User not found");
    });

    it("returns 403 for non-admin user", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "regular-user",
        email: "regular@example.com",
        name: "Regular",
        oauthProvider: "github",
        oauthId: "555",
      });
      activeUserId = "regular-user";

      const app = createApp();
      const res = await app.request(authedRequest("/api/users/test-user-1/delete-preview"));
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // DELETE /api/users/:id
  // ──────────────────────────────────────────────────────────────
  describe("DELETE /api/users/:id", () => {
    it("anonymizes user PII", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target User",
        avatarUrl: "https://example.com/avatar.jpg",
        oauthProvider: "github",
        oauthId: "777",
      });

      const app = createApp();
      const res = await app.request(authedRequest("/api/users/target-user", { method: "DELETE" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const user = db.select().from(schema.users).where(eq(schema.users.id, "target-user")).get();
      expect(user).toBeDefined();
      expect(user!.name).toBe("Deleted User");
      expect(user!.email).toMatch(/^deleted-.*@deleted\.local$/);
      expect(user!.avatarUrl).toBeNull();
      expect(user!.oauthProvider).toBeNull();
      expect(user!.oauthId).toBeNull();
      expect(user!.deletedAt).toBeDefined();
    });

    it("sets deletedAt timestamp", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target",
        oauthProvider: "github",
        oauthId: "777",
      });

      const app = createApp();
      const before = new Date();
      await app.request(authedRequest("/api/users/target-user", { method: "DELETE" }));
      const after = new Date();

      const user = db.select().from(schema.users).where(eq(schema.users.id, "target-user")).get();
      expect(user!.deletedAt).toBeDefined();
      const deletedAt = user!.deletedAt as Date;
      expect(deletedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(deletedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    it("removes roles and sessions", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot", "sdl"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target",
        oauthProvider: "github",
        oauthId: "777",
      });

      const app = createApp();
      await app.request(authedRequest("/api/users/target-user", { method: "DELETE" }));

      // Roles should be removed
      const roles = db
        .select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, "target-user"))
        .all();
      expect(roles).toHaveLength(0);

      // deleteAllUserSessions should have been called
      const { deleteAllUserSessions } = await import("../auth/session.ts");
      expect(deleteAllUserSessions).toHaveBeenCalledWith("target-user");
    });

    it("removes passkeys", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target",
        oauthProvider: "github",
        oauthId: "777",
      });

      // Add a passkey for the target user
      db.insert(schema.passkeyCredentials)
        .values({
          id: "cred-1",
          userId: "target-user",
          publicKey: "base64-pubkey",
          counter: 0,
          name: "My Passkey",
        })
        .run();

      const app = createApp();
      await app.request(authedRequest("/api/users/target-user", { method: "DELETE" }));

      const passkeys = db
        .select()
        .from(schema.passkeyCredentials)
        .where(eq(schema.passkeyCredentials.userId, "target-user"))
        .all();
      expect(passkeys).toHaveLength(0);
    });

    it("removes future assignments but keeps past ones", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target",
        oauthProvider: "github",
        oauthId: "777",
      });

      const pastDate = dateOffset(-7);
      const futureDate = dateOffset(7);
      const pastJdId = createJumpDay(db, pastDate);
      const futureJdId = createJumpDay(db, futureDate);
      createAssignment(db, pastJdId, "target-user", "pilot");
      createAssignment(db, futureJdId, "target-user", "pilot");

      const app = createApp();
      await app.request(authedRequest("/api/users/target-user", { method: "DELETE" }));

      // Past assignment should still exist
      const pastAssignments = db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.jumpDayId, pastJdId))
        .all();
      expect(pastAssignments).toHaveLength(1);
      expect(pastAssignments[0].userId).toBe("target-user");

      // Future assignment should be removed
      const futureAssignments = db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.jumpDayId, futureJdId))
        .all();
      expect(futureAssignments).toHaveLength(0);
    });

    it("returns 400 when trying to delete yourself", async () => {
      const app = createApp();
      const res = await app.request(authedRequest("/api/users/test-user-1", { method: "DELETE" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Cannot delete yourself");
    });

    it("allows deleting an admin when multiple admins exist", async () => {
      // Note: The "last admin" guard is unreachable via API because the requester
      // must also be admin (requireRole), so adminCount is always >= 2.
      // We verify that deleting one of two admins succeeds.
      const db = testState.db!;
      seedTestUserWithRoles(db, ["admin"], {
        id: "target-admin",
        email: "target@example.com",
        name: "Target Admin",
        oauthProvider: "google",
        oauthId: "321",
      });

      const app = createApp();
      const res = await app.request(authedRequest("/api/users/target-admin", { method: "DELETE" }));
      expect(res.status).toBe(200);

      // Verify the target admin was actually deleted/anonymized
      const user = db.select().from(schema.users).where(eq(schema.users.id, "target-admin")).get();
      expect(user!.name).toBe("Deleted User");
      expect(user!.deletedAt).toBeDefined();
    });

    it("returns 400 for already-deleted user", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target",
        oauthProvider: "github",
        oauthId: "777",
        deletedAt: new Date(),
      });

      const app = createApp();
      const res = await app.request(authedRequest("/api/users/target-user", { method: "DELETE" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("User already deleted");
    });

    it("returns 404 for non-existent user", async () => {
      const app = createApp();
      const res = await app.request(authedRequest("/api/users/non-existent", { method: "DELETE" }));
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("User not found");
    });

    it("returns 403 for non-admin user", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "regular-user",
        email: "regular@example.com",
        name: "Regular",
        oauthProvider: "github",
        oauthId: "555",
      });
      activeUserId = "regular-user";

      const app = createApp();
      const res = await app.request(authedRequest("/api/users/test-user-1", { method: "DELETE" }));
      expect(res.status).toBe(403);
    });

    it("deleted user cannot authenticate (auth middleware blocks)", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target",
        oauthProvider: "github",
        oauthId: "777",
      });

      // Delete the user first
      const app = createApp();
      await app.request(authedRequest("/api/users/target-user", { method: "DELETE" }));

      // Now try to access as the deleted user
      activeUserId = "target-user";
      const res = await app.request(
        authedRequest("/api/users/me/name", {
          method: "PATCH",
          body: JSON.stringify({ name: "Ghost" }),
        }),
      );
      // Auth middleware checks user.deletedAt and returns 401
      expect(res.status).toBe(401);
    });
  });
});
