import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { DEFAULT_ROLE_CONFIG, ASSIGNMENT_ROLES } from "@accal/shared";
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
      email TEXT,
      name TEXT NOT NULL,
      avatar_url TEXT,
      oauth_provider TEXT,
      oauth_id TEXT,
      deleted_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_idx ON users(oauth_provider, oauth_id);
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email) WHERE email IS NOT NULL;

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('admin', 'sdl', 'manifest', 'pilot', 'tandem_master', 'instructor', 'load_organizer')),
      UNIQUE(user_id, role)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_roles_idx ON user_roles(user_id, role);

    CREATE TABLE IF NOT EXISTS jump_days (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      notes TEXT,
      canceled_at INTEGER,
      cancel_reason TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS assignments (
      jump_day_id TEXT NOT NULL REFERENCES jump_days(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('sdl', 'manifest', 'pilot', 'tandem_master', 'instructor', 'load_organizer')),
      UNIQUE(jump_day_id, user_id, role)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS assignments_user_role_idx ON assignments(jump_day_id, user_id, role);

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
  sqlite.exec(ddl);

  // Migrations for existing databases
  const columns = sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "deleted_at")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN deleted_at INTEGER");
  }

  const jdColumns = sqlite.prepare("PRAGMA table_info(jump_days)").all() as { name: string }[];
  if (!jdColumns.some((c) => c.name === "canceled_at")) {
    sqlite.exec("ALTER TABLE jump_days ADD COLUMN canceled_at INTEGER");
  }
  if (!jdColumns.some((c) => c.name === "cancel_reason")) {
    sqlite.exec("ALTER TABLE jump_days ADD COLUMN cancel_reason TEXT");
  }

  // Migration: make email nullable for profiles support
  const emailCol = columns.find((c: any) => c.name === "email") as any;
  if (emailCol && emailCol.notnull === 1) {
    sqlite.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS users_new;
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT NOT NULL,
        avatar_url TEXT,
        oauth_provider TEXT,
        oauth_id TEXT,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO users_new SELECT id, email, name, avatar_url, oauth_provider, oauth_id, deleted_at, COALESCE(created_at, unixepoch()) FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE UNIQUE INDEX users_oauth_idx ON users(oauth_provider, oauth_id);
      CREATE UNIQUE INDEX users_email_idx ON users(email) WHERE email IS NOT NULL;
      PRAGMA foreign_keys = ON;
    `);
  }

  // Seed default role config for any missing roles
  const dbInstance = drizzle(sqlite, { schema });
  for (const role of ASSIGNMENT_ROLES) {
    const existing = dbInstance
      .select()
      .from(schema.roleConfig)
      .where(eq(schema.roleConfig.role, role))
      .get();
    if (!existing) {
      const defaults = DEFAULT_ROLE_CONFIG[role];
      dbInstance
        .insert(schema.roleConfig)
        .values({
          role,
          label: defaults.label,
          requirement: defaults.requirement,
          minPerDay: defaults.minPerDay,
          maxPerDay: defaults.maxPerDay,
        })
        .run();
    }
  }
}

export { schema };
