import { Hono } from "hono";
import { eq, and, gte, isNull } from "drizzle-orm";
import * as v from "valibot";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.ts";
import { authMiddleware, requireRole } from "../middleware/auth.ts";
import { deleteAllUserSessions } from "../auth/session.ts";
import { parseBody } from "../middleware/validate.ts";
import { ROLES } from "@accal/shared";
import type { Role } from "@accal/shared";

const UpdateRolesSchema = v.object({
  roles: v.array(v.picklist(ROLES as unknown as [string, ...string[]])),
});

const UpdateNameSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
});

const users = new Hono();

users.use("*", authMiddleware);

// Update own name
users.patch("/me/name", async (c) => {
  const authUser = c.get("user");
  const body = await parseBody(c, UpdateNameSchema);
  if (!body) return c.json({ error: "Invalid input" }, 400);

  db.update(schema.users).set({ name: body.name }).where(eq(schema.users.id, authUser.id)).run();

  return c.json({ ok: true, name: body.name });
});

// List all users (admin)
users.get("/", requireRole("admin"), (c) => {
  const allUsers = db.select().from(schema.users).where(isNull(schema.users.deletedAt)).all();

  const result = allUsers.map((u) => {
    const roles = db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, u.id))
      .all()
      .map((r) => r.role);

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      oauthProvider: u.oauthProvider,
      roles,
    };
  });

  return c.json(result);
});

// Update user roles (admin)
users.patch("/:id/roles", requireRole("admin"), async (c) => {
  const userId = c.req.param("id")!;
  const body = await parseBody(c, UpdateRolesSchema);
  if (!body) return c.json({ error: "Invalid input" }, 400);

  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return c.json({ error: "User not found" }, 404);

  const roles = body.roles as Role[];

  // Check: if removing admin from this user, ensure at least one other admin remains
  const currentRoles = db
    .select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, userId))
    .all()
    .map((r) => r.role);
  const hadAdmin = currentRoles.includes("admin");
  const willHaveAdmin = roles.includes("admin");

  if (hadAdmin && !willHaveAdmin) {
    const allAdminRoles = db
      .select()
      .from(schema.userRoles)
      .all()
      .filter((r) => r.role === "admin");
    if (allAdminRoles.length <= 1) {
      return c.json({ error: "Cannot remove the last admin" }, 400);
    }
  }

  // Replace all roles
  db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId)).run();

  for (const role of roles) {
    db.insert(schema.userRoles)
      .values({ userId, role } as typeof schema.userRoles.$inferInsert)
      .run();
  }

  return c.json({ ok: true, roles });
});

// Preview deletion impact (admin)
users.get("/:id/delete-preview", requireRole("admin"), (c) => {
  const userId = c.req.param("id")!;
  const authUser = c.get("user");

  if (userId === authUser.id) {
    return c.json({ error: "Cannot delete yourself" }, 400);
  }

  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return c.json({ error: "User not found" }, 404);

  const isAdmin = db
    .select()
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.role, "admin")))
    .get();

  if (isAdmin) {
    const adminCount = db
      .select()
      .from(schema.userRoles)
      .all()
      .filter((r) => r.role === "admin").length;
    if (adminCount <= 1) {
      return c.json({ error: "Cannot delete the last admin" }, 400);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const futureAssignments = db
    .select({
      date: schema.jumpDays.date,
      role: schema.assignments.role,
    })
    .from(schema.assignments)
    .innerJoin(schema.jumpDays, eq(schema.assignments.jumpDayId, schema.jumpDays.id))
    .where(and(eq(schema.assignments.userId, userId), gte(schema.jumpDays.date, today)))
    .all();

  return c.json({ futureAssignments });
});

// Delete user (admin) — anonymizes PII, keeps record for past assignments
users.delete("/:id", requireRole("admin"), (c) => {
  const userId = c.req.param("id")!;
  const authUser = c.get("user");

  if (userId === authUser.id) {
    return c.json({ error: "Cannot delete yourself" }, 400);
  }

  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return c.json({ error: "User not found" }, 404);
  if (user.deletedAt) return c.json({ error: "User already deleted" }, 400);

  const isAdmin = db
    .select()
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.role, "admin")))
    .get();

  if (isAdmin) {
    const adminCount = db
      .select()
      .from(schema.userRoles)
      .all()
      .filter((r) => r.role === "admin").length;
    if (adminCount <= 1) {
      return c.json({ error: "Cannot delete the last admin" }, 400);
    }
  }

  // Anonymize PII
  db.update(schema.users)
    .set({
      name: "Deleted User",
      email: `deleted-${nanoid()}@deleted.local`,
      avatarUrl: null,
      oauthProvider: null,
      oauthId: null,
      deletedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .run();

  // Remove roles, sessions, passkeys
  db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId)).run();
  deleteAllUserSessions(userId);
  db.delete(schema.passkeyCredentials).where(eq(schema.passkeyCredentials.userId, userId)).run();

  // Remove future assignments (free slots), keep past ones
  const today = new Date().toISOString().slice(0, 10);
  const futureJumpDayIds = db
    .select({ id: schema.jumpDays.id })
    .from(schema.jumpDays)
    .where(gte(schema.jumpDays.date, today))
    .all()
    .map((d) => d.id);

  for (const jumpDayId of futureJumpDayIds) {
    db.delete(schema.assignments)
      .where(
        and(eq(schema.assignments.jumpDayId, jumpDayId), eq(schema.assignments.userId, userId)),
      )
      .run();
  }

  return c.json({ ok: true });
});

export default users;
