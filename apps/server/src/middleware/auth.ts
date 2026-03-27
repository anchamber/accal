import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { validateSession } from "../auth/session.ts";
import { db, schema } from "../db/index.ts";
import type { Role } from "@accal/shared";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  roles: Role[];
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const sessionId = getCookie(c, "session");
  if (!sessionId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const session = validateSession(sessionId);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const user = db.select().from(schema.users).where(eq(schema.users.id, session.userId)).get();

  if (!user || user.deletedAt) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const roles = db
    .select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, user.id))
    .all()
    .map((r) => r.role as Role);

  c.set("user", {
    id: user.id,
    email: user.email!,
    name: user.name,
    avatarUrl: user.avatarUrl,
    roles,
  });

  await next();
}

export function requireRole(...requiredRoles: Role[]) {
  return async (c: Context, next: Next) => {
    const user = c.get("user");
    if (!user || !requiredRoles.some((r) => user.roles.includes(r))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  };
}
