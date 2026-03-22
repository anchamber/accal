import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { createTestDb, seedTestUser, seedTestUserWithRoles } from "../test-utils.ts";

// Set up test DB mock
const testState = { db: null as ReturnType<typeof createTestDb>["db"] | null };

vi.mock("../db/index.ts", () => {
  const { createTestDb } = require("../test-utils.ts");
  const { db, schema } = createTestDb();
  testState.db = db;
  return { db, schema, initDb: vi.fn() };
});

// Mock session validation to return a controlled session
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

const { default: jumpdayRoutes } = await import("./jumpdays.ts");
const { schema } = await import("../db/index.ts");

import { Hono } from "hono";

function createApp() {
  const app = new Hono();
  app.route("/api/jumpdays", jumpdayRoutes);
  return app;
}

function authedRequest(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Cookie", "session=valid-session");
  return new Request(`http://localhost${path}`, { ...init, headers });
}

describe("jumpdays routes", () => {
  beforeEach(() => {
    const db = testState.db!;
    db.delete(schema.assignments).run();
    db.delete(schema.jumpDays).run();
    db.delete(schema.userRoles).run();
    db.delete(schema.sessions).run();
    db.delete(schema.users).run();
    activeUserId = "test-user-1";

    // Seed an admin user with all roles
    seedTestUserWithRoles(db, [
      "admin",
      "sdl",
      "manifest",
      "pilot",
      "tandem_master",
      "instructor",
      "load_organizer",
    ]);
  });

  describe("GET /api/jumpdays", () => {
    it("returns 401 without auth", async () => {
      const app = createApp();
      const res = await app.request(new Request("http://localhost/api/jumpdays?month=2026-03"));
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid month format", async () => {
      const app = createApp();
      const res = await app.request(authedRequest("/api/jumpdays?month=invalid"));
      expect(res.status).toBe(400);
    });

    it("returns empty array when no jump days exist", async () => {
      const app = createApp();
      const res = await app.request(authedRequest("/api/jumpdays?month=2026-03"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it("returns jump days for the given month", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays)
        .values({ id: "jd-1", date: "2026-03-15", notes: "Good weather" })
        .run();
      db.insert(schema.jumpDays).values({ id: "jd-2", date: "2026-03-22" }).run();
      db.insert(schema.jumpDays).values({ id: "jd-other", date: "2026-04-01" }).run();

      const app = createApp();
      const res = await app.request(authedRequest("/api/jumpdays?month=2026-03"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
      expect(body[0].date).toBe("2026-03-15");
      expect(body[0].notes).toBe("Good weather");
      expect(body[1].date).toBe("2026-03-22");
    });
  });

  describe("POST /api/jumpdays", () => {
    it("creates a jump day", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays", {
          method: "POST",
          body: JSON.stringify({ date: "2026-03-15", notes: "Spring day" }),
        }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.date).toBe("2026-03-15");
      expect(body.notes).toBe("Spring day");
      expect(body.assignments).toEqual([]);
    });

    it("rejects invalid date format", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays", {
          method: "POST",
          body: JSON.stringify({ date: "not-a-date" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects duplicate dates", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "existing", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays", {
          method: "POST",
          body: JSON.stringify({ date: "2026-03-15" }),
        }),
      );
      expect(res.status).toBe(409);
    });
  });

  describe("DELETE /api/jumpdays/:id", () => {
    it("deletes a jump day", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(authedRequest("/api/jumpdays/jd-1", { method: "DELETE" }));
      expect(res.status).toBe(200);

      const remaining = db.select().from(schema.jumpDays).all();
      expect(remaining).toHaveLength(0);
    });

    it("returns 404 for non-existent jump day", async () => {
      const app = createApp();
      const res = await app.request(authedRequest("/api/jumpdays/fake", { method: "DELETE" }));
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/jumpdays/:id/signup", () => {
    it("signs up for an SDL role", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/signup", {
          method: "POST",
          body: JSON.stringify({ role: "sdl" }),
        }),
      );
      expect(res.status).toBe(201);

      const assignments = db.select().from(schema.assignments).all();
      expect(assignments).toHaveLength(1);
      expect(assignments[0]!.role).toBe("sdl");
      expect(assignments[0]!.userId).toBe("test-user-1");
    });

    it("signs up for a new role (pilot)", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/signup", {
          method: "POST",
          body: JSON.stringify({ role: "pilot" }),
        }),
      );
      expect(res.status).toBe(201);

      const assignments = db.select().from(schema.assignments).all();
      expect(assignments).toHaveLength(1);
      expect(assignments[0]!.role).toBe("pilot");
    });

    it("rejects same user signing up for same role twice", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-user-1", role: "sdl" })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/signup", {
          method: "POST",
          body: JSON.stringify({ role: "sdl" }),
        }),
      );
      expect(res.status).toBe(409);
    });

    it("allows different user to sign up for same role on same day", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      // First user signs up
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-user-1", role: "tandem_master" })
        .run();

      // Create second user and switch to them
      seedTestUserWithRoles(db, ["tandem_master"], {
        id: "test-user-2",
        email: "user2@example.com",
        name: "User 2",
        oauthProvider: "github",
        oauthId: "456",
      });
      activeUserId = "test-user-2";

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/signup", {
          method: "POST",
          body: JSON.stringify({ role: "tandem_master" }),
        }),
      );
      expect(res.status).toBe(201);

      const assignments = db.select().from(schema.assignments).all();
      expect(assignments).toHaveLength(2);
      expect(assignments.every((a) => a.role === "tandem_master")).toBe(true);
    });

    it("rejects invalid role", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/signup", {
          method: "POST",
          body: JSON.stringify({ role: "admin" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("rejects signup without qualification", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      // Create user without pilot role
      seedTestUser(db, {
        id: "test-user-nopilot",
        email: "nopilot@example.com",
        name: "No Pilot",
        oauthProvider: "google",
        oauthId: "789",
      });
      activeUserId = "test-user-nopilot";

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/signup", {
          method: "POST",
          body: JSON.stringify({ role: "pilot" }),
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/jumpdays/:id/signup", () => {
    it("withdraws from a role", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-user-1", role: "manifest" })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/signup", {
          method: "DELETE",
          body: JSON.stringify({ role: "manifest" }),
        }),
      );
      expect(res.status).toBe(200);

      const assignments = db.select().from(schema.assignments).all();
      expect(assignments).toHaveLength(0);
    });
  });
});
