import type { Context } from "hono";
import * as v from "valibot";

export async function parseBody<T>(c: Context, schema: v.GenericSchema<T>): Promise<T | null> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return null;
  }
  const result = v.safeParse(schema, raw);
  if (!result.success) {
    return null;
  }
  return result.output;
}
