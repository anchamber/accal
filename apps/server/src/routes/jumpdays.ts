import { Hono } from "hono";
import { eq, and, like, count, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { db, schema } from "../db/index.ts";
import { authMiddleware, requireRole } from "../middleware/auth.ts";
import { parseBody } from "../middleware/validate.ts";
import { sendCancellationEmail } from "../auth/email.ts";
import { ASSIGNMENT_ROLES } from "@accal/shared";
import type { JumpDay, Assignment, AssignmentRole } from "@accal/shared";

const CreateJumpDaySchema = v.object({
  date: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2000)))),
});

const UpdateJumpDaySchema = v.object({
  date: v.optional(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))),
  notes: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(2000)))),
});

const CancelSchema = v.object({
  reason: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(500)))),
});

const SignupSchema = v.object({
  role: v.picklist(ASSIGNMENT_ROLES as unknown as [string, ...string[]]),
  backup: v.optional(v.boolean()),
});

const ImportIcalJsonSchema = v.object({
  ical: v.pipe(v.string(), v.minLength(1)),
});

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
      .orderBy(asc(schema.assignments.createdAt))
      .all();

    const assignments: Assignment[] = dayAssignments.map((a) => {
      const user = db.select().from(schema.users).where(eq(schema.users.id, a.userId)).get()!;
      return {
        role: a.role as Assignment["role"],
        backup: a.backup === 1,
        user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl, isProfile: !user.email },
      };
    });

    return {
      id: day.id,
      date: day.date,
      notes: day.notes,
      canceledAt: day.canceledAt?.toISOString() ?? null,
      cancelReason: day.cancelReason,
      assignments,
    };
  });

  return c.json(result);
});

// Create jump day (admin)
jumpdays.post("/", requireRole("admin"), async (c) => {
  const body = await parseBody(c, CreateJumpDaySchema);
  if (!body) {
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

  return c.json(
    {
      id,
      date: body.date,
      notes: body.notes ?? null,
      canceledAt: null,
      cancelReason: null,
      assignments: [],
    },
    201,
  );
});

// Update jump day (admin)
jumpdays.patch("/:id", requireRole("admin"), async (c) => {
  const id = c.req.param("id")!;
  const body = await parseBody(c, UpdateJumpDaySchema);
  if (!body) return c.json({ error: "Invalid input" }, 400);

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

// Cancel jump day (admin)
jumpdays.post("/:id/cancel", requireRole("admin"), async (c) => {
  const id = c.req.param("id")!;
  const body = await parseBody(c, CancelSchema);
  const reason = body?.reason?.trim() || null;

  const day = db.select().from(schema.jumpDays).where(eq(schema.jumpDays.id, id)).get();
  if (!day) return c.json({ error: "Not found" }, 404);
  if (day.canceledAt) return c.json({ error: "Already canceled" }, 400);

  db.update(schema.jumpDays)
    .set({ canceledAt: new Date(), cancelReason: reason })
    .where(eq(schema.jumpDays.id, id))
    .run();

  // Notify assigned users via email (fire-and-forget)
  const dayAssignments = db
    .select()
    .from(schema.assignments)
    .where(eq(schema.assignments.jumpDayId, id))
    .all();

  for (const assignment of dayAssignments) {
    const assignedUser = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, assignment.userId))
      .get();
    if (assignedUser?.email && !assignedUser.deletedAt) {
      sendCancellationEmail(
        assignedUser.email,
        assignedUser.name,
        day.date,
        assignment.role,
        reason,
      ).catch((err) =>
        console.error(`Failed to send cancellation email to ${assignedUser.email}:`, err),
      );
    }
  }

  return c.json({ ok: true });
});

// Reinstate canceled jump day (admin)
jumpdays.post("/:id/reinstate", requireRole("admin"), (c) => {
  const id = c.req.param("id")!;
  const day = db.select().from(schema.jumpDays).where(eq(schema.jumpDays.id, id)).get();
  if (!day) return c.json({ error: "Not found" }, 404);
  if (!day.canceledAt) return c.json({ error: "Not canceled" }, 400);

  db.update(schema.jumpDays)
    .set({ canceledAt: null, cancelReason: null })
    .where(eq(schema.jumpDays.id, id))
    .run();

  return c.json({ ok: true });
});

// Sign up for a role
jumpdays.post("/:id/signup", async (c) => {
  const jumpDayId = c.req.param("id")!;
  const user = c.get("user");
  const body = await parseBody(c, SignupSchema);
  if (!body) {
    return c.json({ error: "Invalid role" }, 400);
  }
  const role = body.role as AssignmentRole;
  const isBackup = body.backup ? 1 : 0;

  // Check user has the required role
  if (!user.roles.includes(role)) {
    return c.json({ error: "You don't have this qualification" }, 403);
  }

  const day = db.select().from(schema.jumpDays).where(eq(schema.jumpDays.id, jumpDayId)).get();
  if (!day) return c.json({ error: "Jump day not found" }, 404);
  if (day.canceledAt) return c.json({ error: "Jump day is canceled" }, 400);

  // Check max per day limit (only for primary assignments)
  if (!isBackup) {
    const roleConf = db
      .select()
      .from(schema.roleConfig)
      .where(eq(schema.roleConfig.role, role as string))
      .get();
    if (roleConf?.maxPerDay !== null && roleConf?.maxPerDay !== undefined) {
      const currentCount = db
        .select({ value: count() })
        .from(schema.assignments)
        .where(
          and(
            eq(schema.assignments.jumpDayId, jumpDayId),
            eq(schema.assignments.role, role),
            eq(schema.assignments.backup, 0),
          ),
        )
        .get();
      if (currentCount && currentCount.value >= roleConf.maxPerDay) {
        return c.json({ error: "Maximum signups reached for this role" }, 409);
      }
    }
  }

  // Check if this user is already signed up for this role on this day
  const existing = db
    .select()
    .from(schema.assignments)
    .where(
      and(
        eq(schema.assignments.jumpDayId, jumpDayId),
        eq(schema.assignments.userId, user.id),
        eq(schema.assignments.role, role),
      ),
    )
    .get();
  if (existing) {
    return c.json({ error: "You are already signed up for this role" }, 409);
  }

  db.insert(schema.assignments)
    .values({ jumpDayId, userId: user.id, role, backup: isBackup })
    .run();

  return c.json({ ok: true }, 201);
});

// Withdraw from a role
jumpdays.delete("/:id/signup", async (c) => {
  const jumpDayId = c.req.param("id")!;
  const user = c.get("user");
  const body = await parseBody(c, SignupSchema);
  if (!body) return c.json({ error: "Invalid role" }, 400);
  const role = body.role as AssignmentRole;

  db.delete(schema.assignments)
    .where(
      and(
        eq(schema.assignments.jumpDayId, jumpDayId),
        eq(schema.assignments.userId, user.id),
        eq(schema.assignments.role, role),
      ),
    )
    .run();

  return c.json({ ok: true });
});

const AdminAssignSchema = v.object({
  userId: v.pipe(v.string(), v.minLength(1)),
  role: v.picklist(ASSIGNMENT_ROLES as unknown as [string, ...string[]]),
  backup: v.optional(v.boolean()),
});

// Admin assign a user/profile to a role on a jump day
jumpdays.post("/:id/assign", requireRole("admin"), async (c) => {
  const jumpDayId = c.req.param("id")!;
  const body = await parseBody(c, AdminAssignSchema);
  if (!body) return c.json({ error: "Invalid input" }, 400);
  const role = body.role as AssignmentRole;
  const isBackup = body.backup ? 1 : 0;

  const day = db.select().from(schema.jumpDays).where(eq(schema.jumpDays.id, jumpDayId)).get();
  if (!day) return c.json({ error: "Jump day not found" }, 404);
  if (day.canceledAt) return c.json({ error: "Jump day is canceled" }, 400);

  // Verify user/profile exists and is not deleted
  const target = db.select().from(schema.users).where(eq(schema.users.id, body.userId)).get();
  if (!target || target.deletedAt) return c.json({ error: "User not found" }, 404);

  // Verify user/profile has the required role
  const hasRole = db
    .select()
    .from(schema.userRoles)
    .where(and(eq(schema.userRoles.userId, body.userId), eq(schema.userRoles.role, role)))
    .get();
  if (!hasRole) return c.json({ error: "User does not have this role qualification" }, 403);

  // Check max per day limit (only for primary assignments)
  if (!isBackup) {
    const roleConf = db
      .select()
      .from(schema.roleConfig)
      .where(eq(schema.roleConfig.role, role as string))
      .get();
    if (roleConf?.maxPerDay !== null && roleConf?.maxPerDay !== undefined) {
      const currentCount = db
        .select({ value: count() })
        .from(schema.assignments)
        .where(
          and(
            eq(schema.assignments.jumpDayId, jumpDayId),
            eq(schema.assignments.role, role),
            eq(schema.assignments.backup, 0),
          ),
        )
        .get();
      if (currentCount && currentCount.value >= roleConf.maxPerDay) {
        return c.json({ error: "Maximum assignments reached for this role" }, 409);
      }
    }
  }

  // Check duplicate
  const existing = db
    .select()
    .from(schema.assignments)
    .where(
      and(
        eq(schema.assignments.jumpDayId, jumpDayId),
        eq(schema.assignments.userId, body.userId),
        eq(schema.assignments.role, role),
      ),
    )
    .get();
  if (existing) return c.json({ error: "Already assigned for this role" }, 409);

  db.insert(schema.assignments)
    .values({ jumpDayId, userId: body.userId, role, backup: isBackup })
    .run();

  return c.json({ ok: true }, 201);
});

// Admin unassign a user/profile from a role on a jump day
jumpdays.delete("/:id/assign", requireRole("admin"), async (c) => {
  const jumpDayId = c.req.param("id")!;
  const body = await parseBody(c, AdminAssignSchema);
  if (!body) return c.json({ error: "Invalid input" }, 400);
  const role = body.role as AssignmentRole;

  db.delete(schema.assignments)
    .where(
      and(
        eq(schema.assignments.jumpDayId, jumpDayId),
        eq(schema.assignments.userId, body.userId),
        eq(schema.assignments.role, role),
      ),
    )
    .run();

  return c.json({ ok: true });
});

// Import jump days from iCal file
jumpdays.post("/import", requireRole("admin"), async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  let icalText: string;

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }
    const MAX_ICAL_SIZE = 2 * 1024 * 1024; // 2 MB
    if (file.size > MAX_ICAL_SIZE) {
      return c.json({ error: "File too large (max 2 MB)" }, 413);
    }
    icalText = await file.text();
  } else {
    const body = await parseBody(c, ImportIcalJsonSchema);
    if (!body) {
      return c.json({ error: "No iCal data provided" }, 400);
    }
    icalText = body.ical;
  }

  // Parse VEVENT blocks and expand multi-day events
  const events = parseIcalEvents(icalText);
  const dates = expandEventDates(events);
  if (dates.length === 0) {
    return c.json({ error: "No events found in iCal file" }, 400);
  }

  let created = 0;
  let skipped = 0;

  for (const entry of dates) {
    const existing = db
      .select()
      .from(schema.jumpDays)
      .where(eq(schema.jumpDays.date, entry.date))
      .get();

    if (existing) {
      skipped++;
      continue;
    }

    const id = nanoid();
    db.insert(schema.jumpDays)
      .values({ id, date: entry.date, notes: entry.summary || null })
      .run();
    created++;
  }

  return c.json({ created, skipped, total: dates.length });
});

export interface IcalEvent {
  dtstart: string; // YYYY-MM-DD
  dtend: string | null; // YYYY-MM-DD (exclusive) or null
  summary: string | null;
}

export function parseIcalEvents(ical: string): IcalEvent[] {
  const events: IcalEvent[] = [];
  // Unfold lines (RFC 5545: continuation lines start with a space)
  const lines = ical.replace(/\r\n /g, "").replace(/\r/g, "\n").split("\n");

  let inEvent = false;
  let dtstart = "";
  let dtend: string | null = null;
  let summary: string | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      dtstart = "";
      dtend = null;
      summary = null;
    } else if (line === "END:VEVENT") {
      if (inEvent && dtstart) {
        events.push({ dtstart, dtend, summary });
      }
      inEvent = false;
    } else if (inEvent) {
      if (line.startsWith("DTSTART")) {
        dtstart = parseIcalDate(line);
      } else if (line.startsWith("DTEND")) {
        dtend = parseIcalDate(line);
      } else if (line.startsWith("SUMMARY:")) {
        summary = line.slice(8).trim();
      }
    }
  }

  return events;
}

function parseIcalDate(line: string): string {
  const value = line.split(":").slice(1).join(":");
  const raw = value.replace(/T.*$/, "");
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return "";
}

export function expandEventDates(events: IcalEvent[]): { date: string; summary: string | null }[] {
  const result: { date: string; summary: string | null }[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.dtstart)) continue;

    if (!event.dtend || event.dtend === event.dtstart) {
      // Single-day event
      if (!seen.has(event.dtstart)) {
        seen.add(event.dtstart);
        result.push({ date: event.dtstart, summary: event.summary });
      }
    } else {
      // Multi-day: iterate from dtstart to dtend (exclusive, per iCal spec)
      const start = new Date(event.dtstart + "T12:00:00Z");
      const end = new Date(event.dtend + "T12:00:00Z");
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const day = String(d.getUTCDate()).padStart(2, "0");
        const date = `${y}-${m}-${day}`;
        if (!seen.has(date)) {
          seen.add(date);
          result.push({ date, summary: event.summary });
        }
      }
    }
  }

  return result;
}

export default jumpdays;
