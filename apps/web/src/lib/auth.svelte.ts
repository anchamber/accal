import type { User } from "@accal/shared";
import { fetchMe, logout as apiLogout } from "./api.ts";

let user = $state<User | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);

export function getUser(): User | null {
  return user;
}

export function isLoading(): boolean {
  return loading;
}

export function getError(): string | null {
  return error;
}

export async function checkAuth() {
  loading = true;
  error = null;
  try {
    user = await fetchMe();
  } catch {
    user = null;
  } finally {
    loading = false;
  }
}

export async function logout() {
  try {
    await apiLogout();
  } finally {
    user = null;
    window.location.hash = "/login";
  }
}

export function setUserName(name: string) {
  if (user) user = { ...user, name };
}

export function hasRole(role: string): boolean {
  return user?.roles.includes(role as User["roles"][number]) ?? false;
}
