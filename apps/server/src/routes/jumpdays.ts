import { Hono } from "hono";
import { eq, and, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.ts";
import { authMiddleware, requireRole } from "../middleware/auth.ts";
import type { JumpDay, Assignment } from "@accal/shared";

const jumpdays = new Hono();

jumpdays.use("*", authMiddleware);

// List jump days for a month
jumpdays.get("/", (c) => {
  const month = c.req.query("month"); // e.g. "2026-03"
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: "Invalid month format (YYYY-MM)" }, 400);
  }

  const days = db
    .select()
    .from(schema.jumpDays)
    .where(like(schema.jumpDays.date, `${month}%`))
    .all();

  const result: JumpDay[] = days.map((day) => {
    const dayAssignments = db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.jumpDayId, day.id))
      .all();

    const assignments: Assignment[] = dayAssignments.map((a) => {
      const user = db.select().from(schema.users).where(eq(schema.users.id, a.userId)).get()!;
      return {
        role: a.role as Assignment["role"],
        user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl },
      };
    });

    return {
      id: day.id,
      date: day.date,
      notes: day.notes,
      assignments,
    };
  });

  return c.json(result);
});

// Create jump day (admin)
jumpdays.post("/", requireRole("admin"), async (c) => {
  const body = await c.req.json<{ date: string; notes?: string }>();
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return c.json({ error: "Invalid date format (YYYY-MM-DD)" }, 400);
  }

  const existing = db
    .select()
    .from(schema.jumpDays)
    .where(eq(schema.jumpDays.date, body.date))
    .get();
  if (existing) {
    return c.json({ error: "Jump day already exists for this date" }, 409);
  }

  const id = nanoid();
  db.insert(schema.jumpDays)
    .values({ id, date: body.date, notes: body.notes ?? null })
    .run();

  return c.json({ id, date: body.date, notes: body.notes ?? null, assignments: [] }, 201);
});

// Update jump day (admin)
jumpdays.patch("/:id", requireRole("admin"), async (c) => {
  const id = c.req.param("id")!;
  const body = await c.req.json<{ date?: string; notes?: string | null }>();

  const day = db.select().from(schema.jumpDays).where(eq(schema.jumpDays.id, id)).get();
  if (!day) return c.json({ error: "Not found" }, 404);

  const updates: Record<string, unknown> = {};
  if (body.date !== undefined) updates.date = body.date;
  if (body.notes !== undefined) updates.notes = body.notes;

  if (Object.keys(updates).length > 0) {
    db.update(schema.jumpDays).set(updates).where(eq(schema.jumpDays.id, id)).run();
  }

  return c.json({ ok: true });
});

// Delete jump day (admin)
jumpdays.delete("/:id", requireRole("admin"), (c) => {
  const id = c.req.param("id")!;
  const day = db.select().from(schema.jumpDays).where(eq(schema.jumpDays.id, id)).get();
  if (!day) return c.json({ error: "Not found" }, 404);

  db.delete(schema.jumpDays).where(eq(schema.jumpDays.id, id)).run();
  return c.json({ ok: true });
});

// Sign up for a role
jumpdays.post("/:id/signup", async (c) => {
  const jumpDayId = c.req.param("id")!;
  const user = c.get("user");
  const body = await c.req.json<{ role: "sdl" | "manifest" }>();

  if (!["sdl", "manifest"].includes(body.role)) {
    return c.json({ error: "Invalid role" }, 400);
  }

  // Check user has the required role
  if (!user.roles.includes(body.role)) {
    return c.json({ error: "You don't have this qualification" }, 403);
  }

  const day = db.select().from(schema.jumpDays).where(eq(schema.jumpDays.id, jumpDayId)).get();
  if (!day) return c.json({ error: "Jump day not found" }, 404);

  // Check if role is already taken
  const existing = db
    .select()
    .from(schema.assignments)
    .where(and(eq(schema.assignments.jumpDayId, jumpDayId), eq(schema.assignments.role, body.role)))
    .get();
  if (existing) {
    return c.json({ error: "This role is already assigned" }, 409);
  }

  db.insert(schema.assignments).values({ jumpDayId, userId: user.id, role: body.role }).run();

  return c.json({ ok: true }, 201);
});

// Withdraw from a role
jumpdays.delete("/:id/signup", async (c) => {
  const jumpDayId = c.req.param("id")!;
  const user = c.get("user");
  const body = await c.req.json<{ role: "sdl" | "manifest" }>();

  db.delete(schema.assignments)
    .where(
      and(
        eq(schema.assignments.jumpDayId, jumpDayId),
        eq(schema.assignments.userId, user.id),
        eq(schema.assignments.role, body.role),
      ),
    )
    .run();

  return c.json({ ok: true });
});

export default jumpdays;
