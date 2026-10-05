# Security

Overturn holds people's health-claim documents. This file says what protects
them, what to do when something goes wrong, and where the protection stops.

**Reporting a vulnerability:** email the address in `CONTACT_EMAIL` (shown on
`/privacy`). Please don't open a public issue.

## What's in place

| Threat | Control | Where |
| --- | --- | --- |
| One user reading another's data | tenant from the session only; `tq()` refuses unscoped SQL; source scan in CI; a suite of cross-tenant attack tests | `lib/auth/session.ts`, `lib/db/client.ts`, `tests/isolation.test.ts` |
| SQL injection | every value is a parameter; a test fails if anything but a `$n` placeholder is spliced into SQL | `lib/db/queries.ts`, `tests/tenant-guard.test.ts` |
| Database leak (backup, console, read bug) | Neon disk encryption (AES-256) and TLS-only; messages, verdicts, titles, file names and key terms also sealed with AES-256-GCM under `DATA_KEY`, bound to their owner | `lib/crypto.ts` |
| Password guessing, credential stuffing | rate limits per IP and per IP+email; Cloudflare Turnstile; scrypt hashes | `lib/limits.ts`, `lib/auth/turnstile.ts` |
| Bots and cost abuse | Turnstile at sign-up; per-user limits on uploads, questions, exports; daily token cap | `lib/limits.ts` |
| Malicious uploads | magic-byte type check, size and page caps; PDFs with scripts, launch actions, attachments or encryption refused (object streams decoded); PNG decompression bombs refused from the header; the original file is never stored or served | `lib/ingest/pdf.ts` |
| XSS, clickjacking, downgrade | no `dangerouslySetInnerHTML`; CSP (no foreign scripts but Turnstile, `frame-ancestors 'none'`, `object-src 'none'`); HSTS; nosniff | `next.config.ts` |
| CSRF | the session cookie is `SameSite=Lax`, `HttpOnly`, `Secure` | `lib/auth/session.ts` |
| Cached private responses | `private, no-store` and `Vary: Cookie` on every API response | `lib/http.ts` |
| Vulnerable dependencies | `npm audit --omit=dev --audit-level=high` in CI | `.github/workflows/ci.yml` |

`security_log` records sign-ins (and failures), sign-ups, data exports and
account deletions with time and IP, kept a year (DPDP Rules 2025, rule 6).

## If there's a breach (DPDP Rules 2025, rule 7)

1. **Contain.** Rotate whatever leaked (below). Take the app down in Vercel if
   the hole is still open.
2. **Scope it.** `security_log` and Neon's query history: which accounts, which
   data, from when.
3. **Tell people without delay.** Each affected user (by email) and the Data
   Protection Board: what happened, the likely consequences, what's being
   done, and what they can do.
4. **Within 72 hours,** a detailed report to the Board: the facts, cause,
   mitigation, and who was notified.

## Rotating keys

- **`SESSION_SECRET`:** replace it in Vercel and redeploy. Everyone is signed
  out; nothing is lost.
- **`TURNSTILE_SECRET_KEY`:** rotate in the Cloudflare dashboard, update Vercel.
- **`DATA_KEY`:** don't just replace it: every sealed row becomes unreadable.
  Values carry a version prefix (`v1:`) for this. Add the new key as `v2` in
  `lib/crypto.ts` (seal with v2, open either), re-seal existing rows with a
  one-off script, then drop v1.
- **`DATABASE_URL`:** reset the role's password in Neon, update Vercel.

## Where it stops

- **Document passages, their embeddings and the keyword index** are protected
  by Neon's disk encryption only: Postgres has to read them to search them.
  Sealing them means a stored, stripped `tsvector` and an eval run to confirm
  retrieval still holds.
- **Sessions are 7-day JWTs.** Sign-out clears the cookie, but a copied token
  stays valid until it expires; rotating `SESSION_SECRET` is the kill switch.
  Server-side revocation would cost a database read on every request.
- **No password reset**: that needs an email service.
- **The CSP allows inline scripts**, because Next's bootstrap needs a nonce
  otherwise. Nothing renders untrusted HTML; move to a nonce CSP if that
  changes.
- **On Google's free tier, prompts may be used to improve Google's products.**
  The app runs as a demo, with a banner, until `LLM_PAID_TIER=true` on a
  billing-enabled key.
