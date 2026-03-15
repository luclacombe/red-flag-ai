import { getDb, rateLimits, sql } from "@redflag/db";
import { RATE_LIMIT_PER_DAY } from "@redflag/shared";

export interface RateLimitResult {
  limited: boolean;
  /** ISO string — next midnight UTC */
  resetAt: string;
}

/** Get today's date as YYYY-MM-DD in UTC */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Compute next midnight UTC as ISO string */
function nextMidnightUTC(): string {
  const now = new Date();
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return tomorrow.toISOString();
}

/**
 * Check and increment rate limit for an IP address.
 *
 * Uses atomic UPSERT: INSERT ... ON CONFLICT DO UPDATE SET count = count + 1.
 * Returns whether the IP is rate-limited BEFORE incrementing — so the caller
 * can reject the request without consuming a slot.
 */
export async function checkRateLimit(ipAddress: string): Promise<RateLimitResult> {
  const db = getDb();
  const today = todayUTC();
  const resetAt = nextMidnightUTC();

  // Check current count
  const rows = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(sql`${rateLimits.ipAddress} = ${ipAddress} AND ${rateLimits.date} = ${today}`);

  const currentCount = rows[0]?.count ?? 0;

  if (currentCount >= RATE_LIMIT_PER_DAY) {
    return { limited: true, resetAt };
  }

  // Under limit — UPSERT to increment
  await db
    .insert(rateLimits)
    .values({ ipAddress, date: today, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.ipAddress, rateLimits.date],
      set: { count: sql`${rateLimits.count} + 1` },
    });

  return { limited: false, resetAt };
}
