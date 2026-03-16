import { getDb, rateLimits, sql } from "@redflag/db";
import { RATE_LIMIT_AUTH_PER_DAY, RATE_LIMIT_PER_DAY } from "@redflag/shared";
import { deriveKey, getMasterKey, hashIp } from "@redflag/shared/crypto";

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
 * Hash an identifier for storage in the rate_limits table.
 * IP addresses are HMAC-hashed for GDPR compliance.
 * User IDs (UUIDs) are also hashed for consistency.
 */
async function hashIdentifier(identifier: string): Promise<string> {
  const masterKey = getMasterKey();
  const ipKey = await deriveKey(masterKey, "rate-limit", "ip-hash");
  return hashIp(identifier, ipKey);
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

  // Hash the identifier before any DB operation (HMAC-SHA256)
  const hashedId = await hashIdentifier(identifier);

  // Check current count
  const rows = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(sql`${rateLimits.ipAddress} = ${hashedId} AND ${rateLimits.date} = ${today}`);

  const currentCount = rows[0]?.count ?? 0;

  if (currentCount >= limit) {
    return { limited: true, resetAt };
  }

  // Under limit — UPSERT to increment
  await db
    .insert(rateLimits)
    .values({ ipAddress: hashedId, date: today, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.ipAddress, rateLimits.date],
      set: { count: sql`${rateLimits.count} + 1` },
    });

  return { limited: false, resetAt };
}
