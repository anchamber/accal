import { Hono } from "hono";
import { eq, and, isNull } from "drizzle-orm";
import * as v from "valibot";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.ts";
import { authMiddleware, requireRole } from "../middleware/auth.ts";
import { parseBody } from "../middleware/validate.ts";
import { ASSIGNMENT_ROLES } from "@accal/shared";

const CreateProfileSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
  roles: v.array(v.picklist(ASSIGNMENT_ROLES as unknown as [string, ...string[]])),
});

const UpdateProfileSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100))),
  roles: v.optional(v.array(v.picklist(ASSIGNMENT_ROLES as unknown as [string, ...string[]]))),
});

const LinkProfileSchema = v.object({
  userId: v.pipe(v.string(), v.minLength(1)),
});

const profiles = new Hono();

profiles.use("*", authMiddleware);
profiles.use("*", requireRole("admin"));

// List all profiles
profiles.get("/", (c) => {
  const allProfiles = db
    .select()
    .from(schema.users)
    .where(and(isNull(schema.users.email), isNull(schema.users.deletedAt)))
    .all();

  const result = allProfiles.map((p) => {
    const roles = db
      .select()
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, p.id))
      .all()
      .map((r) => r.role);

    return { id: p.id, name: p.name, roles };
  });

  return c.json(result);
});

// Create a profile
profiles.post("/", async (c) => {
  const body = await parseBody(c, CreateProfileSchema);
  if (!body) return c.json({ error: "Invalid input" }, 400);

  const id = nanoid();
  db.insert(schema.users)
    .values({ id, email: null, name: body.name } as typeof schema.users.$inferInsert)
    .run();

  for (const role of body.roles) {
    db.insert(schema.userRoles)
      .values({ userId: id, role } as typeof schema.userRoles.$inferInsert)
      .run();
  }

  return c.json({ id, name: body.name, roles: body.roles }, 201);
});

// Update a profile
profiles.patch("/:id", async (c) => {
  const profileId = c.req.param("id")!;
  const body = await parseBody(c, UpdateProfileSchema);
  if (!body) return c.json({ error: "Invalid input" }, 400);

  const profile = db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, profileId), isNull(schema.users.email)))
    .get();
  if (!profile) return c.json({ error: "Profile not found" }, 404);

  if (body.name) {
    db.update(schema.users).set({ name: body.name }).where(eq(schema.users.id, profileId)).run();
  }

  if (body.roles) {
    db.delete(schema.userRoles).where(eq(schema.userRoles.userId, profileId)).run();
    for (const role of body.roles) {
      db.insert(schema.userRoles)
        .values({ userId: profileId, role } as typeof schema.userRoles.$inferInsert)
        .run();
    }
  }

  const roles = db
    .select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, profileId))
    .all()
    .map((r) => r.role);

  return c.json({ id: profileId, name: body.name || profile.name, roles });
});

// Delete a profile (hard delete — cascades assignments)
profiles.delete("/:id", (c) => {
  const profileId = c.req.param("id")!;

  const profile = db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, profileId), isNull(schema.users.email)))
    .get();
  if (!profile) return c.json({ error: "Profile not found" }, 404);

  db.delete(schema.users).where(eq(schema.users.id, profileId)).run();

  return c.json({ ok: true });
});

// Link a profile to a real user (merge assignments, then delete profile)
profiles.post("/:id/link", async (c) => {
  const profileId = c.req.param("id")!;
  const body = await parseBody(c, LinkProfileSchema);
  if (!body) return c.json({ error: "Invalid input" }, 400);

  const profile = db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, profileId), isNull(schema.users.email)))
    .get();
  if (!profile) return c.json({ error: "Profile not found" }, 404);

  const targetUser = db.select().from(schema.users).where(eq(schema.users.id, body.userId)).get();
  if (!targetUser || !targetUser.email) {
    return c.json({ error: "Target user not found" }, 404);
  }

  // Get profile's assignments
  const profileAssignments = db
    .select()
    .from(schema.assignments)
    .where(eq(schema.assignments.userId, profileId))
    .all();

  // Get target user's existing assignments for conflict detection
  const userAssignments = db
    .select()
    .from(schema.assignments)
    .where(eq(schema.assignments.userId, body.userId))
    .all();

  const userAssignmentKeys = new Set(userAssignments.map((a) => `${a.jumpDayId}:${a.role}`));

  let merged = 0;
  let skipped = 0;

  for (const pa of profileAssignments) {
    const key = `${pa.jumpDayId}:${pa.role}`;
    if (userAssignmentKeys.has(key)) {
      skipped++;
    } else {
      db.update(schema.assignments)
        .set({ userId: body.userId })
        .where(
          and(
            eq(schema.assignments.jumpDayId, pa.jumpDayId),
            eq(schema.assignments.userId, profileId),
            eq(schema.assignments.role, pa.role),
          ),
        )
        .run();
      merged++;
    }
  }

  // Merge roles: add profile roles to target user if missing
  const profileRoles = db
    .select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, profileId))
    .all()
    .map((r) => r.role);

  const userRoles = db
    .select()
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, body.userId))
    .all()
    .map((r) => r.role);

  const userRoleSet = new Set(userRoles);
  for (const role of profileRoles) {
    if (!userRoleSet.has(role)) {
      db.insert(schema.userRoles)
        .values({ userId: body.userId, role } as typeof schema.userRoles.$inferInsert)
        .run();
    }
  }

  // Delete profile (cascades remaining duplicate assignments)
  db.delete(schema.users).where(eq(schema.users.id, profileId)).run();

  return c.json({ ok: true, mergedAssignments: merged, skippedAssignments: skipped });
});

export default profiles;
