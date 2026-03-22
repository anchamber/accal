import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as v from "valibot";
import { db, schema } from "../db/index.ts";
import { authMiddleware, requireRole } from "../middleware/auth.ts";
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
  const allUsers = db.select().from(schema.users).all();

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

export default users;
