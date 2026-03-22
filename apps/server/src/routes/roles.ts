import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as v from "valibot";
import { db, schema } from "../db/index.ts";
import { authMiddleware, requireRole } from "../middleware/auth.ts";
import { parseBody } from "../middleware/validate.ts";
import type { RoleConfig, RequirementLevel } from "@accal/shared";

const UpdateRoleConfigSchema = v.object({
  label: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(100))),
  requirement: v.optional(v.picklist(["required", "limiting", "optional"])),
  minPerDay: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  maxPerDay: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
});

const roles = new Hono();

roles.use("*", authMiddleware);

// Get all role configs
roles.get("/config", (c) => {
  const configs = db.select().from(schema.roleConfig).all();
  const result: RoleConfig[] = configs.map((rc) => ({
    role: rc.role as RoleConfig["role"],
    label: rc.label,
    requirement: rc.requirement as RequirementLevel,
    minPerDay: rc.minPerDay,
    maxPerDay: rc.maxPerDay,
  }));
  return c.json(result);
});

// Update a role config (admin only)
roles.patch("/config/:role", requireRole("admin"), async (c) => {
  const role = c.req.param("role");
  const existing = db
    .select()
    .from(schema.roleConfig)
    .where(eq(schema.roleConfig.role, role as string))
    .get();
  if (!existing) {
    return c.json({ error: "Unknown role" }, 404);
  }

  const body = await parseBody(c, UpdateRoleConfigSchema);
  if (!body) return c.json({ error: "Invalid input" }, 400);

  const updates: Record<string, unknown> = {};
  if (body.label !== undefined) updates.label = body.label;
  if (body.requirement !== undefined) updates.requirement = body.requirement;
  if (body.minPerDay !== undefined) updates.minPerDay = body.minPerDay;
  if (body.maxPerDay !== undefined) updates.maxPerDay = body.maxPerDay;

  if (Object.keys(updates).length > 0) {
    db.update(schema.roleConfig)
      .set(updates)
      .where(eq(schema.roleConfig.role, role as string))
      .run();
  }

  const updated = db
    .select()
    .from(schema.roleConfig)
    .where(eq(schema.roleConfig.role, role as string))
    .get()!;
  return c.json({
    role: updated.role,
    label: updated.label,
    requirement: updated.requirement,
    minPerDay: updated.minPerDay,
    maxPerDay: updated.maxPerDay,
  });
});

export default roles;
