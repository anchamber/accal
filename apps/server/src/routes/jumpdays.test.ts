import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  seedTestUser,
  seedTestUserWithRoles,
  seedTestProfile,
} from "../test-utils.ts";

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

vi.mock("../auth/email.ts", () => ({
  sendCancellationEmail: vi.fn().mockResolvedValue(undefined),
}));

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

const { default: jumpdayRoutes } = await import("./jumpdays.ts");
const { schema } = await import("../db/index.ts");
const { sendCancellationEmail } = await import("../auth/email.ts");

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
    db.delete(schema.roleConfig).run();
    db.delete(schema.userRoles).run();
    db.delete(schema.sessions).run();
    db.delete(schema.users).run();
    activeUserId = "test-user-1";
    vi.clearAllMocks();

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

  describe("PATCH /api/jumpdays/:id", () => {
    it("updates the date of a jump day", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1", {
          method: "PATCH",
          body: JSON.stringify({ date: "2026-03-20" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const updated = db.select().from(schema.jumpDays).all();
      expect(updated[0]!.date).toBe("2026-03-20");
    });

    it("updates notes of a jump day", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1", {
          method: "PATCH",
          body: JSON.stringify({ notes: "Updated notes" }),
        }),
      );
      expect(res.status).toBe(200);

      const updated = db.select().from(schema.jumpDays).all();
      expect(updated[0]!.notes).toBe("Updated notes");
    });

    it("clears notes by setting to null", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays)
        .values({ id: "jd-1", date: "2026-03-15", notes: "Some notes" })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1", {
          method: "PATCH",
          body: JSON.stringify({ notes: null }),
        }),
      );
      expect(res.status).toBe(200);

      const updated = db.select().from(schema.jumpDays).all();
      expect(updated[0]!.notes).toBeNull();
    });

    it("returns 404 for non-existent jump day", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/fake-id", {
          method: "PATCH",
          body: JSON.stringify({ notes: "test" }),
        }),
      );
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid input", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1", {
          method: "PATCH",
          body: JSON.stringify({ date: "not-a-date" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 403 for non-admin user", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      // Create a non-admin user
      seedTestUserWithRoles(db, ["pilot"], {
        id: "test-user-nonadmin",
        email: "nonadmin@example.com",
        name: "Non Admin",
        oauthProvider: "google",
        oauthId: "999",
      });
      activeUserId = "test-user-nonadmin";

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1", {
          method: "PATCH",
          body: JSON.stringify({ notes: "hack attempt" }),
        }),
      );
      expect(res.status).toBe(403);
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

    it("rejects signup when max per day is reached", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      // Configure SDL to have maxPerDay = 1
      db.insert(schema.roleConfig)
        .values({ role: "sdl", label: "SDL", requirement: "required", minPerDay: 1, maxPerDay: 1 })
        .run();

      // First user signs up as SDL
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-user-1", role: "sdl" })
        .run();

      // Create second user with SDL role
      seedTestUserWithRoles(db, ["sdl"], {
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
          body: JSON.stringify({ role: "sdl" }),
        }),
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("Maximum signups reached for this role");
    });

    it("allows signup when max per day is not reached", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      // Configure tandem_master with maxPerDay = 3
      db.insert(schema.roleConfig)
        .values({
          role: "tandem_master",
          label: "Tandem Master",
          requirement: "optional",
          minPerDay: 0,
          maxPerDay: 3,
        })
        .run();

      // One user already signed up
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-user-1", role: "tandem_master" })
        .run();

      // Second user signs up (2 of 3 max)
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

    it("returns 400 for invalid role in body", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/signup", {
          method: "DELETE",
          body: JSON.stringify({ role: "nonexistent_role" }),
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/jumpdays/import", () => {
    const validIcal = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260401",
      "DTEND;VALUE=DATE:20260402",
      "SUMMARY:Jump Day April",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260415",
      "DTEND;VALUE=DATE:20260416",
      "SUMMARY:Mid-April Jump",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    it("imports events from multipart file upload", async () => {
      const app = createApp();
      const formData = new FormData();
      formData.append("file", new File([validIcal], "events.ics", { type: "text/calendar" }));

      const res = await app.request(
        new Request("http://localhost/api/jumpdays/import", {
          method: "POST",
          headers: { Cookie: "session=valid-session" },
          body: formData,
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.created).toBe(2);
      expect(body.skipped).toBe(0);
      expect(body.total).toBe(2);

      const db = testState.db!;
      const days = db.select().from(schema.jumpDays).all();
      expect(days).toHaveLength(2);
    });

    it("skips dates that already exist", async () => {
      const db = testState.db!;
      // Pre-seed one of the dates from the iCal
      db.insert(schema.jumpDays).values({ id: "existing-1", date: "2026-04-01" }).run();

      const app = createApp();
      const formData = new FormData();
      formData.append("file", new File([validIcal], "events.ics", { type: "text/calendar" }));

      const res = await app.request(
        new Request("http://localhost/api/jumpdays/import", {
          method: "POST",
          headers: { Cookie: "session=valid-session" },
          body: formData,
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.created).toBe(1);
      expect(body.skipped).toBe(1);
      expect(body.total).toBe(2);
    });

    it("returns 400 when no file provided in multipart", async () => {
      const app = createApp();
      const formData = new FormData();
      // Append a text field instead of a file
      formData.append("other", "not-a-file");

      const res = await app.request(
        new Request("http://localhost/api/jumpdays/import", {
          method: "POST",
          headers: { Cookie: "session=valid-session" },
          body: formData,
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("No file provided");
    });

    it("returns 400 for empty iCal data (no events)", async () => {
      const emptyIcal = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";
      const app = createApp();
      const formData = new FormData();
      formData.append("file", new File([emptyIcal], "empty.ics", { type: "text/calendar" }));

      const res = await app.request(
        new Request("http://localhost/api/jumpdays/import", {
          method: "POST",
          headers: { Cookie: "session=valid-session" },
          body: formData,
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("No events found in iCal file");
    });

    it("imports via JSON body", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/import", {
          method: "POST",
          body: JSON.stringify({ ical: validIcal }),
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.created).toBe(2);
    });

    it("returns 400 for empty JSON ical field", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/import", {
          method: "POST",
          body: JSON.stringify({ ical: "" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 403 for non-admin user", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "test-user-nonadmin",
        email: "nonadmin@example.com",
        name: "Non Admin",
        oauthProvider: "google",
        oauthId: "999",
      });
      activeUserId = "test-user-nonadmin";

      const app = createApp();
      const formData = new FormData();
      formData.append("file", new File([validIcal], "events.ics", { type: "text/calendar" }));

      const res = await app.request(
        new Request("http://localhost/api/jumpdays/import", {
          method: "POST",
          headers: { Cookie: "session=valid-session" },
          body: formData,
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/jumpdays/:id/cancel", () => {
    it("cancels a jump day (sets canceledAt)", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/cancel", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(200);

      const updated = db.select().from(schema.jumpDays).all();
      expect(updated[0]!.canceledAt).not.toBeNull();
    });

    it("stores cancel reason when provided", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/cancel", {
          method: "POST",
          body: JSON.stringify({ reason: "Bad weather" }),
        }),
      );
      expect(res.status).toBe(200);

      const updated = db.select().from(schema.jumpDays).all();
      expect(updated[0]!.cancelReason).toBe("Bad weather");
    });

    it("returns 404 for non-existent jump day", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/fake-id/cancel", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(404);
    });

    it("returns 400 when already canceled", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays)
        .values({ id: "jd-c", date: "2026-03-15", canceledAt: new Date() })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-c/cancel", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 403 for non-admin", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      seedTestUserWithRoles(db, ["pilot"], {
        id: "test-user-nonadmin",
        email: "nonadmin@example.com",
        name: "Non Admin",
        oauthProvider: "google",
        oauthId: "999",
      });
      activeUserId = "test-user-nonadmin";

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/cancel", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(403);
    });

    it("returns 401 without auth", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/jumpdays/jd-1/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("sends cancellation email to assigned users", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      // Create an assigned user
      seedTestUserWithRoles(db, ["pilot"], {
        id: "test-user-assigned",
        email: "assigned@example.com",
        name: "Assigned User",
        oauthProvider: "github",
        oauthId: "555",
      });
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-user-assigned", role: "pilot" })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/cancel", {
          method: "POST",
          body: JSON.stringify({ reason: "High winds" }),
        }),
      );
      expect(res.status).toBe(200);

      // Wait for fire-and-forget promise
      await new Promise((r) => setTimeout(r, 50));

      expect(sendCancellationEmail).toHaveBeenCalledWith(
        "assigned@example.com",
        "Assigned User",
        "2026-03-15",
        "pilot",
        "High winds",
      );
    });

    it("does not send email to deleted users", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      // Create a deleted user with assignment
      seedTestUserWithRoles(db, ["pilot"], {
        id: "test-user-deleted",
        email: "deleted@example.com",
        name: "Deleted User",
        oauthProvider: "github",
        oauthId: "666",
      });
      db.update(schema.users)
        .set({ deletedAt: new Date() })
        .where(eq(schema.users.id, "test-user-deleted"))
        .run();
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-user-deleted", role: "pilot" })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/cancel", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(200);

      // Wait for fire-and-forget promise
      await new Promise((r) => setTimeout(r, 50));

      expect(sendCancellationEmail).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/jumpdays/:id/reinstate", () => {
    it("reinstates a canceled jump day (clears canceledAt and cancelReason)", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays)
        .values({
          id: "jd-c",
          date: "2026-03-15",
          canceledAt: new Date(),
          cancelReason: "Bad weather",
        })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-c/reinstate", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(200);

      const updated = db.select().from(schema.jumpDays).all();
      expect(updated[0]!.canceledAt).toBeNull();
      expect(updated[0]!.cancelReason).toBeNull();
    });

    it("returns 404 for non-existent jump day", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/fake-id/reinstate", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(404);
    });

    it("returns 400 when not canceled", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-03-15" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/reinstate", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 403 for non-admin", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays)
        .values({ id: "jd-c", date: "2026-03-15", canceledAt: new Date() })
        .run();

      seedTestUserWithRoles(db, ["pilot"], {
        id: "test-user-nonadmin",
        email: "nonadmin@example.com",
        name: "Non Admin",
        oauthProvider: "google",
        oauthId: "999",
      });
      activeUserId = "test-user-nonadmin";

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-c/reinstate", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(403);
    });

    it("returns 401 without auth", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/jumpdays/jd-1/reinstate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("signup on canceled day", () => {
    it("returns 400 when trying to sign up on a canceled jump day", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays)
        .values({ id: "jd-c", date: "2026-03-15", canceledAt: new Date() })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-c/signup", {
          method: "POST",
          body: JSON.stringify({ role: "sdl" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Jump day is canceled");
    });
  });

  describe("security - 401 without auth cookie", () => {
    it("GET /api/jumpdays returns 401", async () => {
      const app = createApp();
      const res = await app.request(new Request("http://localhost/api/jumpdays?month=2026-03"));
      expect(res.status).toBe(401);
    });

    it("POST /api/jumpdays returns 401", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/jumpdays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: "2026-03-15" }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("PATCH /api/jumpdays/:id returns 401", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/jumpdays/jd-1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: "test" }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("DELETE /api/jumpdays/:id returns 401", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/jumpdays/jd-1", { method: "DELETE" }),
      );
      expect(res.status).toBe(401);
    });

    it("POST /api/jumpdays/:id/signup returns 401", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/jumpdays/jd-1/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "sdl" }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("DELETE /api/jumpdays/:id/signup returns 401", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/jumpdays/jd-1/signup", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "sdl" }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("POST /api/jumpdays/import returns 401", async () => {
      const app = createApp();
      const res = await app.request(
        new Request("http://localhost/api/jumpdays/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ical: "BEGIN:VCALENDAR\nEND:VCALENDAR" }),
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/jumpdays/:id/assign (admin)", () => {
    it("admin can assign a user to a role", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      seedTestUserWithRoles(db, ["pilot"], {
        id: "pilot-user",
        email: "pilot@example.com",
        name: "Pilot",
        oauthProvider: "github",
        oauthId: "pilot-oauth",
      });

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/assign", {
          method: "POST",
          body: JSON.stringify({ userId: "pilot-user", role: "pilot" }),
        }),
      );
      expect(res.status).toBe(201);

      const assignments = db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.jumpDayId, "jd-1"))
        .all();
      expect(assignments).toHaveLength(1);
      expect(assignments[0].userId).toBe("pilot-user");
      expect(assignments[0].role).toBe("pilot");
    });

    it("admin can assign a profile to a role", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      seedTestProfile(db, "External Pilot", ["pilot"]);

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/assign", {
          method: "POST",
          body: JSON.stringify({ userId: "test-profile-1", role: "pilot" }),
        }),
      );
      expect(res.status).toBe(201);
    });

    it("rejects if user lacks the role qualification", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      seedTestUserWithRoles(db, ["manifest"], {
        id: "manifest-user",
        email: "manifest@example.com",
        name: "Manifest",
        oauthProvider: "github",
        oauthId: "manifest-oauth",
      });

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/assign", {
          method: "POST",
          body: JSON.stringify({ userId: "manifest-user", role: "pilot" }),
        }),
      );
      expect(res.status).toBe(403);
    });

    it("rejects duplicate assignment", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      seedTestUserWithRoles(db, ["pilot"], {
        id: "pilot-user",
        email: "pilot@example.com",
        name: "Pilot",
        oauthProvider: "github",
        oauthId: "pilot-oauth",
      });
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "pilot-user", role: "pilot" })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/assign", {
          method: "POST",
          body: JSON.stringify({ userId: "pilot-user", role: "pilot" }),
        }),
      );
      expect(res.status).toBe(409);
    });

    it("respects maxPerDay limit", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      db.insert(schema.roleConfig)
        .values({ role: "sdl", label: "SDL", requirement: "required", minPerDay: 1, maxPerDay: 1 })
        .run();

      // First user already assigned as sdl
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-user-1", role: "sdl" })
        .run();

      seedTestProfile(db, "Another SDL", ["sdl"]);

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/assign", {
          method: "POST",
          body: JSON.stringify({ userId: "test-profile-1", role: "sdl" }),
        }),
      );
      expect(res.status).toBe(409);
    });

    it("rejects assignment to canceled jump day", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays)
        .values({ id: "jd-1", date: "2026-04-01", canceledAt: new Date() })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/assign", {
          method: "POST",
          body: JSON.stringify({ userId: "test-user-1", role: "sdl" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent jump day", async () => {
      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/nonexistent/assign", {
          method: "POST",
          body: JSON.stringify({ userId: "test-user-1", role: "sdl" }),
        }),
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent user", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/assign", {
          method: "POST",
          body: JSON.stringify({ userId: "nonexistent", role: "sdl" }),
        }),
      );
      expect(res.status).toBe(404);
    });

    it("non-admin cannot use assign endpoint", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "non-admin",
        email: "nonadmin@example.com",
        name: "Non Admin",
        oauthProvider: "google",
        oauthId: "na-oauth",
      });
      activeUserId = "non-admin";

      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/assign", {
          method: "POST",
          body: JSON.stringify({ userId: "test-user-1", role: "sdl" }),
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/jumpdays/:id/assign (admin)", () => {
    it("admin can unassign a user from a role", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-user-1", role: "sdl" })
        .run();

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/assign", {
          method: "DELETE",
          body: JSON.stringify({ userId: "test-user-1", role: "sdl" }),
        }),
      );
      expect(res.status).toBe(200);

      const assignments = db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.jumpDayId, "jd-1"))
        .all();
      expect(assignments).toHaveLength(0);
    });

    it("non-admin cannot use unassign endpoint", async () => {
      const db = testState.db!;
      seedTestUserWithRoles(db, ["pilot"], {
        id: "non-admin",
        email: "nonadmin@example.com",
        name: "Non Admin",
        oauthProvider: "google",
        oauthId: "na-oauth",
      });
      activeUserId = "non-admin";

      const app = createApp();
      const res = await app.request(
        authedRequest("/api/jumpdays/jd-1/assign", {
          method: "DELETE",
          body: JSON.stringify({ userId: "test-user-1", role: "sdl" }),
        }),
      );
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/jumpdays isProfile flag", () => {
    it("returns isProfile: true for profile assignments", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      seedTestProfile(db, "Profile Pilot", ["pilot"]);
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-profile-1", role: "pilot" })
        .run();

      const app = createApp();
      const res = await app.request(authedRequest("/api/jumpdays?month=2026-04"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      const assignment = body[0].assignments[0];
      expect(assignment.user.name).toBe("Profile Pilot");
      expect(assignment.user.isProfile).toBe(true);
    });

    it("returns isProfile: false for real user assignments", async () => {
      const db = testState.db!;
      db.insert(schema.jumpDays).values({ id: "jd-1", date: "2026-04-01" }).run();
      db.insert(schema.assignments)
        .values({ jumpDayId: "jd-1", userId: "test-user-1", role: "sdl" })
        .run();

      const app = createApp();
      const res = await app.request(authedRequest("/api/jumpdays?month=2026-04"));
      expect(res.status).toBe(200);
      const body = await res.json();
      const assignment = body[0].assignments[0];
      expect(assignment.user.isProfile).toBe(false);
    });
  });
});
