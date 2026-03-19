import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflict = vi.fn();

vi.mock("@redflag/db", () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert,
  }),
  rateLimits: {
    ipAddress: "ip_address",
    date: "date",
    count: "count",
  },
  sql: vi.fn((...args: unknown[]) => args),
}));

vi.mock("@redflag/shared", () => ({
  RATE_LIMIT_PER_DAY: 1,
  RATE_LIMIT_AUTH_PER_DAY: 3,
}));

vi.mock("@redflag/shared/crypto", () => ({
  getMasterKey: () => Buffer.alloc(32),
  deriveKey: vi.fn().mockResolvedValue(Buffer.alloc(32)),
  hashIp: vi.fn((ip: string) => `hashed:${ip}`),
}));

const { checkRateLimit } = await import("../rateLimit");

// ── Tests ──────────────────────────────────────────────────────

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default chain: select → from → where
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });

    // Default chain: insert → values → onConflictDoUpdate
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    mockOnConflict.mockResolvedValue(undefined);
  });

  it("allows first request and increments counter", async () => {
    mockWhere.mockResolvedValue([]); // No existing row

    const result = await checkRateLimit("1.2.3.4");

    expect(result.limited).toBe(false);
    expect(result.resetAt).toBeDefined();
    expect(mockInsert).toHaveBeenCalled();
  });

  it("blocks when count reaches limit", async () => {
    mockWhere.mockResolvedValue([{ count: 1 }]);

    const result = await checkRateLimit("1.2.3.4");

    expect(result.limited).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled(); // No increment
  });

  it("blocks when count exceeds limit", async () => {
    mockWhere.mockResolvedValue([{ count: 5 }]);

    const result = await checkRateLimit("1.2.3.4");

    expect(result.limited).toBe(true);
  });

  it("returns resetAt as next midnight UTC", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await checkRateLimit("1.2.3.4");

    // resetAt should be a valid ISO date string
    const resetDate = new Date(result.resetAt);
    expect(resetDate.getUTCHours()).toBe(0);
    expect(resetDate.getUTCMinutes()).toBe(0);
    expect(resetDate.getUTCSeconds()).toBe(0);
  });

  it("uses higher limit (3/day) for authenticated users", async () => {
    mockWhere.mockResolvedValue([{ count: 2 }]);

    const result = await checkRateLimit("user-123", true);

    expect(result.limited).toBe(false);
    expect(mockInsert).toHaveBeenCalled();
  });

  it("blocks authenticated users at 3/day limit", async () => {
    mockWhere.mockResolvedValue([{ count: 3 }]);

    const result = await checkRateLimit("user-123", true);

    expect(result.limited).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
