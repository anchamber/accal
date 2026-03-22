export type Role = "admin" | "sdl" | "manifest";
export type AssignmentRole = "sdl" | "manifest";

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

export const ROLES: Role[] = ["admin", "sdl", "manifest"];
export const ASSIGNMENT_ROLES: AssignmentRole[] = ["sdl", "manifest"];
