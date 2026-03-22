export type Role =
  | "admin"
  | "sdl"
  | "manifest"
  | "pilot"
  | "tandem_master"
  | "instructor"
  | "load_planner";

export type AssignmentRole =
  | "sdl"
  | "manifest"
  | "pilot"
  | "tandem_master"
  | "instructor"
  | "load_planner";

export type RequirementLevel = "required" | "limiting" | "optional";

export interface RoleConfig {
  label: string;
  requirement: RequirementLevel;
}

export const ASSIGNMENT_ROLE_CONFIG: Record<AssignmentRole, RoleConfig> = {
  sdl: { label: "SDL", requirement: "required" },
  manifest: { label: "Manifest", requirement: "required" },
  pilot: { label: "Pilot", requirement: "required" },
  tandem_master: { label: "Tandem Master", requirement: "limiting" },
  instructor: { label: "Instructor", requirement: "limiting" },
  load_planner: { label: "Load Planner", requirement: "optional" },
};

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  oauthProvider: string | null;
  roles: Role[];
  hasPasskey?: boolean;
}

export interface PasskeyCredential {
  id: string;
  name: string;
  createdAt: string;
}

export interface JumpDay {
  id: string;
  date: string; // YYYY-MM-DD
  notes: string | null;
  assignments: Assignment[];
}

export interface Assignment {
  role: AssignmentRole;
  user: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
}

export const ROLES: Role[] = [
  "admin",
  "sdl",
  "manifest",
  "pilot",
  "tandem_master",
  "instructor",
  "load_planner",
];
export const ASSIGNMENT_ROLES: AssignmentRole[] = [
  "sdl",
  "manifest",
  "pilot",
  "tandem_master",
  "instructor",
  "load_planner",
];
