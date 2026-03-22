import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { db, schema } from "../db/index.ts";
import { authMiddleware } from "../middleware/auth.ts";
import { createSession } from "../auth/session.ts";
import { rateLimit } from "../middleware/rate-limit.ts";

const passkey = new Hono();

// 10 passkey attempts per 15 minutes per IP
passkey.use("/login-options", rateLimit({ max: 10, windowMs: 15 * 60 * 1000 }));
passkey.use("/login-verify", rateLimit({ max: 10, windowMs: 15 * 60 * 1000 }));

function getRpId(): string {
  return process.env.WEBAUTHN_RP_ID || "localhost";
}

function getRpName(): string {
  return process.env.WEBAUTHN_RP_NAME || "accal";
}

function getOrigin(): string {
  return process.env.WEBAUTHN_ORIGIN || "http://localhost:5173";
}

function getUserPasskeys(userId: string) {
  return db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.userId, userId))
    .all();
}

function base64urlToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Registration (authenticated users only) ---

passkey.post("/register-options", authMiddleware, async (c) => {
  const user = c.get("user");
  const existingPasskeys = getUserPasskeys(user.id);

  const options = await generateRegistrationOptions({
    rpName: getRpName(),
    rpID: getRpId(),
    userName: user.email,
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((pk) => ({
      id: pk.id,
      transports: pk.transports
        ? (JSON.parse(pk.transports) as AuthenticatorTransportFuture[])
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  // Store challenge in cookie
  setCookie(c, "webauthn_challenge", options.challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 300,
    path: "/",
  });

  return c.json(options);
});

passkey.post("/register-verify", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const challenge = getCookie(c, "webauthn_challenge");

  if (!challenge) {
    return c.json({ error: "Missing challenge" }, 400);
  }
  deleteCookie(c, "webauthn_challenge");

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: challenge,
    expectedOrigin: getOrigin(),
    expectedRPID: getRpId(),
  });

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: "Verification failed" }, 400);
  }

  const { credential } = verification.registrationInfo;

  // Convert publicKey Uint8Array to base64url for storage
  const publicKeyBase64url = btoa(String.fromCharCode(...credential.publicKey))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const name = body.passkeyName || "Passkey";

  db.insert(schema.passkeyCredentials)
    .values({
      id: credential.id,
      userId: user.id,
      publicKey: publicKeyBase64url,
      counter: credential.counter,
      transports: body.response?.transports ? JSON.stringify(body.response.transports) : null,
      name,
    })
    .run();

  return c.json({ ok: true });
});

// --- Authentication (unauthenticated) ---

passkey.post("/login-options", async (c) => {
  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: "preferred",
    // Empty allowCredentials = discoverable credentials (passkeys)
  });

  setCookie(c, "webauthn_challenge", options.challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 300,
    path: "/",
  });

  return c.json(options);
});

passkey.post("/login-verify", async (c) => {
  const body = await c.req.json();
  const challenge = getCookie(c, "webauthn_challenge");

  if (!challenge) {
    return c.json({ error: "Missing challenge" }, 400);
  }
  deleteCookie(c, "webauthn_challenge");

  // Find the credential
  const credentialId = body.id;
  const storedCredential = db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.id, credentialId))
    .get();

  if (!storedCredential) {
    return c.json({ error: "Authentication failed" }, 400);
  }

  // Check if user account has been deleted
  const passkeyUser = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, storedCredential.userId))
    .get();
  if (!passkeyUser || passkeyUser.deletedAt) {
    return c.json({ error: "Authentication failed" }, 400);
  }

  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge: challenge,
    expectedOrigin: getOrigin(),
    expectedRPID: getRpId(),
    credential: {
      id: storedCredential.id,
      publicKey: base64urlToUint8Array(storedCredential.publicKey),
      counter: storedCredential.counter,
      transports: storedCredential.transports
        ? (JSON.parse(storedCredential.transports) as AuthenticatorTransportFuture[])
        : undefined,
    },
  });

  if (!verification.verified) {
    return c.json({ error: "Authentication failed" }, 400);
  }

  // Update counter
  db.update(schema.passkeyCredentials)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(schema.passkeyCredentials.id, storedCredential.id))
    .run();

  // Create session
  const sessionId = createSession(storedCredential.userId);
  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });

  return c.json({ ok: true });
});

// --- Manage passkeys (authenticated) ---

passkey.get("/list", authMiddleware, async (c) => {
  const user = c.get("user");
  const passkeys = getUserPasskeys(user.id);
  return c.json(
    passkeys.map((pk) => ({
      id: pk.id,
      name: pk.name,
      createdAt: pk.createdAt,
    })),
  );
});

passkey.delete("/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const credId = c.req.param("id") as string;

  const cred = db
    .select()
    .from(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.id, credId as string))
    .get();

  if (!cred || cred.userId !== user.id) {
    return c.json({ error: "Not found" }, 404);
  }

  db.delete(schema.passkeyCredentials)
    .where(eq(schema.passkeyCredentials.id, credId as string))
    .run();

  return c.json({ ok: true });
});

export default passkey;
