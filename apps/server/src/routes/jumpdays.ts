import { Hono } from "hono";
import { eq, and, like, count } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.ts";
import { authMiddleware, requireRole } from "../middleware/auth.ts";
import { ASSIGNMENT_ROLES } from "@accal/shared";
import type { JumpDay, Assignment, AssignmentRole } from "@accal/shared";

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
  const body = await c.req.json<{ role: AssignmentRole }>();

  if (!(ASSIGNMENT_ROLES as readonly string[]).includes(body.role)) {
    return c.json({ error: "Invalid role" }, 400);
  }

  // Check user has the required role
  if (!user.roles.includes(body.role)) {
    return c.json({ error: "You don't have this qualification" }, 403);
  }

  const day = db.select().from(schema.jumpDays).where(eq(schema.jumpDays.id, jumpDayId)).get();
  if (!day) return c.json({ error: "Jump day not found" }, 404);

  // Check max per day limit
  const roleConf = db
    .select()
    .from(schema.roleConfig)
    .where(eq(schema.roleConfig.role, body.role))
    .get();
  if (roleConf?.maxPerDay !== null && roleConf?.maxPerDay !== undefined) {
    const currentCount = db
      .select({ value: count() })
      .from(schema.assignments)
      .where(
        and(eq(schema.assignments.jumpDayId, jumpDayId), eq(schema.assignments.role, body.role)),
      )
      .get();
    if (currentCount && currentCount.value >= roleConf.maxPerDay) {
      return c.json({ error: "Maximum signups reached for this role" }, 409);
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
        eq(schema.assignments.role, body.role),
      ),
    )
    .get();
  if (existing) {
    return c.json({ error: "You are already signed up for this role" }, 409);
  }

  db.insert(schema.assignments).values({ jumpDayId, userId: user.id, role: body.role }).run();

  return c.json({ ok: true }, 201);
});

// Withdraw from a role
jumpdays.delete("/:id/signup", async (c) => {
  const jumpDayId = c.req.param("id")!;
  const user = c.get("user");
  const body = await c.req.json<{ role: AssignmentRole }>();

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
    const body = await c.req.json<{ ical: string }>();
    if (!body.ical) {
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
