import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import * as arctic from "arctic";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getGoogle, getGitHub } from "../auth/providers.ts";
import { createSession, deleteSession } from "../auth/session.ts";
import { db, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";

const auth = new Hono();

// --- Login redirect ---
auth.get("/login/:provider", (c) => {
  const provider = c.req.param("provider");
  const state = arctic.generateState();

  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });

  if (provider === "google") {
    const codeVerifier = arctic.generateCodeVerifier();
    setCookie(c, "code_verifier", codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: 600,
      path: "/",
    });
    const url = getGoogle().createAuthorizationURL(state, codeVerifier, [
      "openid",
      "profile",
      "email",
    ]);
    return c.redirect(url.toString());
  }

  if (provider === "github") {
    const url = getGitHub().createAuthorizationURL(state, ["user:email"]);
    return c.redirect(url.toString());
  }

  return c.json({ error: "Unknown provider" }, 400);
});

// --- OAuth callback ---
auth.get("/callback/:provider", async (c) => {
  const provider = c.req.param("provider");
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, "oauth_state");

  if (!code || !state || state !== storedState) {
    return c.json({ error: "Invalid OAuth state" }, 400);
  }

  deleteCookie(c, "oauth_state");

  let oauthId: string;
  let email: string;
  let name: string;
  let avatarUrl: string | null = null;

  if (provider === "google") {
    const codeVerifier = getCookie(c, "code_verifier");
    if (!codeVerifier) return c.json({ error: "Missing code verifier" }, 400);
    deleteCookie(c, "code_verifier");

    const tokens = await getGoogle().validateAuthorizationCode(code, codeVerifier);
    const accessToken = tokens.accessToken();

    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = (await res.json()) as {
      sub: string;
      email: string;
      name: string;
      picture?: string;
    };
    oauthId = profile.sub;
    email = profile.email;
    name = profile.name;
    avatarUrl = profile.picture ?? null;
  } else if (provider === "github") {
    const tokens = await getGitHub().validateAuthorizationCode(code);
    const accessToken = tokens.accessToken();

    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = (await res.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
      email: string | null;
    };
    oauthId = String(profile.id);
    name = profile.name || profile.login;
    avatarUrl = profile.avatar_url;

    if (profile.email) {
      email = profile.email;
    } else {
      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const emails = (await emailRes.json()) as {
        email: string;
        primary: boolean;
      }[];
      const primary = emails.find((e) => e.primary);
      email = primary?.email ?? emails[0]!.email;
    }
  } else {
    return c.json({ error: "Unknown provider" }, 400);
  }

  // Find user by OAuth identity or by email (account linking)
  let user = db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.oauthProvider, provider), eq(schema.users.oauthId, oauthId)))
    .get();

  if (!user) {
    // Check if a user with this email already exists (e.g. from magic link)
    user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  }

  if (!user) {
    const id = nanoid();
    db.insert(schema.users)
      .values({ id, email, name, avatarUrl, oauthProvider: provider, oauthId })
      .run();
    user = db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;

    // First user gets admin role
    const userCount = db.select().from(schema.users).all().length;
    if (userCount === 1) {
      db.insert(schema.userRoles).values({ userId: id, role: "admin" }).run();
    }
  } else {
    // Update profile info and link OAuth if not yet linked
    db.update(schema.users)
      .set({
        name,
        avatarUrl,
        oauthProvider: user.oauthProvider || provider,
        oauthId: user.oauthId || oauthId,
      })
      .where(eq(schema.users.id, user.id))
      .run();
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

// --- Logout ---
auth.post("/logout", (c) => {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    deleteSession(sessionId);
    deleteCookie(c, "session");
  }
  return c.json({ ok: true });
});

// --- Current user ---
auth.get("/me", authMiddleware, (c) => {
  const user = c.get("user");
  const passkeys = db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.userId, user.id))
    .all();
  return c.json({ ...user, hasPasskey: passkeys.length > 0 });
});

export default auth;
