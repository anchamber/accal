import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestUserWithRoles, seedTestProfile } from "../test-utils.ts";

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

const { default: profileRoutes } = await import("./profiles.ts");
const { schema } = await import("../db/index.ts");

import { Hono } from "hono";

function createApp() {
  const app = new Hono();
  app.route("/api/profiles", profileRoutes);
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

describe("profiles routes", () => {
  beforeEach(() => {
    const db = testState.db!;
    db.delete(schema.assignments).run();
    db.delete(schema.jumpDays).run();
    db.delete(schema.roleConfig).run();
    db.delete(schema.userRoles).run();
    db.delete(schema.sessions).run();
    db.delete(schema.users).run();
    activeUserId = "test-user-1";
    vi.clearAllMocks();

    // Seed an admin user
    seedTestUserWithRoles(db, ["admin"]);
  });

  describe("GET /api/profiles", () => {
    it("returns 401 without auth", async () => {
      const app = createApp();
      const res = await app.request(unauthRequest("/api/profiles"));
      expect(res.status).toBe(401);
    });

    it("returns 403 for non-admin", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "non-admin",
        email: "nonadmin@example.com",
        name: "Non Admin",
        oauthProvider: "google",
        oauthId: "999",
      });
      activeUserId = "non-admin";

      const app = createApp();
      const res = await app.request(authedRequest("/api/profiles"));
      expect(res.status).toBe(403);
    });

    it("returns empty list when no profiles exist", async () => {
      const app = createApp();
      const res = await app.request(authedRequest("/api/profiles"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it("returns only profiles, not real users", async () => {
      const db = testState.db!;
      seedTestProfile(db, "External Pilot", ["pilot"]);

      const app = createApp();
      const res = await app.request(authedRequest("/api/profiles"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("External Pilot");
      expect(body[0].roles).toContain("pilot");
    });
  });

  describe("POST /api/profiles", () => {
    it("creates a profile with name and roles", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles", {
          method: "POST",
          body: JSON.stringify({ name: "Guest Pilot", roles: ["pilot", "sdl"] }),
        }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("Guest Pilot");
      expect(body.roles).toContain("pilot");
      expect(body.roles).toContain("sdl");
      expect(body.id).toBeDefined();

      // Verify in DB: email should be null
      const db = testState.db!;
      const user = db.select().from(schema.users).where(eq(schema.users.id, body.id)).get();
      expect(user).toBeDefined();
      expect(user!.email).toBeNull();
      expect(user!.name).toBe("Guest Pilot");
    });

    it("rejects profile with admin role", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles", {
          method: "POST",
          body: JSON.stringify({ name: "Hacker", roles: ["admin"] }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects empty name", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles", {
          method: "POST",
          body: JSON.stringify({ name: "", roles: ["pilot"] }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("creates a profile with empty roles", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles", {
          method: "POST",
          body: JSON.stringify({ name: "No Roles", roles: [] }),
        }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.roles).toEqual([]);
    });
  });

  describe("PATCH /api/profiles/:id", () => {
    it("updates profile name", async () => {
      const db = testState.db!;
      seedTestProfile(db, "Old Name", ["pilot"]);

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/test-profile-1", {
          method: "PATCH",
          body: JSON.stringify({ name: "New Name" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("New Name");
    });

    it("updates profile roles", async () => {
      const db = testState.db!;
      seedTestProfile(db, "Pilot", ["pilot"]);

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/test-profile-1", {
          method: "PATCH",
          body: JSON.stringify({ roles: ["sdl", "manifest"] }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.roles).toContain("sdl");
      expect(body.roles).toContain("manifest");
      expect(body.roles).not.toContain("pilot");
    });

    it("returns 404 for non-existent profile", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/nonexistent", {
          method: "PATCH",
          body: JSON.stringify({ name: "Test" }),
        }),
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 when targeting a real user (not a profile)", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/test-user-1", {
          method: "PATCH",
          body: JSON.stringify({ name: "Hijack" }),
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/profiles/:id", () => {
    it("deletes a profile", async () => {
      const db = testState.db!;
      seedTestProfile(db, "To Delete", ["pilot"]);

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/test-profile-1", { method: "DELETE" }),
      );
      expect(res.status).toBe(200);

      // Verify deleted from DB
      const profile = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, "test-profile-1"))
        .get();
      expect(profile).toBeUndefined();
    });

    it("cascades assignment deletion", async () => {
      const db = testState.db!;
      seedTestProfile(db, "Assigned Profile", ["pilot"]);
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-profile-1", role: "pilot" })
        .run();

      const app = createApp();
      await app.request(authedRequest("/api/profiles/test-profile-1", { method: "DELETE" }));

      const assignments = db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.userId, "test-profile-1"))
        .all();
      expect(assignments).toHaveLength(0);
    });

    it("returns 404 for non-existent profile", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/nonexistent", { method: "DELETE" }),
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 when targeting a real user", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/test-user-1", { method: "DELETE" }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/profiles/:id/link", () => {
    it("links profile to user and transfers assignments", async () => {
      const db = testState.db!;
      seedTestProfile(db, "Link Me", ["pilot", "sdl"]);
      seedTestUserWithRoles(db, ["pilot"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target",
        oauthProvider: "google",
        oauthId: "target-oauth",
      });
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-profile-1", role: "pilot" })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/test-profile-1/link", {
          method: "POST",
          body: JSON.stringify({ userId: "target-user" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.mergedAssignments).toBe(1);
      expect(body.skippedAssignments).toBe(0);

      // Profile should be deleted
      const profile = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, "test-profile-1"))
        .get();
      expect(profile).toBeUndefined();

      // Assignment should be transferred to target user
      const assignments = db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.userId, "target-user"))
        .all();
      expect(assignments).toHaveLength(1);
      expect(assignments[0].role).toBe("pilot");

      // Target user should have sdl role merged
      const roles = db
        .select()
        .from(schema.userRoles)
        .where(eq(schema.userRoles.userId, "target-user"))
        .all()
        .map((r: { role: string }) => r.role);
      expect(roles).toContain("pilot");
      expect(roles).toContain("sdl");
    });

    it("skips duplicate assignments during link", async () => {
      const db = testState.db!;
      seedTestProfile(db, "Duplicate", ["pilot"]);
      seedTestUserWithRoles(db, ["pilot"], {
        id: "target-user",
        email: "target@example.com",
        name: "Target",
        oauthProvider: "google",
        oauthId: "target-oauth",
      });
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      // Both profile and user assigned to same day+role
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-profile-1", role: "pilot" })
        .run();
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "target-user", role: "pilot" })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/test-profile-1/link", {
          method: "POST",
          body: JSON.stringify({ userId: "target-user" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mergedAssignments).toBe(0);
      expect(body.skippedAssignments).toBe(1);

      // Target user should still have exactly 1 assignment
      const assignments = db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.userId, "target-user"))
        .all();
      expect(assignments).toHaveLength(1);
    });

    it("returns 404 for non-existent profile", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/nonexistent/link", {
          method: "POST",
          body: JSON.stringify({ userId: "test-user-1" }),
        }),
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent target user", async () => {
      const db = testState.db!;
      seedTestProfile(db, "Link Me", ["pilot"]);

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/test-profile-1/link", {
          method: "POST",
          body: JSON.stringify({ userId: "nonexistent" }),
        }),
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 when target is another profile (no email)", async () => {
      const db = testState.db!;
      seedTestProfile(db, "Source", ["pilot"], "profile-1");
      seedTestProfile(db, "Target Profile", ["pilot"], "profile-2");

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/profiles/profile-1/link", {
          method: "POST",
          body: JSON.stringify({ userId: "profile-2" }),
        }),
      );
      expect(res.status).toBe(404);
    });
  });
});
