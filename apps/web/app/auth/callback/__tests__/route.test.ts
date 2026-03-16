import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────

const mockExchangeCodeForSession = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
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

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  });

  it("exchanges code for session and redirects to /", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });

    const req = new Request("http://localhost:3000/auth/callback?code=test-auth-code");
    const res = await GET(req);

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("test-auth-code");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("redirects to custom next path after successful exchange", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });

    const req = new Request("http://localhost:3000/auth/callback?code=test-code&next=/history");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/history");
  });

  it("uses x-forwarded-host in non-dev environments", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    vi.stubEnv("NODE_ENV", "production");

    const req = new Request("http://localhost:3000/auth/callback?code=test-code", {
      headers: { "x-forwarded-host": "red-flag-ai.com" },
    });
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://red-flag-ai.com/");
  });

  it("redirects to /login?error=auth when no code is provided", async () => {
    const req = new Request("http://localhost:3000/auth/callback");
    const res = await GET(req);

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=auth");
  });

  it("redirects to /login?error=auth when exchange fails", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: "Invalid code" },
    });

    const req = new Request("http://localhost:3000/auth/callback?code=bad-code");
    const res = await GET(req);

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith("bad-code");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=auth");
  });

  it("sanitizes next param to prevent open redirect", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });

    const req = new Request(
      "http://localhost:3000/auth/callback?code=test-code&next=https://evil.com",
    );
    const res = await GET(req);

    expect(res.status).toBe(307);
    // Should redirect to "/" instead of the external URL
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });
});
