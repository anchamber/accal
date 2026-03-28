import type {
  User,
  Profile,
  JumpDay,
  Role,
  AssignmentRole,
  RoleConfig,
  PasskeyCredential,
} from "@accal/shared";

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

export function cancelJumpDay(jumpDayId: string, reason?: string): Promise<void> {
  return request(`/api/jumpdays/${jumpDayId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || null }),
  });
}

export function reinstateJumpDay(jumpDayId: string): Promise<void> {
  return request(`/api/jumpdays/${jumpDayId}/reinstate`, { method: "POST" });
}

export function signup(jumpDayId: string, role: AssignmentRole, backup = false): Promise<void> {
  return request(`/api/jumpdays/${jumpDayId}/signup`, {
    method: "POST",
    body: JSON.stringify({ role, backup }),
  });
}

export async function importIcal(
  file: File,
): Promise<{ created: number; skipped: number; total: number }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/jumpdays/import", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function withdraw(jumpDayId: string, role: AssignmentRole): Promise<void> {
  return request(`/api/jumpdays/${jumpDayId}/signup`, {
    method: "DELETE",
    body: JSON.stringify({ role }),
  });
}

export function updateMyName(name: string): Promise<{ ok: boolean; name: string }> {
  return request("/api/users/me/name", {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deleteUserPreview(
  userId: string,
): Promise<{ futureAssignments: { date: string; role: string }[] }> {
  return request(`/api/users/${userId}/delete-preview`);
}

export function deleteUser(userId: string): Promise<void> {
  return request(`/api/users/${userId}`, { method: "DELETE" });
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

// --- Role Config ---

export function fetchRoleConfig(): Promise<RoleConfig[]> {
  return request("/api/roles/config");
}

export function updateRoleConfig(
  role: AssignmentRole,
  data: Partial<Omit<RoleConfig, "role">>,
): Promise<RoleConfig> {
  return request(`/api/roles/config/${role}`, {
    method: "PATCH",
    body: JSON.stringify(data),
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

// --- Profiles ---

export function fetchProfiles(): Promise<Profile[]> {
  return request("/api/profiles");
}

export function createProfile(name: string, roles: AssignmentRole[]): Promise<Profile> {
  return request("/api/profiles", {
    method: "POST",
    body: JSON.stringify({ name, roles }),
  });
}

export function updateProfile(
  id: string,
  data: { name?: string; roles?: AssignmentRole[] },
): Promise<Profile> {
  return request(`/api/profiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteProfile(id: string): Promise<void> {
  return request(`/api/profiles/${id}`, { method: "DELETE" });
}

export function linkProfile(
  profileId: string,
  userId: string,
): Promise<{ ok: boolean; mergedAssignments: number; skippedAssignments: number }> {
  return request(`/api/profiles/${profileId}/link`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

// --- Admin Assignment ---

export function adminAssign(
  jumpDayId: string,
  userId: string,
  role: AssignmentRole,
  backup = false,
): Promise<void> {
  return request(`/api/jumpdays/${jumpDayId}/assign`, {
    method: "POST",
    body: JSON.stringify({ userId, role, backup }),
  });
}

export function adminUnassign(
  jumpDayId: string,
  userId: string,
  role: AssignmentRole,
): Promise<void> {
  return request(`/api/jumpdays/${jumpDayId}/assign`, {
    method: "DELETE",
    body: JSON.stringify({ userId, role }),
  });
}
