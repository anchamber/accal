import { db, schema } from "../db/index.ts";

/**
 * Grants admin role to the given user if they are the only user in the database.
 * Uses a count check + insert within the same synchronous call to avoid race
 * conditions (SQLite serializes writes via its WAL lock).
 */
export function grantAdminIfFirstUser(userId: string) {
  const userCount = db.select().from(schema.users).all().length;
  if (userCount === 1) {
    // Check no admin role exists yet (defensive against concurrent calls)
    const existingAdmin = db
      .select()
      .from(schema.userRoles)
      .all()
      .find((r) => r.role === "admin");
    if (!existingAdmin) {
      db.insert(schema.userRoles)
        .values({ userId, role: "admin" } as typeof schema.userRoles.$inferInsert)
        .run();
    }
  }
}
