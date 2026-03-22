import type { User, JumpDay, Role, PasskeyCredential } from "@accal/shared";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchMe(): Promise<User> {
  return request("/api/auth/me");
}

export function logout(): Promise<void> {
  return request("/api/auth/logout", { method: "POST" });
}

export function fetchJumpDays(month: string): Promise<JumpDay[]> {
  return request(`/api/jumpdays?month=${month}`);
}

export function createJumpDay(date: string, notes?: string): Promise<JumpDay> {
  return request("/api/jumpdays", {
    method: "POST",
    body: JSON.stringify({ date, notes }),
  });
}

export function updateJumpDay(
  id: string,
  data: { date?: string; notes?: string | null },
): Promise<void> {
  return request(`/api/jumpdays/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteJumpDay(id: string): Promise<void> {
  return request(`/api/jumpdays/${id}`, { method: "DELETE" });
}

export function signup(jumpDayId: string, role: "sdl" | "manifest"): Promise<void> {
  return request(`/api/jumpdays/${jumpDayId}/signup`, {
    method: "POST",
    body: JSON.stringify({ role }),
  });
}

export function withdraw(jumpDayId: string, role: "sdl" | "manifest"): Promise<void> {
  return request(`/api/jumpdays/${jumpDayId}/signup`, {
    method: "DELETE",
    body: JSON.stringify({ role }),
  });
}

export function fetchUsers(): Promise<(User & { oauthProvider: string })[]> {
  return request("/api/users");
}

export function updateUserRoles(userId: string, roles: Role[]): Promise<void> {
  return request(`/api/users/${userId}/roles`, {
    method: "PATCH",
    body: JSON.stringify({ roles }),
  });
}

// --- Magic Link ---

export function sendMagicLink(email: string): Promise<{ ok: boolean }> {
  return request("/api/auth/magic-link/send", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

// --- Passkeys ---

export function getPasskeyRegisterOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return request("/api/auth/passkey/register-options", { method: "POST" });
}

export function verifyPasskeyRegistration(
  credential: unknown,
  passkeyName?: string,
): Promise<{ ok: boolean }> {
  return request("/api/auth/passkey/register-verify", {
    method: "POST",
    body: JSON.stringify({ ...(credential as object), passkeyName }),
  });
}

export function getPasskeyLoginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return request("/api/auth/passkey/login-options", { method: "POST" });
}

export function verifyPasskeyLogin(credential: unknown): Promise<{ ok: boolean }> {
  return request("/api/auth/passkey/login-verify", {
    method: "POST",
    body: JSON.stringify(credential),
  });
}

export function listPasskeys(): Promise<PasskeyCredential[]> {
  return request("/api/auth/passkey/list");
}

export function deletePasskey(id: string): Promise<void> {
  return request(`/api/auth/passkey/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
