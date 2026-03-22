import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    oauthProvider: text("oauth_provider"),
    oauthId: text("oauth_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("users_oauth_idx").on(table.oauthProvider, table.oauthId),
    uniqueIndex("users_email_idx").on(table.email),
  ],
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "sdl", "manifest"] }).notNull(),
  },
  (table) => [uniqueIndex("user_roles_idx").on(table.userId, table.role)],
);

export const jumpDays = sqliteTable("jump_days", {
  id: text("id").primaryKey(),
  date: text("date").notNull().unique(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const assignments = sqliteTable(
  "assignments",
  {
    jumpDayId: text("jump_day_id")
      .notNull()
      .references(() => jumpDays.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["sdl", "manifest"] }).notNull(),
  },
  (table) => [uniqueIndex("assignments_role_idx").on(table.jumpDayId, table.role)],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

export const magicLinkTokens = sqliteTable("magic_link_tokens", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

export const passkeyCredentials = sqliteTable("passkey_credentials", {
  id: text("id").primaryKey(), // credential ID (base64url)
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(), // base64url-encoded
  counter: integer("counter").notNull().default(0),
  transports: text("transports"), // JSON array
  name: text("name").notNull().default("Passkey"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
