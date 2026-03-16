import { getDb, rateLimits, sql } from "@redflag/db";
import { RATE_LIMIT_AUTH_PER_DAY, RATE_LIMIT_PER_DAY } from "@redflag/shared";

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
 * Check and increment rate limit.
 *
 * @param identifier - IP address (anonymous) or user ID (authenticated)
 * @param isAuthenticated - Whether the user is authenticated (10/day vs 2/day)
 *
 * Uses atomic UPSERT: INSERT ... ON CONFLICT DO UPDATE SET count = count + 1.
 * Returns whether the identifier is rate-limited BEFORE incrementing — so the caller
 * can reject the request without consuming a slot.
 */
export async function checkRateLimit(
  identifier: string,
  isAuthenticated = false,
): Promise<RateLimitResult> {
  const db = getDb();
  const today = todayUTC();
  const resetAt = nextMidnightUTC();
  const limit = isAuthenticated ? RATE_LIMIT_AUTH_PER_DAY : RATE_LIMIT_PER_DAY;

  // Check current count
  const rows = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(sql`${rateLimits.ipAddress} = ${identifier} AND ${rateLimits.date} = ${today}`);

  const currentCount = rows[0]?.count ?? 0;

  if (currentCount >= limit) {
    return { limited: true, resetAt };
  }

  // Under limit — UPSERT to increment
  await db
    .insert(rateLimits)
    .values({ ipAddress: identifier, date: today, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.ipAddress, rateLimits.date],
      set: { count: sql`${rateLimits.count} + 1` },
    });

  return { limited: false, resetAt };
}
