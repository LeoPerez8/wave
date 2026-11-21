# #1136: Readiness decision for GPL-3.0-only

Part of the security readiness spec (#1122). Recorded on 2026-11-18 against `61774d29`, the
integration branch tip that holds #1123 to #1135. That code isn't on `main`, isn't deployed and
hasn't run in any workflow on GitHub. This run deployed nothing, ran no workflow, read no
production database and changed no provider or repository setting. It holds no credential value,
email address, Google subject or account identifier.

Results:

- **pass**: observed, and it meets #1122.
- **fail**: observed, and it doesn't.
- **unknown**: not observed. Unknown never counts as a pass.

Evidence kinds:

- **local test**: a test or tool run on this machine. It shows the code's behaviour, never the
  production state.
- **code inspection**: read from the source.
- **observed state**: read from GitHub or a provider (read-only), with its date.

## Activation, 2026-11-18

Everything below this section is the decision as recorded at `61774d29`, before any of it ran. This
section records what happened after, on the owner's instruction in the session that built it.

- **Merge and first gated release.** PR #1137 merged into `main` as `e37f04a4`. CI run
  `44251200418` bumped to `a1f23cf0` (Release Wave 0.69.0-ti); Version, Secret scan, Release gate
  and Publish versioned release passed, and the GitHub Release `v0.69.0-ti` carries
  `wave-0.69.0-ti.provenance.json`. The PR's own runs passed Native unit tests, which hold
  `WaveAccountClientTest.kt`.
- **Compatibility report against production.** Run at 19:07 UTC for `c9120524` (the `main` tip
  then) with a read-only database token that expired after an hour: `compatible`, exit 0, no
  findings. Counts: 4 accounts of 10; at most 3 valid sessions in an account, none expired; every
  synced table far under its quota with tombstones counted; 0 current sign-in counters (2 stale);
  11 usage warnings, none outside the window; at most 3 provider usage rows in an account. The
  four installed-app checks (sign-in, push and pull, Library preserved, other sessions preserved)
  were seen by the owner on a phone and passed with `--installed-client`.
- **Worker settings.** The sync Worker's secret names were read; `ALLOWED_EMAILS` isn't among them,
  so admission is first come, first served.
- **Sync Worker deployed** from `c9120524` with `pnpm --filter @wave/sync run deploy`: the migration
  step reported the database up to date, and `wrangler deploy` made version
  `a5fc8960-f9dd-4c48-9a80-710e52de89fb` current. The owner then checked Wave on a phone against it
  and reported everything working.
- **Licence.** GPL-3.0-only declared on 2026-11-18 on the owner's instruction: `LICENSE` (the
  unmodified GPLv3 text), `NOTICE.md` (copyright, the §7 Play services permission, the paths left
  out of the grant) and `"license": "GPL-3.0-only"` in every first-party `package.json`. The
  owner stated the same day that the LeoPerez8, "Ygor Perez de Oliveira" and ygor-infotera
  identities are all theirs.

Controls after activation:

| #   | Control                                            | Result              | Basis                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Current use fits the limits                        | **pass**            | The production report above, `compatible`.                                                                                                                                                                                                                                                                                                                        |
| 2–6 | Account, row, session, counter and metadata limits | **pass**            | Deployed in `a5fc8960`, with production counts inside every limit and the owner's phone check after the deploy. Local tests at `61774d29`.                                                                                                                                                                                                                        |
| 7   | Release gate                                       | **pass**            | First run on GitHub admitted `e37f04a4` and published `v0.69.0-ti` with its record.                                                                                                                                                                                                                                                                               |
| 8   | Provenance through promotion and rollback          | **owner exception** | No promotion or rollback has run with the new checks. Accepted by the owner on 2026-11-18; the first promotion or rollback is its evidence.                                                                                                                                                                                                                       |
| 9   | Contributor isolation                              | **pass**            | Unchanged.                                                                                                                                                                                                                                                                                                                                                        |
| 10  | Publishing permissions                             | **owner exception** | The CI Cloudflare token's scope and expiry, and whether R2 S3 keys exist, are still unread. Accepted by the owner on 2026-11-18.                                                                                                                                                                                                                                  |
| 11  | Sync credential separation                         | **owner exception** | Provider-side token kinds and scopes are still unread. Accepted by the owner on 2026-11-18.                                                                                                                                                                                                                                                                       |
| 12  | Operational controls                               | **owner exception** | MFA, audit logs, backups and billing alerts are still unobserved. Accepted by the owner on 2026-11-18.                                                                                                                                                                                                                                                            |
| 13  | Rights inventory                                   | **pass**            | `node scripts/ci/rights-inventory.ts check` exits 0 at the licence change (parent `6b31a7cc`): "ready for GPL-3.0-only". Two of its resolutions are owner exceptions of 2026-11-18 (Play services with a §7 permission; releases already distributed), and five groups of files are excluded from the grant (`docs/licensing/rights-inventory.md` › Resolutions). |
| 14  | Release source delivery                            | **owner action**    | Turned on by the owner; backfill run recorded by the release-source run. Not observed in this record.                                                                                                                                                                                                                                                             |

**Verdict after activation: ready**, with owner exceptions. Rows 1 to 7, 9 and 13 pass; rows 8, 10,
11 and 12 are owner exceptions; row 14 counts once the release-source run records the backfill. A
clean full APK build with a recipient's own key, which step 4 below asked for, hasn't been run.

An owner exception is not a pass: it records that the owner closed the ticket knowing the
observation is missing. Reading those settings later and recording them here turns each into a pass
or a fail.

## Verdict at `61774d29`

**NOT READY.** Of 14 essential controls, 1 passes, 2 fail and 11 are unknown. No owner exception
is on record, and this document doesn't propose one. A control without an observed pass or a
reviewed exception keeps the verdict at not ready.

What that blocks:

- Deploying the sync Worker with the limits from #1124 to #1128, because deploying it is what
  switches them on. There's no separate switch.
- Declaring GPL-3.0-only anywhere in the repository.
- Turning on release-source delivery (`RELEASE_SOURCE_DELIVERY`).

Merging the integration branch into `main` isn't blocked by this verdict, but it's the owner's
call: it publishes a `ti` release through the new gate (see
[Rollout and recovery](#safe-rollout-and-recovery)).

## Controls

| #   | Control                                                                                   | Ticket | Result      | Verified at                                                                           | Evidence kind                                        | What's missing or why                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------- | ------ | ----------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Current use fits the limits (compatibility report)                                        | #1123  | **unknown** | `61774d29`, report run 2026-11-18 04:16 UTC                                           | local test                                           | The report answers `insufficient-evidence` (exit 2): no read-only production access, and the four installed-app checks pending.                                                                                                                                                                                              |
| 2   | Account admission cap: ten accounts, first come, place freed on deletion                  | #1125  | **unknown** | `61774d29`                                                                            | local test                                           | Not deployed. The production account count and whether the optional `ALLOWED_EMAILS` setting exists on the Worker are unread.                                                                                                                                                                                                |
| 3   | Retained-row quota per table, tombstones counted                                          | #1124  | **unknown** | `61774d29`                                                                            | local test                                           | Not deployed. Retained rows per account and table, including any legacy excess, are unread. The installed app's handling of a refused push hasn't been seen on a phone.                                                                                                                                                      |
| 4   | Session cap (ten valid) and 90-day expiry, hourly cleanup                                 | #1126  | **unknown** | `61774d29`                                                                            | local test (TypeScript only)                         | Not deployed. Valid sessions per account are unread. The Kotlin test for the new refusal (`WaveAccountClientTest.kt`) wasn't run.                                                                                                                                                                                            |
| 5   | Sign-in counter cap, 1,000 keys per minute                                                | #1127  | **unknown** | `61774d29`                                                                            | local test                                           | Not deployed. The counter table's current size is unread.                                                                                                                                                                                                                                                                    |
| 6   | Operational metadata retention (30 UTC days of warnings, three provider rows each)        | #1128  | **unknown** | `61774d29`                                                                            | local test                                           | Not deployed. `usage_warnings` and `upstream_usage` counts are unread.                                                                                                                                                                                                                                                       |
| 7   | Release gate: signing waits for checks on the actual release source                       | #1129  | **unknown** | `61774d29`                                                                            | local test, code inspection of `ci.yml`              | Never run on GitHub. The gate runs only on pushes to `main` and `v*` tags, and this code hasn't reached `main`. The bot bump, final-source scan, full build and repack have only run in tests.                                                                                                                               |
| 8   | Provenance through promotion, tag runs and rollback                                       | #1130  | **unknown** | `61774d29`; Environments and tag ruleset read 2026-11-18                              | local test; observed state (GitHub)                  | No promotion, tag run or rollback has run with the new checks. `allow_unrecorded` is an open owner-review risk (see [Risks](#risks-for-the-owner-to-review)).                                                                                                                                                                |
| 9   | Contributor isolation and the trusted maintainer workflow                                 | #1131  | **pass**    | GitHub settings read 2026-11-17; `untrusted-code.ts` at `61774d29`                    | observed state (GitHub); local test                  | Passes for the settings read that day: write roster, read-only default token, no secret outside the release Environments, owner approval on `main`. Not exercised: a real fork PR run. Re-read before activation, since nothing re-reads them. Maintainers' two-factor sign-in is under row 12.                              |
| 10  | Publishing permissions and public update exposure                                         | #1132  | **unknown** | provider read 2026-11-17; `service.test.ts` at `61774d29`                             | observed state (Cloudflare, Worker); local test      | The bucket's own exposure and the Worker's routes pass. The CI Cloudflare token's permissions, resources and expiry couldn't be read, and whether R2 S3 access keys exist is unknown.                                                                                                                                        |
| 11  | Sync credential separation                                                                | #1133  | **unknown** | repository `8794eb19` and GitHub 2026-11-17; `sync-credentials.test.ts` at `61774d29` | observed state (GitHub); code inspection; local test | The repository side passes: no sync credential is a GitHub secret or reaches the app. Unread: the Turso token's kind, scope and expiry, the analytics token's permissions, the Soulseek key versions set, and whether development reuses production Genius or Ticketmaster keys. One Cloudflare account serves dev and prod. |
| 12  | Operational controls: MFA, audit logs, backup retention, billing alerts, recovery runbook | #1133  | **unknown** | 2026-11-17                                                                            | none (documents only)                                | Nothing observed at any provider. The restore rehearsal (2026-11-07) is a historical record, not a current setting.                                                                                                                                                                                                          |
| 13  | Rights inventory                                                                          | #1134  | **fail**    | `61774d29`, run 2026-11-18                                                            | local test (`rights-inventory.ts check`)             | Exits 1 with 19 open items (listed below).                                                                                                                                                                                                                                                                                   |
| 14  | Release source delivery                                                                   | #1135  | **fail**    | tools at `61774d29`; 140 tags and repository variables read 2026-11-17/18             | local test; code inspection; observed state (GitHub) | Prepared, not on: the repository has no `RELEASE_SOURCE_DELIVERY` variable. No published release carries source directions or notice texts, OTA bundles show none, and no clean full APK build with a recipient's own key has been done.                                                                                     |

Rows 2 to 6 pass locally. That says the code does what #1122 asks on a local libSQL database. It
says nothing about whether switching it on would refuse someone who uses Wave today, and that is
what row 1 is for.

## Blocking unknowns

Each of these has to become an observed pass, or a reviewed owner exception that names the unknown,
its consequence and the date, before the verdict can change.

**Production counts.** Accounts, valid sessions per account, retained rows per account and table
with tombstones, current-minute sign-in counters, `usage_warnings` rows and `upstream_usage` rows.
The owner reads them with the #1123 report and a read-only token in the hour before activation
(`apps/sync/README.md` › Compatibility report). Fewer than ten users says nothing about sessions or
rows.

**Provider settings.**

- The CI Cloudflare token's permission groups, resources, expiry and last use, and whether any R2
  S3 access keys exist (#1132).
- The Turso token's kind (database, not group or Platform), scope and expiry. The analytics
  token's permissions. Soulseek key versions in use (#1133).
- Development and production separation: whether the owner's own development uses the production
  Genius or Ticketmaster keys, and whether one Cloudflare account for both is an accepted risk.
- MFA on GitHub (each maintainer), Cloudflare, Turso, Google Cloud, Genius and Ticketmaster.
- Audit logs, Turso backup retention, billing and usage alerts, and the recovery runbook itself.
- Whether `ALLOWED_EMAILS` is set on the deployed Worker, which would contradict the first-come
  policy (#1125).

**Workflows that have never run on GitHub with this code.**

- The release gate on a push to `main`: bot bump, Secret scan range ending at the bump, gate
  admission, sealing, the record attached to the GitHub Release, the update published only after
  `verify-update`.
- A repack run that names its kept native base.
- Promote to main of a ti release that has a sealed record, through the gate, with owner approval.
- A tag run, including a hand-made `-ti` tag, waiting on the `main` Environment.
- Roll back an update, both for a recorded release and for one from before records.
- Release-source delivery attaching a manifest and directions.

**Rights inventory (19 items, `rights-inventory.ts check`).**

- Ygor's written statement for GPL-3.0-only, covering both of Ygor's GitHub accounts.
- `googleid` 1.2.1 with Play services: a compatibility determination, or a GPL build without them.
- The resolved Gradle release closure and its licences.
- Four ported files need notices and recorded upstream revisions, among them `RealFft2048.kt`,
  which must keep chfft's MPL-2.0 notice and stay MPL-2.0.
- Six BlueOak-1.0.0 npm packages: show they're absent from the release, or record a determination.
- Design-reference icons, evidence screenshots and audio fixtures: record their origin or exclude
  them. Service samples and YouTube response fixtures: exclude, remove or replace them.
- `distribution:released-android`: every Android release already distributed went out without
  source access or notices tied to it.

**Phone checks**, on a phone running the installed Wave against the service being switched on:

- signing in again reaches the same account;
- a change pushed from one phone arrives on another;
- music plays and the local Library is unchanged after sign-in and sync;
- the account's other phones stay signed in, with no forced login, reinstall or migration.

## Local test runs at `61774d29`

Run on 2026-11-18 for this record. The tests pass on at least one platform each. None of them is
production evidence.

| Suite                                      | Windows (Node 24.19)            | WSL Ubuntu (Node 24.22.2) | Notes                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`                            | 5,210 / 5,210                   | not run                   |                                                                                                                                                                                                                                                                                                   |
| `apps/sync` (local libSQL, fake Google)    | 180 / 180                       | not run                   | Covers rows 1 to 6 and the credential redaction tests.                                                                                                                                                                                                                                            |
| `apps/mobile` `src/sync/syncCycle.test.ts` | 32 / 32                         | not run                   | A refused push keeps the Library and the session.                                                                                                                                                                                                                                                 |
| `apps/updates`                             | 77 / 84                         | 84 / 84                   | The 7 Windows failures are the publish, promote, notes and APK script tests, whose fake `npx` fixtures need a POSIX shell.                                                                                                                                                                        |
| `scripts/ci/*.test.ts`                     | 308 / 314                       | 310 / 311                 | Windows: 3 autofix tests fail on CRLF line endings, and 3 publish-release and verified-release tests on Windows path separators in fake fixtures. WSL: `gitignore.test.ts` can't run `git rev-parse` because this worktree's `.git` file holds a Windows path. Each passes on the other platform. |
| `WaveAccountClientTest.kt`                 | not run                         | not run                   | No Java on either.                                                                                                                                                                                                                                                                                |
| `rights-inventory.ts check`                | exit 1, 19 items                |                           |                                                                                                                                                                                                                                                                                                   |
| Compatibility report, no database          | exit 2, `insufficient-evidence` |                           |                                                                                                                                                                                                                                                                                                   |

Earlier runs by each ticket are in its record under `docs/verification/` and in its commits. They
weren't repeated beyond the suites above.

## Prepared for rollout, and observed after deployment

**Prepared for rollout** (in the repository, tested locally, not active):

- the sync limits, the hourly maintenance and the app's new refusal messages (#1124 to #1128);
- the deploy's stop above ten accounts (`apps/sync/scripts/migrate.ts`);
- the compatibility report and `activationBlockers`, which accept only a `compatible` live report
  for the same revision taken in the hour before (#1123);
- the release gate, the provenance record, and the promotion, tag and rollback checks (#1129,
  #1130);
- `scripts/ci/untrusted-code.ts` and `docs/contributing.md` (#1131);
- the source manifest tools and release directions, behind `RELEASE_SOURCE_DELIVERY` (#1135);
- the rights inventory and its check (#1134).

**Observed after deployment:** nothing. Every observed-state row above was read before any of this
code ran anywhere outside this machine. Each control needs its own post-deployment observation,
listed in the checklist below.

## Safe rollout and recovery

Each step needs the owner's explicit instruction (see
[Authorization boundary](#authorization-boundary)). Stop at the first step that doesn't hold.

### 1. Sync service (activates rows 2 to 6)

1. Close or except the provider unknowns for the sync Worker: Turso token, analytics token, MFA,
   backups (rows 11 and 12).
2. Check on the Worker's secret list (names only) whether `ALLOWED_EMAILS` exists. If it does, the
   owner decides whether to remove it before the first-come policy counts as verified.
3. Right before the deploy, the owner runs the compatibility report against production with a
   read-only token that expires within the hour, and `--revision` set to the commit being
   deployed. Pass `--installed-client` only for checks seen on a phone.
4. Compare it with the limits. Go on only on `compatible`. On `incompatible` (more than ten
   accounts, an account at or above ten valid sessions, a table at or over its quota, a full
   counter table), stop and bring the owner a compatible plan. Never raise a limit, evict an
   account, end a session or delete rows to make the report pass.
5. The owner deploys the sync Worker by hand (`pnpm --filter @wave/sync run deploy`). This change
   adds no migration. The deploy stops by itself if the database holds more than ten accounts.
6. Observe on phones: sign-in, push and pull, playback, Library unchanged, other phones still
   signed in. The Worker doesn't log limit refusals, so a refusal shows only on the phone that
   hit it.

Installed apps from before this change show the session-cap refusal (an eleventh phone signing in)
as "This Google account can't use Wave's server", since they don't know `maxSessionsPerAccount`.
That message is wrong for this case, but nothing is lost. The right one is a native change, so it
needs the next APK build.

**Backing out.** The limits never delete synced data or end a valid session; they only refuse
growth. To undo the deploy, the owner rolls the Worker back to its previous version
(`wrangler rollback`, or a deploy from the previous commit). With no migration in this change, that
is a code-only rollback, and it reintroduces the uncounted-tombstone defect #1124 fixed. To back out
one limit alone, the owner changes its value in `apps/sync/src/limits.ts` and redeploys, and the
change is recorded here as an exception. What a rollback doesn't bring back: sessions the hourly
maintenance deleted after 90 days unused (they already answered 401) and warning rows older than
30 days.

### 2. `ti` release (activates rows 7 and 8, observes row 9's workflow)

1. Merging the integration PR pushes to `main`, which runs the new gate for the first time and
   publishes a `ti` release if it passes.
2. Observe the run: the bot's version commit, Secret scan's range ending at it, the gate admitting,
   the release job verifying and sealing the record, `wave-<version>.provenance.json` on the
   GitHub Release, and the update published only after `verify-update`. Record the run here.
3. If the gate refuses a healthy run, no release goes out and phones keep the previous one. Fix
   forward on `main` or revert the merge. Never sign or publish around the gate.
4. Phone checks on the new `ti` app.
5. If the update is bad but doesn't crash, run Roll back an update on `ti`. Every earlier update
   in R2 predates records, so for the next ten releases per channel the only way back is the
   `allow_unrecorded` input. A crash or a broken APK needs a fix-forward release; rollback can't
   cross a runtime version.

### 3. Promotion to `main` (stable)

1. Only a `ti` release with a sealed record can be promoted. The first one comes from step 2.
   Before promoting, run the emulator check on that release's commit
   (`node scripts/perf/perf.ts emulator-check`, `docs/agents/emulator-checks.md`) and record its
   verdict here. A JS block over 50 ms it names is a bug to fix or to accept by name. It informs
   the decision and gates nothing.
2. The owner runs Promote to main for it, then approves the `main` Environment run.
3. Observe: the gate admits the stable tag with `promotedFrom` naming the `ti` release and the same
   source, then a full build. Record the run here.
4. Rollback on `main` waits for the owner's approval, like any `main` run.

### 4. Licence and source delivery (rows 13 and 14)

Only after `rights-inventory.ts check` exits 0 and a clean full APK build with a recipient's own key
has been done. The owner turns on `RELEASE_SOURCE_DELIVERY`, decides what to do for the releases
already distributed, and declares the licence. Each is a separate instruction.

## Risks for the owner to review

- **`allow_unrecorded` on `ti`.** #1130 added this input to Roll back an update so recovery still
  works for updates from before records. On `ti` no approval gates it: the `ti` Environment has no
  reviewer, so any account with write access can republish a pre-record update, checked on its
  runtime version alone. It stays inside the trusted roster, but it is a path that skips the
  provenance check. The owner decides whether to accept it until R2 holds no pre-record update, or
  to require a reviewer for it. On `main` the owner's approval already gates it.
- **The gate and the bot.** The gate has passed only in tests. If it refuses the bot's first real
  run, `ti` releases stop until a fix lands on `main`.
- **Sessions lost without signing out.** An online Sign Out ends its session on the service, but a
  phone that reinstalls Wave, resets, or signs out offline leaves its session there. A user who does
  that often enough can reach the ten valid sessions and be refused sign-in until those sessions go
  90 days unused. The way back is the owner removing that account's stale sessions by hand, or a
  future device-management feature.
- **Settings drift.** The GitHub and Cloudflare reads are from 2026-11-17 and 2026-11-18. Nothing
  re-reads them, so they must be read again before any activation.

The risks #1122 already records as the owner's choice (open first-come places, tombstones that never
expire, trusted maintainers' bypass, shared signing keys, the sign-in flood window, legacy excesses)
are unchanged and aren't repeated here.

## Authorization boundary

Each of these needs its own explicit instruction from the owner. Approving this record, merging a
PR or closing an issue grants none of them:

- deploying either Worker, which for the sync Worker switches the limits on;
- reading production: the compatibility report with a production token, provider dashboards,
  Worker secret lists;
- running a database migration;
- publishing: merging into `main` (it releases to `ti`), promoting, tagging, rolling back,
  turning on `RELEASE_SOURCE_DELIVERY`;
- revoking or rotating any credential or signing key, or ending sessions;
- changing repository visibility, collaborators, Environments, rulesets or Actions settings;
- declaring or changing a licence, or closing the Google key alert.

Until then, live validation and activation stay pending, and #1122 stays open.
