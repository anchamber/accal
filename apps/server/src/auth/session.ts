import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.ts";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createSession(userId: string): string {
  const id = nanoid(40);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  db.insert(schema.sessions).values({ id, userId, expiresAt }).run();
  return id;
}

export function validateSession(sessionId: string) {
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
    return null;
  }
  return session;
}

export function deleteSession(sessionId: string) {
  db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
}

export function cleanExpiredSessions() {
  db.delete(schema.sessions)
    .where(eq(schema.sessions.expiresAt, new Date(0)))
    .run();
}
