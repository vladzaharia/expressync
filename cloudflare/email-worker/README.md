# Polaris Email Worker

Cloudflare Worker that bridges the Polaris Express Fresh app to Cloudflare
Email Service. Deployed at `https://mail.polaris.express`.

## Why a separate Worker?

* The Fresh app is a stateful Deno container — running send-email through it
  means binding it to Cloudflare's API surface. The Worker decouples the
  rendering (Fresh) from the delivery (Cloudflare Edge).
* Cloudflare Email Service requires the `send_email` binding, which is a
  Workers-only feature.
* Keeps secret rotation cheap: rotate `POLARIS_SECRET_*` here without
  touching the Fresh container.

## Contract

The Fresh app posts an HMAC-signed JSON body. See `src/index.ts` for the
authoritative shape; in summary:

```
POST /send
X-Polaris-Sig: <hex sha256 hmac of raw body using POLARIS_SECRET_A or _B>
Content-Type: application/json

{
  "ts": 1714000000000,
  "nonce": "base64url-16-bytes",
  "to": "alice@example.com",
  "subject": "Sign in to Polaris Express",
  "html": "<!doctype html>…",
  "text": "Sign in: https://polaris.express/auth/verify?token=…",
  "category": "magic-link",
  "from": "Polaris Express <noreply@polaris.express>",
  "replyTo": "support@polaris.express",
  "headers": { "List-Unsubscribe": "<mailto:…>" }
}
```

Validation pipeline (any failure ⇒ 4xx, no email sent):

1. **HMAC verify** — constant-time via `crypto.subtle.verify`. Tries both
   `POLARIS_SECRET_A` and `POLARIS_SECRET_B` (if set) so we can rotate
   secrets with zero downtime.
2. **Timestamp window** — reject if `|now - ts| > TS_WINDOW_MS` (default
   5 min) to defeat replay outside the live window.
3. **Nonce dedup** — reject if `sha256(nonce)` already in
   `EMAIL_NONCE_DEDUP` KV. TTL = `NONCE_TTL_SECONDS` (default 600s).
4. **Per-recipient rate limit** — `≤ RATE_LIMIT_MAX` per
   `RATE_LIMIT_WINDOW_SECONDS` keyed by `sha256("${to}:${category}")`.
5. **Sender allowlist** — `from:` address must be one of:
   * `noreply@polaris.express` (customer-facing emails, Polaris brand)
   * `admin-noreply@polaris.express` (admin-facing, ExpresSync brand)

   The Worker dispatches to the matching `send_email` binding, which
   Cloudflare further enforces via `allowed_sender_addresses` in
   `wrangler.jsonc`.

### Logging

We **never** log payload contents. Each request emits a single JSON line:

```json
{
  "level": "INFO",
  "category": "EmailWorker",
  "message": "send ok",
  "to_hash": "<sha256 hex of recipient>",
  "category": "magic-link",
  "ts": 1714000000000,
  "nonce_hash": "<sha256 hex of nonce>"
}
```

`to_hash` is enough to correlate operator complaints back to a request
without ever putting the address in the log.

## Deployment

### One-time setup

1. Install dependencies:

   ```sh
   cd cloudflare/email-worker
   npm install
   ```

2. Create the KV namespace and update `wrangler.jsonc` with the IDs:

   ```sh
   npx wrangler kv namespace create EMAIL_NONCE_DEDUP
   npx wrangler kv namespace create EMAIL_NONCE_DEDUP --preview
   ```

   Replace the `REPLACE_WITH_KV_NAMESPACE_ID` /
   `REPLACE_WITH_KV_PREVIEW_ID` placeholders in `wrangler.jsonc`.

3. Set the signing secret:

   ```sh
   # Generate one if you don't have it: openssl rand -base64 32
   npx wrangler secret put POLARIS_SECRET_A
   ```

   Mirror this secret into the Fresh app's
   `CF_EMAIL_WORKER_SECRET` env var.

4. Confirm the configuration parses:

   ```sh
   npx wrangler deploy --dry-run
   ```

5. Deploy:

   ```sh
   npx wrangler deploy
   ```

6. Once live, point a Worker route at `mail.polaris.express/*` from the
   Cloudflare dashboard (or via `[[routes]]` in `wrangler.jsonc`).

### Required Cloudflare Email Service setup

Cloudflare Email Service is in **public beta on the Workers Paid plan**
(April 2026 — verify in the dashboard). Once Email Service is enabled on
the `polaris.express` zone, the `send_email` bindings in `wrangler.jsonc`
will Just Work. DNS records (SPF / DKIM / DMARC) need to be in place
first — see the customer-portal plan's "DNS setup" section.

### Required hosted assets

Email templates reference brand artwork from a separate origin
(`assets.polaris.express`, served from R2). These must be uploaded
**before the first send** or images will appear broken in customer
inboxes:

* `https://assets.polaris.express/email/polaris-logo-160.png` — 160 × 40
* `https://assets.polaris.express/email/polaris-logo-320.png` — 320 × 80 (2x)
* `https://assets.polaris.express/email/expressync-logo-160.png` — 160 × 40
* `https://assets.polaris.express/email/expressync-logo-320.png` — 320 × 80 (2x)

PNG only — Outlook strips inline SVG. Optional dark-mode variants can be
added later after visual QA across mail clients.

## Two-secret rolling rotation

The Worker accepts a signature from **either** `POLARIS_SECRET_A` or
`POLARIS_SECRET_B`. To rotate with zero downtime:

1. Generate a new secret. On the Worker, set the *new* value as
   `POLARIS_SECRET_B`:

   ```sh
   npx wrangler secret put POLARIS_SECRET_B
   npx wrangler deploy
   ```

2. Roll the new secret into the Fresh app's `CF_EMAIL_WORKER_SECRET`
   and redeploy. (At this point both old and new signatures are valid.)

3. Confirm in logs that traffic is signing with the new secret only.
   Then retire the old one:

   ```sh
   npx wrangler secret delete POLARIS_SECRET_A
   # Promote B to A so we go back to a single-secret state:
   npx wrangler secret put POLARIS_SECRET_A   # paste the same value as B
   npx wrangler secret delete POLARIS_SECRET_B
   npx wrangler deploy
   ```

   Alternatively, leave `POLARIS_SECRET_B` populated and treat it as the
   active secret for the next cycle. Either pattern works; pick one and
   stick with it so on-call can follow the runbook.

## Local development

```sh
cd cloudflare/email-worker
npm install
npx wrangler dev
```

`wrangler dev` runs against a local edge simulator. The `send_email`
binding doesn't actually deliver in dev — it logs a stub. Pair with the
Fresh-side `scripts/preview-email.ts --send=…` for end-to-end smoke
tests against a deployed staging Worker.

Set the signing secret for `wrangler dev` via `.dev.vars`:

```
POLARIS_SECRET_A=local-dev-secret-not-for-prod
```

`.dev.vars` is gitignored.

## Files

| Path                  | Purpose                                            |
|-----------------------|----------------------------------------------------|
| `wrangler.jsonc`      | Worker config (bindings, vars, KV)                 |
| `src/index.ts`        | Worker entry — verify, dedup, rate-limit, send     |
| `package.json`        | npm scripts (`dev`, `deploy`, `deploy:dry-run`)    |
| `tsconfig.json`       | TS config for the Worker                           |
| `.gitignore`          | Ignores `node_modules/`, `.wrangler/`, `.dev.vars` |
