import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    oauthProvider: text("oauth_provider"),
    oauthId: text("oauth_id"),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [uniqueIndex("users_oauth_idx").on(table.oauthProvider, table.oauthId)],
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", {
      enum: ["admin", "sdl", "manifest", "pilot", "tandem_master", "instructor", "load_organizer"],
    }).notNull(),
  },
  (table) => [uniqueIndex("user_roles_idx").on(table.userId, table.role)],
);

export const jumpDays = sqliteTable("jump_days", {
  id: text("id").primaryKey(),
  date: text("date").notNull().unique(),
  notes: text("notes"),
  canceledAt: integer("canceled_at", { mode: "timestamp" }),
  cancelReason: text("cancel_reason"),
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
    role: text("role", {
      enum: ["sdl", "manifest", "pilot", "tandem_master", "instructor", "load_organizer"],
    }).notNull(),
  },
  (table) => [
    uniqueIndex("assignments_user_role_idx").on(table.jumpDayId, table.userId, table.role),
  ],
);

export const roleConfig = sqliteTable("role_config", {
  role: text("role").primaryKey(),
  label: text("label").notNull(),
  requirement: text("requirement", { enum: ["required", "limiting", "optional"] }).notNull(),
  minPerDay: integer("min_per_day").notNull().default(0),
  maxPerDay: integer("max_per_day"), // null = unlimited
});

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
