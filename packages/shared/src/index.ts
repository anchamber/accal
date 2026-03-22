export type Role =
  | "admin"
  | "sdl"
  | "manifest"
  | "pilot"
  | "tandem_master"
  | "instructor"
  | "load_organizer";

export type AssignmentRole =
  | "sdl"
  | "manifest"
  | "pilot"
  | "tandem_master"
  | "instructor"
  | "load_organizer";

export type RequirementLevel = "required" | "limiting" | "optional";

export interface RoleConfig {
  role: AssignmentRole;
  label: string;
  requirement: RequirementLevel;
  minPerDay: number;
  maxPerDay: number | null; // null = unlimited
}

export const DEFAULT_ROLE_CONFIG: Record<AssignmentRole, RoleConfig> = {
  sdl: {
    role: "sdl",
    label: "Drop Zone Leader",
    requirement: "required",
    minPerDay: 1,
    maxPerDay: 1,
  },
  manifest: {
    role: "manifest",
    label: "Manifest",
    requirement: "required",
    minPerDay: 1,
    maxPerDay: 1,
  },
  pilot: { role: "pilot", label: "Pilot", requirement: "required", minPerDay: 1, maxPerDay: null },
  tandem_master: {
    role: "tandem_master",
    label: "Tandem Master",
    requirement: "limiting",
    minPerDay: 1,
    maxPerDay: null,
  },
  instructor: {
    role: "instructor",
    label: "Instructor",
    requirement: "limiting",
    minPerDay: 1,
    maxPerDay: null,
  },
  load_organizer: {
    role: "load_organizer",
    label: "Load Organizer",
    requirement: "optional",
    minPerDay: 0,
    maxPerDay: null,
  },
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
  canceledAt: string | null;
  cancelReason: string | null;
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
  "load_organizer",
];
export const ASSIGNMENT_ROLES: AssignmentRole[] = [
  "sdl",
  "manifest",
  "pilot",
  "tandem_master",
  "instructor",
  "load_organizer",
];
