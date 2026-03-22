import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestUser } from "../test-utils.ts";

// Mock the db module before importing session functions
const testState = { db: null as ReturnType<typeof createTestDb>["db"] | null };

vi.mock("../db/index.ts", () => {
  const { createTestDb } = require("../test-utils.ts");
  const { db, schema } = createTestDb();
  testState.db = db;
  return { db, schema, initDb: vi.fn() };
});

// Import after mock is set up
const { createSession, validateSession, deleteSession, cleanExpiredData } =
  await import("./session.ts");
const { schema } = await import("../db/index.ts");

describe("session management", () => {
  beforeEach(() => {
    // Clear tables between tests
    const db = testState.db!;
    db.delete(schema.sessions).run();
    db.delete(schema.magicLinkTokens).run();
    db.delete(schema.users).run();
  });

  describe("createSession", () => {
    it("creates a session and returns a session ID", () => {
      const db = testState.db!;
      seedTestUser(db);

      const sessionId = createSession("test-user-1");
      expect(sessionId).toBeTruthy();
      expect(sessionId).toHaveLength(40);

      const session = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .get();
      expect(session).toBeTruthy();
      expect(session!.userId).toBe("test-user-1");
    });

    it("sets expiry 30 days in the future", () => {
      const db = testState.db!;
      seedTestUser(db);

      const before = Date.now();
      const sessionId = createSession("test-user-1");
      const after = Date.now();

      const session = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .get();
      const expiryMs = session!.expiresAt.getTime();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;

      // SQLite stores timestamps with second precision, allow 2s tolerance
      expect(expiryMs).toBeGreaterThanOrEqual(before + thirtyDays - 2000);
      expect(expiryMs).toBeLessThanOrEqual(after + thirtyDays + 2000);
    });
  });

  describe("validateSession", () => {
    it("returns session for a valid session ID", () => {
      const db = testState.db!;
      seedTestUser(db);
      const sessionId = createSession("test-user-1");

      const result = validateSession(sessionId);
      expect(result).toBeTruthy();
      expect(result!.userId).toBe("test-user-1");
    });

    it("returns null for unknown session ID", () => {
      expect(validateSession("nonexistent")).toBeNull();
    });

    it("returns null and deletes expired session", () => {
      const db = testState.db!;
      seedTestUser(db);

      // Insert an already-expired session
      db.insert(schema.sessions)
        .values({
          id: "expired-session",
          userId: "test-user-1",
          expiresAt: new Date(Date.now() - 1000),
        })
        .run();

      const result = validateSession("expired-session");
      expect(result).toBeNull();

      // Verify it was deleted
      const session = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, "expired-session"))
        .get();
      expect(session).toBeUndefined();
    });
  });

  describe("deleteSession", () => {
    it("removes the session from the database", () => {
      const db = testState.db!;
      seedTestUser(db);
      const sessionId = createSession("test-user-1");

      deleteSession(sessionId);

      const session = db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .get();
      expect(session).toBeUndefined();
    });
  });

  describe("cleanExpiredData", () => {
    it("removes expired sessions and magic link tokens", () => {
      const db = testState.db!;
      seedTestUser(db);

      // Create one valid and one expired session
      createSession("test-user-1");
      db.insert(schema.sessions)
        .values({
          id: "expired-1",
          userId: "test-user-1",
          expiresAt: new Date(Date.now() - 1000),
        })
        .run();

      // Create one valid and one expired magic link token
      db.insert(schema.magicLinkTokens)
        .values({
          id: "valid-token",
          email: "test@example.com",
          expiresAt: new Date(Date.now() + 60_000),
        })
        .run();
      db.insert(schema.magicLinkTokens)
        .values({
          id: "expired-token",
          email: "test@example.com",
          expiresAt: new Date(Date.now() - 1000),
        })
        .run();

      cleanExpiredData();

      const sessions = db.select().from(schema.sessions).all();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).not.toBe("expired-1");

      const tokens = db.select().from(schema.magicLinkTokens).all();
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.id).toBe("valid-token");
    });
  });
});
