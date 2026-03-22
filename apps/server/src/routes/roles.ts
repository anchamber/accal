import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { authMiddleware, requireRole } from "../middleware/auth.ts";
import type { RoleConfig, RequirementLevel } from "@accal/shared";

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

  const body = await c.req.json<{
    label?: string;
    requirement?: RequirementLevel;
    minPerDay?: number;
    maxPerDay?: number | null;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.label !== undefined) updates.label = body.label;
  if (body.requirement !== undefined) {
    if (!["required", "limiting", "optional"].includes(body.requirement)) {
      return c.json({ error: "Invalid requirement level" }, 400);
    }
    updates.requirement = body.requirement;
  }
  if (body.minPerDay !== undefined) {
    if (typeof body.minPerDay !== "number" || body.minPerDay < 0) {
      return c.json({ error: "minPerDay must be a non-negative number" }, 400);
    }
    updates.minPerDay = body.minPerDay;
  }
  if (body.maxPerDay !== undefined) {
    if (body.maxPerDay !== null && (typeof body.maxPerDay !== "number" || body.maxPerDay < 1)) {
      return c.json({ error: "maxPerDay must be a positive number or null" }, 400);
    }
    updates.maxPerDay = body.maxPerDay;
  }

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
