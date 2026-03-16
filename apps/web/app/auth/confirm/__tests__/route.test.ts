import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────

const mockVerifyOtp = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: mockVerifyOtp,
    },
  }),
}));

const mockCookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      set: mockCookieSet,
    }),
}));

const { GET } = await import("../route");

// ── Tests ──────────────────────────────────────────────────

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  });

  it("verifies OTP and redirects to / on success", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const req = new NextRequest("http://localhost:3000/auth/confirm?token_hash=abc123&type=signup");
    const res = await GET(req);

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      type: "signup",
      token_hash: "abc123",
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("redirects to custom next path after successful verification", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const req = new NextRequest(
      "http://localhost:3000/auth/confirm?token_hash=abc&type=signup&next=/history",
    );
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/history");
  });

  it("handles magiclink type", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const req = new NextRequest(
      "http://localhost:3000/auth/confirm?token_hash=xyz789&type=magiclink",
    );
    const res = await GET(req);

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "xyz789",
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("redirects to /login?error=confirmation when token_hash is missing", async () => {
    const req = new NextRequest("http://localhost:3000/auth/confirm?type=signup");
    const res = await GET(req);

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=confirmation");
  });

  it("redirects to /login?error=confirmation when type is missing", async () => {
    const req = new NextRequest("http://localhost:3000/auth/confirm?token_hash=abc");
    const res = await GET(req);

    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=confirmation");
  });

  it("redirects to /login?error=confirmation when OTP verification fails", async () => {
    mockVerifyOtp.mockResolvedValue({
      error: { message: "Token expired" },
    });

    const req = new NextRequest(
      "http://localhost:3000/auth/confirm?token_hash=expired&type=signup",
    );
    const res = await GET(req);

    expect(mockVerifyOtp).toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=confirmation");
  });

  it("sanitizes next param to prevent open redirect", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const req = new NextRequest(
      "http://localhost:3000/auth/confirm?token_hash=abc&type=signup&next=https://evil.com",
    );
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });
});
