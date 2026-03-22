import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

// Resolve DB path: use env var, or default to <project-root>/data/accal.db
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(dirname(dirname(__dirname)));
const DB_PATH = process.env.DB_PATH || `${PROJECT_ROOT}/data/accal.db`;

// Ensure the directory exists before opening the database
mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function initDb() {
  // Create tables using better-sqlite3's exec (SQL DDL, not child_process)
  const ddl = `
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
      role TEXT NOT NULL CHECK(role IN ('admin', 'sdl', 'manifest')),
      UNIQUE(user_id, role)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_roles_idx ON user_roles(user_id, role);

    CREATE TABLE IF NOT EXISTS jump_days (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS assignments (
      jump_day_id TEXT NOT NULL REFERENCES jump_days(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('sdl', 'manifest')),
      UNIQUE(jump_day_id, role)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS assignments_role_idx ON assignments(jump_day_id, role);

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
  sqlite.exec(ddl);
}

export { schema };
