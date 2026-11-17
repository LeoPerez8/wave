# #1133 — Sync credential separation and operational evidence

Part of the security readiness spec (#1122). Collected on 2026-11-17 from the repository at
`8794eb19` and from read-only GitHub API calls made as the owner's account. No credential value
was read, printed or stored; GitHub returns secret names and update times only. Nothing was
deployed, rotated, revoked or reconfigured, and no provider setting was opened.

No Turso, Cloudflare or Google Cloud session was available to this run (no `turso` or
`wrangler` login on the machine), so every provider-side fact below is **unverified** unless a
row says otherwise. Documentation in `docs/spec.md` and the READMEs counts as the intended state
to reconcile, not as evidence of the current one.

Status words: **verified** means observed today; **failed** means observed and contradicting the
requirement; **unverified** means not observable here, and it does not pass.

## Credential inventory

| Credential (name only)                                                                                   | Consumer                                                           | Environment                                                         | Intended scope and restrictions                                                                                                                                                                                           | Expiry / rotation                                                                             | Evidence and status                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TURSO_DATABASE_URL`                                                                                     | sync Worker; `apps/sync/scripts/migrate.ts` on the owner's machine | production Worker secret; local dev points at a local libSQL server | locates the one `wave-sync` database                                                                                                                                                                                      | n/a                                                                                           | Repository: named only in `apps/sync` (guard test below). Worker secret list: **unverified**.                                                                                                                                            |
| `TURSO_AUTH_TOKEN`                                                                                       | sync Worker; migrations from the owner's shell                     | production only; local dev and tests need none                      | a database token for `wave-sync`, not a Platform/org token. `setup.sh` creates it with `turso db tokens create <db>` and no read-only or expiry flag, so the intended token is a read-write database token with no expiry | no expiry by setup default; rotation is a runbook step (`docs/spec.md` › Security › Recovery) | Effective scope, expiry and that the deployed token is a database (not group or Platform) token: **unverified**. No Turso Platform token is in the Worker's configuration or code: **verified** (README table, `src/` names; see guard). |
| `SOULSEEK_KEY`, `SOULSEEK_KEY_<n>`                                                                       | sync Worker only                                                   | production; local dev makes its own with `openssl rand`             | AES-GCM key (32 bytes) per version; each stored password records its version                                                                                                                                              | add a new version, never overwrite (`apps/sync/README.md` › Soulseek keys)                    | Which versions are set in production and whether any row still uses an old version: **unverified**. Application behaviour **verified** by tests (below).                                                                                 |
| `GOOGLE_CLIENT_ID`                                                                                       | sync Worker (audience check)                                       | same web client for dev and production                              | public OAuth client id, already committed in `apps/mobile/app.config.ts`                                                                                                                                                  | n/a                                                                                           | Public identifier, not a credential. Stored as a Worker secret only for convenience.                                                                                                                                                     |
| `GENIUS_ACCESS_TOKEN`                                                                                    | sync Worker only                                                   | production; tests use fakes                                         | Genius client access token, used for fixed read requests behind a session and per-account limits                                                                                                                          | provider default; no rotation record                                                          | Provider-side scope and expiry: **unverified**.                                                                                                                                                                                          |
| `TICKETMASTER_API_KEY`                                                                                   | sync Worker only                                                   | production; tests use fakes                                         | Ticketmaster Discovery key, fixed read requests behind a session and per-account limits                                                                                                                                   | provider default; no rotation record                                                          | Provider-side scope, quota alerts: **unverified**.                                                                                                                                                                                       |
| `CLOUDFLARE_ANALYTICS_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`)                                                 | sync Worker's hourly usage watch                                   | production, optional                                                | "Account Analytics Read" only (`apps/sync/README.md` › Configuration)                                                                                                                                                     | none recorded                                                                                 | Effective permission set: **unverified**. The watch is skipped when absent.                                                                                                                                                              |
| `ALLOWED_EMAILS`                                                                                         | sync Worker                                                        | production, optional                                                | not a credential; holds emails, so it stays a secret                                                                                                                                                                      | n/a                                                                                           | Whether it is set in production: **unverified** (owned by #1125).                                                                                                                                                                        |
| `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`)                                                       | CI release and rollback jobs                                       | GitHub Environments `ti` and `main`                                 | intended R2 publishing only                                                                                                                                                                                               | updated 2026-11-07 in both Environments                                                       | Listed for the CI boundary only; permissions are #1132's evidence.                                                                                                                                                                       |
| `UPDATES_SIGNING_KEY`, `WAVE_RELEASE_KEYSTORE`, `WAVE_RELEASE_KEYSTORE_PASSWORD`, `WAVE_SIGNING_LINEAGE` | CI release job                                                     | Environments `ti` and `main`, shared by design                      | signing only                                                                                                                                                                                                              | updated 2026-11-07                                                                            | Out of this ticket's scope beyond confirming they are not sync credentials (#1129, #1132).                                                                                                                                               |

Public identifiers in distributed code, which are not Wave credentials: the Google web OAuth
client id and the sync/update Worker URLs in `apps/mobile/app.config.ts`, the update
certificate in `apps/mobile/certs/certificate.pem`, and YouTube's BotGuard web key and request
key in `YtPoTokenWebView.kt` (see the alert below).

## Where the private sync credentials are, and are not

Verified on 2026-11-17:

- GitHub holds **no repository-level Actions secrets or variables**. The `ti` and `main`
  Environments hold exactly the six release names in the table above. No Turso, Soulseek,
  Genius, Ticketmaster or analytics credential is a GitHub secret, so CI publishing jobs cannot
  receive one.
- The only tracked files that name a sync Worker credential are under `apps/sync` (its
  `src/`, `scripts/migrate.ts`, `setup.sh`, `wrangler.toml` comment and README). The new guard
  `scripts/ci/sync-credentials.test.ts` keeps it that way: it fails when a workflow, a CI
  script, the app (JS, native modules, config), Core or the update Worker names one.
- The existing `scripts/ci/inlined-env.test.ts` already fails on any `EXPO_PUBLIC_*` name that
  reads as a credential or is fed from a secret. Both pass.
- Contributor setup needs no production secret: the sync tests run on a local libSQL file with
  a fake Google, and local `wrangler dev` uses a local libSQL server with no token and a locally
  generated Soulseek key (`apps/sync/README.md` › Running it locally). `.dev.vars`, `.env` and
  `.env.*` are git-ignored (checked with `git check-ignore`).
- The project's Gitleaks history scan (#1122 baseline: 3,775 commits, no findings) is the
  history evidence; it was not repeated here.

## Development and production separation

| Resource                    | Development / tests                                                                                     | Production                                                              | Shared?                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Database                    | local libSQL file or `turso dev`                                                                        | Turso `wave-sync`                                                       | separate                                                                                               |
| Database token              | none                                                                                                    | `TURSO_AUTH_TOKEN`                                                      | separate                                                                                               |
| Soulseek key                | generated per developer                                                                                 | Worker secret                                                           | separate                                                                                               |
| Google web OAuth client     | same client id                                                                                          | same client id                                                          | **shared**, public identifier                                                                          |
| Google Android OAuth client | debug-keystore client, also accepted in production                                                      | release-key client and debug-keystore client                            | **shared** by the accepted risk in `docs/spec.md` › Security                                           |
| Genius / Ticketmaster       | tests use fakes; a developer running `wrangler dev` against the real APIs would need a key of their own | Worker secrets                                                          | separate as documented; whether the owner's own dev setup reuses the production keys is **unverified** |
| Cloudflare account          | `wrangler dev` runs locally                                                                             | one account hosts both Workers, the R2 bucket and the usage-watch token | **shared** account; no separate dev account is documented                                              |

The `ti` and `main` Environments hold the same six secret names. Whether their values are the
same is not observable through the API; the signing keys are shared by design (#1122).

## Application controls (re-run, unchanged by this ticket)

`node --test` in `apps/sync` on Windows, 2026-11-17, against local libSQL: **139 tests, 139
passed**. The ones this ticket relies on:

- Google validation: a forged ID token, and one for another audience, issuer, expired or with an
  unverified email, are refused with no session made (`session.test.ts`).
- Session tokens: a malformed token answers `401` before any query; refused-request logs never
  name a token or an address (`refusal.test.ts`).
- Account isolation: an account never reads, changes or deletes another account's rows or
  Soulseek account (`sync.test.ts`, `soulseek.test.ts`).
- Soulseek encryption: the password is stored encrypted, reads only with its own key version
  and account, and no route or key-rotation log line holds a password or key
  (`soulseek.test.ts`).

Native token handling (the session token never reaches JS) is covered by
`WaveAccountClientTest.kt`. It was **not re-run**: this machine has no Android SDK on the
checked path. No native code changed.

## Operational controls

| Control                                                      | Status              | What was observed                                                                                                                                |
| ------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub push protection and secret scanning                   | **verified** on     | repository settings API; validity checks and non-provider patterns are off                                                                       |
| GitHub write roster                                          | **verified**        | `LeoPerez8` admin; `YgorPerez`, `ygor-infotera` write (#1131 owns the trust review)                                                              |
| GitHub `main` Environment approval                           | **verified**        | required reviewers plus a branch policy; `ti` has a branch policy only                                                                           |
| MFA on GitHub                                                | **unverified**      | the API token in use doesn't expose the 2FA flag                                                                                                 |
| MFA on Cloudflare, Turso, Google Cloud, Genius, Ticketmaster | **unverified**      | no provider session                                                                                                                              |
| Audit logs (Cloudflare, Turso, Google Cloud)                 | **unverified**      | no provider session; a personal GitHub repository has no audit-log API                                                                           |
| Turso backup / retention                                     | **unverified**      | `docs/spec.md` states one day under the current plan. That is a document, not the current setting                                                |
| Restore                                                      | **historical only** | `docs/spec.md` records a restore into a separate database rehearsed on 2026-11-07 (about 26 s). No restore was run now, and none is authorized   |
| Billing and usage alerts                                     | **unverified**      | documented: hourly Worker usage watch, Cloudflare R2/charge emails, a monthly manual Turso check. None of the provider settings was observed     |
| Recovery runbook                                             | **unverified**      | `docs/spec.md` says it covers replacing each token and key and ending every session; the runbook itself is not in the repository and wasn't seen |

## The Google API key alert

GitHub secret-scanning alert #1: type `google_api_key`, state open, validity `unknown`,
`publicly_leaked` true, created 2026-10-13. Its one location is
`YtPoTokenWebView.kt` line 295 in commit `b85f2ca3` ("Native: stream YT Music songs in the
player"), the constant the code comments as "BotGuard's public web key ... as YouTube's web
player sends them".

Classification: **a public YouTube web identifier embedded in the client, not a Wave credential
as far as the repository shows.** Wave's backend never uses a Google API key; its only Google
values are the OAuth client ids. What stays unproven: that the key belongs to no Google Cloud
project the owner controls. If the owner wants the alert closed, "false positive" or "won't fix" fits once the owner's
Google Cloud projects are checked and none holds that key.
This run left the alert open.

## Unresolved findings and owner decisions

1. **Turso token scope (essential, unverified).** Confirm in Turso that the Worker's token is a
   database token for `wave-sync` only and record its expiry. The setup default is read-write
   with no expiry. Decide whether to accept that or give it an expiry with a rotation date.
2. **Analytics token permissions (essential, unverified).** Confirm in Cloudflare that it has
   Account Analytics Read and nothing else.
3. **Soulseek key versions (unverified).** List the production secret names (`wrangler secret
list` shows names only) and count rows per `key_version`.
4. **Genius and Ticketmaster keys (unverified).** Record whether the owner's development use
   shares the production keys, and what each provider lets those keys do.
5. **MFA, audit logs, backup retention, billing alerts (unverified).** Each needs a provider
   screenshot or sanitized export kept privately, with a public attestation here.
6. **Shared Cloudflare account (verified shared).** Development has no separate account. The
   owner decides whether that is an accepted risk.
7. **Google key alert (classified, open).** Owner decision on closing it after the project
   check above.

None of these is a pass. Readiness under #1122 stays blocked on items 1, 2 and 5 until the
owner supplies the provider evidence or names an exception with its consequence.
