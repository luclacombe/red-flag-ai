# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

**Email:** [security@red-flag-ai.com](mailto:security@red-flag-ai.com)

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

I'll acknowledge your report within 48 hours and provide a timeline for a fix.

**Do not** open a public GitHub issue for security vulnerabilities.

## Security Measures

RedFlag AI implements the following security measures:

- **AES-256-GCM encryption** — all document content and PII encrypted at rest with per-document HKDF-SHA256 derived keys
- **Private by default** — analyses require an explicit share toggle; share links expire after 7 days
- **30-day auto-deletion** — documents and analysis data purged automatically via cron
- **HMAC-SHA256 IP hashing** — rate limit identifiers are irreversibly hashed (GDPR-compliant)
- **Row Level Security** — Supabase RLS enforced on all tables, scoped to share state and ownership
- **HTTP security headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Auth-scoped access** — owner-only for documents and reports; timing-safe secret comparison on cron endpoints
- **Input validation** — Zod schemas at all boundaries, magic byte verification for uploads, fail-closed rate limiting
- **Prompt injection defense** — document text treated as untrusted input in all AI agent prompts
