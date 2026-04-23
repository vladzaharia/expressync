# Polaris Express — Deploy + Pen-Test Runbook

## Overview

The Polaris Express customer portal ships as the same Fresh container that
serves the existing admin tool. Two Traefik routers split traffic by host:

- `manage.polaris.express` → admin surface (rename from `expressync.polaris.gdn`)
- `polaris.express` → customer surface
- `expressync.polaris.gdn` → 301 → `manage.polaris.express` (90-day grace)

A separate Cloudflare Email Worker handles outbound transactional email
(magic links, session summaries, reservation cancellations, admin
password resets).

## Prerequisites

- DNS control over `polaris.express` and `manage.polaris.express`
- Cloudflare account with Workers Paid plan (~$5/mo) for the email Worker
- The `polaris.express` zone added to Cloudflare with Email Routing enabled
  (already set up — verify in Cloudflare dashboard)
- Ability to update `docker-compose.env` on the production host

## Deploy steps

### 1. DNS

Create A/AAAA records pointing both hostnames at the same Traefik entry the
existing `expressync.polaris.gdn` uses:

```
manage.polaris.express   A    <traefik-ipv4>
polaris.express          A    <traefik-ipv4>
mail.polaris.express     A    <traefik-ipv4>   (or Cloudflare-routed)
assets.polaris.express   CNAME <r2-bucket>.r2.cloudflarestorage.com
```

Keep `expressync.polaris.gdn` DNS pointing at the same entry for the 301
redirect to function. Plan to remove it after ~90 days.

### 2. SPF + DKIM + DMARC for `polaris.express`

```dns
;; SPF
polaris.express.   3600  IN  TXT  "v=spf1 include:_spf.mx.cloudflare.net -all"

;; DKIM (Cloudflare auto-generates the selector when Email Service is enabled)
;; Add the CNAME shown in the dashboard once Email Service is enabled

;; DMARC — Phase 1 (monitoring only — start here)
_dmarc.polaris.express.   3600  IN  TXT
  "v=DMARC1; p=none; rua=mailto:dmarc-reports@polaris.express; fo=1; aspf=r; adkim=r; pct=100"
```

After 30 days of clean reports → escalate to `p=quarantine`. After 60 days
clean → `p=reject`.

### 3. Hosted brand assets (PNGs)

Upload to `https://assets.polaris.express/email/`:

- `polaris-logo-160.png` (160×40)
- `polaris-logo-320.png` (320×80, retina)
- `expressync-logo-160.png`
- `expressync-logo-320.png`

For now, the in-repo `static/polaris-favicon-*.png` files are 1×1
transparent placeholders. To generate real ones from
`static/polaris-logo.svg` (already shipped):

```bash
deno run --allow-read --allow-write --allow-run scripts/generate-polaris-favicons.ts
```

This requires ImageMagick. Replace the placeholders before launch.

### 4. Cloudflare Email Worker

```bash
cd cloudflare/email-worker
npm install
npx wrangler kv namespace create EMAIL_NONCE_DEDUP
npx wrangler kv namespace create EMAIL_NONCE_DEDUP --preview
# Copy the namespace IDs into wrangler.jsonc

npx wrangler secret put POLARIS_SECRET_A
# Paste a fresh 32-byte random hex string. Store it for use in CF_EMAIL_WORKER_SECRET below.

npx wrangler deploy
```

Add a Worker Route in the Cloudflare dashboard:

- Pattern: `mail.polaris.express/*`
- Worker: `polaris-email-worker`

### 5. Production env

Update `docker-compose.env` on the production host. Add these new vars (the
defaults from `.env.example` are intentionally placeholders — replace with
production values):

```env
# Cloudflare Email Worker
CF_EMAIL_WORKER_URL=https://mail.polaris.express
CF_EMAIL_WORKER_SECRET=<same-secret-as-POLARIS_SECRET_A>
EMAIL_FROM=Polaris Express <noreply@polaris.express>
EMAIL_FROM_ADMIN=ExpresSync Operator <admin-noreply@polaris.express>

# Auth + customer session
AUTH_URL=https://polaris.express
ADMIN_BASE_URL=https://manage.polaris.express
COOKIE_DOMAIN=.polaris.express
MAGIC_LINK_TTL_SECONDS=900
MAGIC_LINK_INVITE_TTL_SECONDS=86400
ADMIN_PASSWORD_RESET_TTL_SECONDS=86400
CUSTOMER_SESSION_TTL_SECONDS=28800
FEATURE_MAGIC_LINK=true
FEATURE_SCAN_LOGIN=true
OPERATOR_CONTACT_EMAIL=support@polaris.express
```

### 6. Run migrations

```bash
deno task db:migrate
```

This applies migrations 0017–0027 (user_mappings.userId, role triggers,
audit tables, case-insensitive email index).

### 7. Backfill existing customer accounts

After migrations are applied, run once:

```bash
deno task backfill:customer-accounts --dry-run
# Review the CSV output

deno task backfill:customer-accounts
# Apply for real
```

The script auto-creates customer user rows for every existing
`user_mappings.lago_customer_external_id` (using the Lago customer's
email). Skipped rows (no Lago email, admin-email collision) are reported in
the CSV — fix in Lago and re-run.

### 8. Deploy Fresh container + flip Traefik

```bash
docker compose pull
docker compose up -d --force-recreate app sync
```

The new `docker-compose.override.yml` Traefik labels add:

- `polaris-admin` router (manage.polaris.express)
- `polaris-customer` router (polaris.express)
- `polaris-legacy` router (301 from expressync.polaris.gdn)
- HSTS middleware on all three

### 9. Smoke test

```bash
# Customer surface
curl -I https://polaris.express/login
# 200 + customer-warm Polaris brand

curl -I https://polaris.express/sessions
# 302 → /login (no session)

# Admin surface
curl -I https://manage.polaris.express/login
# 200 + ExpresSync admin login

# Legacy redirect
curl -I https://expressync.polaris.gdn/sync
# 301 → https://manage.polaris.express/sync

# HSTS
curl -I https://polaris.express/ | grep -i strict-transport-security
# Strict-Transport-Security: max-age=63072000; includeSubDomains; preload

# Health
curl https://polaris.express/api/health
# OK
```

### 10. Post-deploy

- Send yourself a test magic link from `polaris.express/login`
- Verify the email arrives within 30s, lands in inbox (not spam)
- Click the link → verify session is created on `polaris.express`
- From the session, navigate to `/sessions`, `/cards`, `/billing`,
  `/reservations`, `/account`
- Verify your scan-tag works at a charger
- Verify session-summary email fires when a charging session ends

## Pen-test checklist (run BEFORE marking the launch complete)

These are the 20 items from the security audit, captured here as the
launch-gate checklist. Run each manually or with the noted test commands.
The codebase already enforces most of these — this checklist confirms
production behavior matches.

### Auth & sessions

1. **Magic-link enumeration**: POST `/api/auth/magic-link/preflight` with
   100 random emails. Expected: uniform 200, no DB rows for non-existent
   users (verify via `psql`), per-IP rate-limit triggers around the 25th
   request. (Track A-Core enforces composite rate limits.)

2. **Magic-link single-use replay**: click an emailed magic link. Open the
   same URL again. Expected: second click → "Link expired" page. (Track C
   verify endpoint deletes the verification row on use.)

3. **Magic-link expired**: wait 16 minutes after issuance. Click. Expected:
   410 / "Link expired". (TTL = `MAGIC_LINK_TTL_SECONDS=900`.)

4. **Cross-charger SSE pickup attempt**: open SSE
   `/api/auth/scan-detect?pairingCode=A&chargeBoxId=EVSE-1`; have someone
   scan at EVSE-2. Expected: no event delivered. (Track C scan-detect filters
   by chargeBoxId.)

5. **Concurrent armed pairing per charger**: open two browsers, both POST
   `/api/auth/scan-pair` with `chargeBoxId=EVSE-1`. Expected: second returns
   409 Conflict. (One armed pairing per charger; Track C enforces.)

6. **Captured-nonce replay**: capture `(idTag, pairingCode_A, nonce_A)` from
   one client's SSE; POST `/api/auth/scan-login` from another browser with
   different `pairingCode_B + nonce_A`. Expected: 403 HMAC mismatch. (HMAC
   binds chargeBoxId+pairingCode+idTag+timestamp.)

7. **Atomic single-use scan-login**: POST `/api/auth/scan-login` twice in
   parallel with same payload. Expected: first 200, second 410. (Atomic
   conditional UPDATE in scan-login.)

8. **Customer ownership IDOR — sessions**: as customer A, GET
   `/api/customer/sessions/{B's session id}`. Expected: 404. (assertOwnership
   throws OwnershipError with status 404.)

9. **Customer ownership IDOR — reservations**: as customer A, PATCH
   `/api/customer/reservations/{B's id}`. Expected: 404.

10. **Customer ownership — scan-start with foreign tag**: as customer A,
    POST `/api/customer/scan-start` with `{ ocppTagPk: <B's tag> }`.
    Expected: 404. (assertOwnership on the tag.)

11. **Customer ownership — session-stop on foreign session**: as customer A,
    POST `/api/customer/session-stop` with `{ transactionId: <B's tx> }`.
    Expected: 404.

12. **Operation allowlist**: as customer, POST `/api/admin/charger/operation`
    with `operation: "Reset"`. Expected: 403 (and the path itself is
    admin-only via middleware, so an even earlier 404 from the customer
    surface is acceptable).

13. **DB trigger — admin-as-mapping-user**: directly run `INSERT INTO
    user_mappings (steve_ocpp_tag_pk, user_id) VALUES (1, '<an admin id>')`.
    Expected: trigger raises exception with role='admin' message. (Migration
    0018.)

14. **8h customer session ceiling**: log in as customer; wait 8h+1m; send a
    request. Expected: 302 to /login + session row deleted from `sessions`.

15. **Email Worker replay-protection**: capture a real `POST /send` body and
    signature, replay 6 minutes later. Expected: 403 (timestamp expired or
    nonce already in KV).

16. **SSE concurrency cap**: open 5 concurrent
    `EventSource('/api/auth/scan-detect?...')` from the same IP. Expected:
    4th onwards → 429. (Track C per-IP cap of 3 concurrent.)

17. **Cross-site CSRF**: from `evil.com`, submit
    `<form method="POST" action="https://polaris.express/api/customer/session-stop">`.
    Expected: 403 (Origin mismatch from `assertSameOrigin`) + cookie not
    sent (SameSite=Lax).

18. **Email previewer (Outlook SafeLinks) simulation**: GET
    `https://polaris.express/auth/verify?token=<valid>` with
    `User-Agent: Outlook-Safe-Links/1.0`. Expected: renders confirmation
    form (POST), does NOT consume the token. (Track C two-step consume.)

19. **Admin impersonation audit**: as admin, navigate to
    `polaris.express/?as=<customer-uuid>`. Expected: ImpersonationBanner
    visible, `impersonation_audit` row written, state-changing POST
    rejected with 403 "Read-only while impersonating".

20. **Brute-force admin password**: POST `/api/auth/sign-in/email` with
    wrong password 100 times in 1 minute from one IP. Expected: rate-limit
    429 well before 100 attempts. (Existing `/api/auth` 10/min IP limit.)

After all 20 checks pass, the launch gate is green.

## Rollback

If production is unhappy:

1. Revert the docker-compose.override.yml Traefik label change to point
   `polaris-admin` back at `expressync.polaris.gdn` and remove the
   customer router. The single Fresh app keeps serving admin from the
   legacy host.
2. Customer-facing endpoints (`/api/customer/*`, `/login`, `/auth/*`)
   become inaccessible (no router pointing at them) — admin tool is
   unaffected.
3. To roll back schema: migrations 0017–0027 are non-destructive (they
   only ADD columns + tables + triggers). The new triggers can be dropped
   manually if they cause friction. Existing admin data is unchanged.

## Open follow-ups

- **`users.deleted_at`** — schema doesn't yet support GDPR soft-delete.
  `/api/customer/delete-account` returns 501. Plan to add a follow-up
  migration when the operator needs the path.
- **Real Polaris favicon artwork** — `static/polaris-favicon-*.png` are
  1×1 placeholders. Generate from `static/polaris-logo.svg` via the
  scripts/generate-polaris-favicons.ts script.
- **`/api/customer/sessions?cardId=` filter** — Track G2's card-detail
  page wants to filter recent sessions by card; the Track F endpoint
  doesn't accept this param yet. Cosmetic — currently shows the user's
  full session history embedded.
- **Lago invoice cross-link from session detail** — the session detail's
  Cost MetricTile is wired as a cross-link target but the loader
  currently returns null `costCents` / `invoiceId`. Resolve in a follow-up
  by enriching the loader with the Lago invoice lookup.
- **DMARC escalation timeline** — start at `p=none` for 30 days, then
  `p=quarantine`, then `p=reject`. Track DMARC reports via the
  `dmarc-reports@polaris.express` mailbox.
- **Worker secret rotation** — the Worker accepts both
  `POLARIS_SECRET_A` and `POLARIS_SECRET_B` for rolling rotation. To
  rotate: (a) add SECRET_B, (b) update Fresh app to use SECRET_B,
  (c) remove SECRET_A.
