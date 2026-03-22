import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as v from "valibot";
import { db, schema } from "../db/index.ts";
import { createSession } from "../auth/session.ts";
import { sendMagicLinkEmail } from "../auth/email.ts";
import { grantAdminIfFirstUser } from "../auth/first-user.ts";
import { rateLimit } from "../middleware/rate-limit.ts";
import { parseBody } from "../middleware/validate.ts";

const SendMagicLinkSchema = v.object({
  email: v.pipe(v.string(), v.email(), v.maxLength(254)),
});

const magicLink = new Hono();

// 5 magic link emails per 15 minutes per IP
magicLink.use("/send", rateLimit({ max: 5, windowMs: 15 * 60 * 1000 }));

const TOKEN_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// --- Send magic link ---
magicLink.post("/send", async (c) => {
  const body = await parseBody(c, SendMagicLinkSchema);
  if (!body) {
    return c.json({ error: "Invalid email address" }, 400);
  }
  const email = body.email.trim().toLowerCase();

  // Clean up any existing tokens for this email
  const existing = db
    .select()
    .from(schema.magicLinkTokens)
    .where(eq(schema.magicLinkTokens.email, email))
    .all();
  for (const token of existing) {
    db.delete(schema.magicLinkTokens).where(eq(schema.magicLinkTokens.id, token.id)).run();
  }

  const token = nanoid(40);
  const expiresAt = new Date(Date.now() + TOKEN_DURATION_MS);

  db.insert(schema.magicLinkTokens).values({ id: token, email, expiresAt }).run();

  try {
    await sendMagicLinkEmail(email, token);
  } catch (err) {
    console.error("Failed to send magic link email:", err);
    return c.json({ error: "Failed to send email" }, 500);
  }

  return c.json({ ok: true });
});

// --- Verify magic link ---
magicLink.get("/verify", async (c) => {
  const token = c.req.query("token");
  if (!token) {
    return c.json({ error: "Missing token" }, 400);
  }

  const record = db
    .select()
    .from(schema.magicLinkTokens)
    .where(eq(schema.magicLinkTokens.id, token))
    .get();

  if (!record) {
    return c.json({ error: "Invalid or expired link" }, 400);
  }

  // Delete the token (single use)
  db.delete(schema.magicLinkTokens).where(eq(schema.magicLinkTokens.id, token)).run();

  if (record.expiresAt < new Date()) {
    return c.json({ error: "Link has expired" }, 400);
  }

  const email = record.email;

  // Find or create user by email
  let user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();

  if (!user) {
    const id = nanoid();
    const name = email.split("@")[0]!;
    db.insert(schema.users).values({ id, email, name, oauthProvider: null, oauthId: null }).run();
    user = db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
    grantAdminIfFirstUser(id);
  }

  const sessionId = createSession(user.id);
  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });

  return c.redirect("/");
});

export default magicLink;
