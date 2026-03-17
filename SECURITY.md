# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

**Email:** [luc@luclacombe.com](mailto:luc@luclacombe.com)

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact

I'll acknowledge your report within 48 hours and provide a timeline for a fix.

**Do not** open a public GitHub issue for security vulnerabilities.

## Security Measures

RedFlag AI implements the following security measures:

- **AES-256-GCM encryption** — all document content and PII encrypted at rest with per-document derived keys
- **30-day auto-deletion** — documents and analysis data are automatically purged
- **HMAC-SHA256 IP hashing** — rate limit identifiers are irreversibly hashed (GDPR-compliant)
- **Row Level Security** — Supabase RLS enforced on all tables
- **Auth-scoped access** — document owners only; anonymous uploads accessible by UUID
- **Input validation** — Zod schemas at all boundaries, magic byte verification for uploads
- **Prompt injection defense** — document text treated as untrusted input in all AI agent prompts
