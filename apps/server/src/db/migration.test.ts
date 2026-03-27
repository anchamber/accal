import { describe, it, expect } from "vite-plus/test";
import Database from "better-sqlite3";

describe("email nullable migration", () => {
  it("migrates existing DB with NOT NULL email to nullable", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    // Create old schema with email NOT NULL
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        avatar_url TEXT,
        oauth_provider TEXT,
        oauth_id TEXT,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE UNIQUE INDEX users_oauth_idx ON users(oauth_provider, oauth_id);
      CREATE UNIQUE INDEX users_email_idx ON users(email);
    `);

    // Insert a user before migration
    sqlite.exec(`INSERT INTO users (id, email, name) VALUES ('u1', 'test@example.com', 'Test')`);

    // Run migration (same logic as initDb)
    const columns = sqlite.prepare("PRAGMA table_info(users)").all() as any[];
    const emailCol = columns.find((c: any) => c.name === "email");
    expect(emailCol.notnull).toBe(1);

    sqlite.exec(`
      PRAGMA foreign_keys = OFF;
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
      INSERT INTO users_new SELECT * FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE UNIQUE INDEX users_oauth_idx ON users(oauth_provider, oauth_id);
      CREATE UNIQUE INDEX users_email_idx ON users(email) WHERE email IS NOT NULL;
      PRAGMA foreign_keys = ON;
    `);

    // Verify migration: email is now nullable
    const newColumns = sqlite.prepare("PRAGMA table_info(users)").all() as any[];
    const newEmailCol = newColumns.find((c: any) => c.name === "email");
    expect(newEmailCol.notnull).toBe(0);

    // Verify existing data preserved
    const user = sqlite.prepare("SELECT * FROM users WHERE id = 'u1'").get() as any;
    expect(user.email).toBe("test@example.com");
    expect(user.name).toBe("Test");

    // Verify we can now insert a user with NULL email (profile)
    sqlite.exec(`INSERT INTO users (id, email, name) VALUES ('p1', NULL, 'Profile')`);
    const profile = sqlite.prepare("SELECT * FROM users WHERE id = 'p1'").get() as any;
    expect(profile.email).toBeNull();
    expect(profile.name).toBe("Profile");

    // Verify multiple null emails are allowed (partial unique index)
    sqlite.exec(`INSERT INTO users (id, email, name) VALUES ('p2', NULL, 'Profile 2')`);
    const allProfiles = sqlite.prepare("SELECT * FROM users WHERE email IS NULL").all();
    expect(allProfiles).toHaveLength(2);

    // Verify email uniqueness still enforced for non-null emails
    expect(() => {
      sqlite.exec(`INSERT INTO users (id, email, name) VALUES ('u2', 'test@example.com', 'Dupe')`);
    }).toThrow();
  });

  it("fresh DB allows null email from the start", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    // New schema with nullable email
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT NOT NULL,
        avatar_url TEXT,
        oauth_provider TEXT,
        oauth_id TEXT,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE UNIQUE INDEX users_email_idx ON users(email) WHERE email IS NOT NULL;
    `);

    // Can insert profile (null email)
    sqlite.exec(`INSERT INTO users (id, email, name) VALUES ('p1', NULL, 'Profile')`);
    const profile = sqlite.prepare("SELECT * FROM users WHERE id = 'p1'").get() as any;
    expect(profile.email).toBeNull();

    // Can insert real user
    sqlite.exec(`INSERT INTO users (id, email, name) VALUES ('u1', 'user@test.com', 'User')`);

    // Duplicate email rejected
    expect(() => {
      sqlite.exec(`INSERT INTO users (id, email, name) VALUES ('u2', 'user@test.com', 'Dupe')`);
    }).toThrow();

    // Multiple null emails allowed
    sqlite.exec(`INSERT INTO users (id, email, name) VALUES ('p2', NULL, 'Profile 2')`);
    const profiles = sqlite.prepare("SELECT * FROM users WHERE email IS NULL").all();
    expect(profiles).toHaveLength(2);
  });
});
