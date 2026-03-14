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

// { prepare: false } required for Supabase transaction pooler (pgBouncer/Supavisor)
const client = postgres(getConnectionString(), { prepare: false });

export const db = drizzle(client, { schema });
