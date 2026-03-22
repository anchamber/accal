import type { RoleConfig, AssignmentRole } from "@accal/shared";
import { DEFAULT_ROLE_CONFIG, ASSIGNMENT_ROLES } from "@accal/shared";
import { fetchRoleConfig } from "./api.ts";

let configs = $state<RoleConfig[]>([]);
let loaded = $state(false);

export async function loadRoleConfig() {
  try {
    configs = await fetchRoleConfig();
    loaded = true;
  } catch {
    // Fall back to defaults if not authenticated yet
    configs = ASSIGNMENT_ROLES.map((r) => DEFAULT_ROLE_CONFIG[r]);
  }
}

export function getRoleConfigs(): RoleConfig[] {
  if (!loaded) return ASSIGNMENT_ROLES.map((r) => DEFAULT_ROLE_CONFIG[r]);
  return configs;
}

export function getRoleConfig(role: AssignmentRole): RoleConfig {
  const found = configs.find((c) => c.role === role);
  return found ?? DEFAULT_ROLE_CONFIG[role];
}

export function isRoleConfigLoaded(): boolean {
  return loaded;
}

export function refreshRoleConfig() {
  return loadRoleConfig();
}
