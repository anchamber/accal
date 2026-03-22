import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { authMiddleware, requireRole } from "../middleware/auth.ts";
import { ROLES } from "@accal/shared";
import type { Role } from "@accal/shared";

const users = new Hono();

users.use("*", authMiddleware);

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
  const body = await c.req.json<{ roles: Role[] }>();

  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return c.json({ error: "User not found" }, 404);

  const roles = body.roles.filter((r): r is Role => (ROLES as readonly string[]).includes(r));

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
