import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return url;
}

// Lazy initialization — avoids crashing at build time when env vars aren't set.
// { prepare: false } required for Supabase transaction pooler (pgBouncer/Supavisor)
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const client = postgres(getConnectionString(), { prepare: false });
    _db = drizzle(client, { schema });
  }
  return _db;
}

/** @deprecated Use getDb() for lazy initialization. Kept for backwards compatibility. */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});
