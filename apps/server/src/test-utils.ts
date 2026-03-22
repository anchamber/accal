import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema.ts";

const DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    oauth_provider TEXT,
    oauth_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_idx ON users(oauth_provider, oauth_id);
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);

  CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('admin', 'sdl', 'manifest', 'pilot', 'tandem_master', 'instructor', 'load_planner')),
    UNIQUE(user_id, role)
  );

  CREATE TABLE IF NOT EXISTS jump_days (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS assignments (
    jump_day_id TEXT NOT NULL REFERENCES jump_days(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('sdl', 'manifest', 'pilot', 'tandem_master', 'instructor', 'load_planner')),
    UNIQUE(jump_day_id, user_id, role)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS magic_link_tokens (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS role_config (
    role TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    requirement TEXT NOT NULL CHECK(requirement IN ('required', 'limiting', 'optional')),
    min_per_day INTEGER NOT NULL DEFAULT 0,
    max_per_day INTEGER
  );

  CREATE TABLE IF NOT EXISTS passkey_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    name TEXT NOT NULL DEFAULT 'Passkey',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`;

export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  const db = drizzle(sqlite, { schema });
  return { db, schema, sqlite };
}

export function seedTestUser(
  db: ReturnType<typeof createTestDb>["db"],
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const user = {
    id: "test-user-1",
    email: "test@example.com",
    name: "Test User",
    oauthProvider: "google",
    oauthId: "123",
    ...overrides,
  };
  db.insert(schema.users).values(user).run();
  return user;
}

export function seedTestUserWithRoles(
  db: ReturnType<typeof createTestDb>["db"],
  roles: string[],
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const user = seedTestUser(db, overrides);
  for (const role of roles) {
    db.insert(schema.userRoles)
      .values({ userId: user.id, role } as typeof schema.userRoles.$inferInsert)
      .run();
  }
  return user;
}
