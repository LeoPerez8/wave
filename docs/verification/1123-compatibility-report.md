# #1123 — Current-user compatibility report

Part of the security readiness spec (#1122). The report and its operator command are in
`apps/sync/src/compatibility.ts` and `apps/sync/scripts/compatibility-report.ts`; how to run it
is in `apps/sync/README.md` › Compatibility report. Nothing here was deployed, and no production
setting was changed.

Status words: **verified** means observed; **pending** means not observed yet, and it does not
pass.

## Limits the report checks

Taken from the integration branch on 2026-11-18:

| Limit                           | Value                                                | Where it comes from                          |
| ------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| Simultaneous Google accounts    | 10                                                   | `SYNC_LIMITS.maxAccounts` (#1125)            |
| Valid sessions per account      | 10, valid meaning used in the last 90 days           | #1122; `SESSION_UNUSED_MS`                   |
| Current-minute sign-in counters | 1,000                                                | `SYNC_LIMITS.maxSignInKeysPerMinute` (#1127) |
| Retained rows per synced table  | each table's `SYNC_LIMITS` value, tombstones counted | `SYNC_LIMITS`, `SYNC_TABLES` (#1124)         |
| Usage warnings                  | 30 UTC days, at most 60 rows                         | `WARNING_DAYS_KEPT` (#1128)                  |
| Provider usage rows             | three per account                                    | `upstream_usage` (#1128)                     |

The session limit isn't enforced by the service yet (#1126); the report checks it ahead of that.

## Local evidence

**Verified** on 2026-11-18 with the local libSQL harness (`apps/sync/src/compatibility.test.ts`,
11 tests, `node --test` on Windows):

- Without the database, the report is `insufficient-evidence`, dated, with the environment name
  and revision, and no inventory. The operator command exits 2.
- Accounts, valid and expired sessions, rows with tombstones per table, sign-in counters, usage
  warnings and provider usage are counted. The serialized report holds no session token, email,
  Google subject or row id.
- Eleven accounts made before the limit, an account with ten sessions, one with eleven and a
  table over its limit by its tombstones are each flagged, and the result is `incompatible`. A
  table exactly at its limit is flagged (its next new id would be refused), and so is a full
  sign-in counter table.
- After every report, each phone still pulls the same Library with its session: nothing is
  evicted, revoked or deleted.
- A failed installed-app check makes the report `incompatible`; a missing one leaves it
  `insufficient-evidence`.
- `activationBlockers` accepts only a `compatible` report of the live service, for the same
  revision, taken in the hour before activation.

Each behaviour was seen to fail against a stub and against a change that broke it (tombstones
left out, the counter cap checked only above 1,000, every session counted valid, the report's
age ignored, a test database accepted, a missing inventory passed, accounts over the limit not
flagged), then pass.

The command run without database access printed:

```json
{
  "result": "insufficient-evidence",
  "environment": "production-sync",
  "source": "live",
  "sourceRevision": "f3e7e74d08149a34d63d1488c2433085cc5c31dc",
  "observedAt": "2026-11-18T03:39:52.928Z",
  "findings": [
    { "code": "inventory-unavailable" },
    { "code": "installed-client-unverified", "subject": "sign-in" },
    { "code": "installed-client-unverified", "subject": "push-pull" },
    { "code": "installed-client-unverified", "subject": "library-preserved" },
    { "code": "installed-client-unverified", "subject": "sessions-preserved" }
  ],
  "inventory": null
}
```

## Live evidence

**Pending.** This run had no Turso session and no read-only token for the production database,
so the production inventory wasn't read. The owner's checks of the installed Wave are pending
too:

| Check                | What the owner looks for on a phone with the installed Wave | Status  |
| -------------------- | ----------------------------------------------------------- | ------- |
| `sign-in`            | signing in again reaches the same account                   | pending |
| `push-pull`          | a change pushed from one phone arrives on another           | pending |
| `library-preserved`  | the Library is the same after signing in and syncing        | pending |
| `sessions-preserved` | the account's other phones stay signed in                   | pending |

The owner runs the command in `apps/sync/README.md` › Compatibility report with a read-only
token right before activation, and keeps the printed JSON with the activation record. Until
then, no limit from #1122 may be switched on based on this report.
