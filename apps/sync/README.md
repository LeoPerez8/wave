# Wave sync service

`apps/sync` is Wave's only backend: a Cloudflare Worker in front of one Turso (libSQL)
database. It checks Google ID tokens, holds sessions, merges pushed rows by Core's rules
(`mergeRows`, `mergePlays` from `@wave/core`), serves pulls and deletes accounts. See "Wave
account and sync" in `docs/spec.md`.

| File                 | What it holds                                                           |
| -------------------- | ----------------------------------------------------------------------- |
| `src/worker.ts`      | The Worker entry: builds the service from the Worker's secrets and vars |
| `src/service.ts`     | The routes, sessions, the rate limit and the allowlist                  |
| `src/google.ts`      | Checking a Google ID token (RS256 against Google's JWKS)                |
| `src/store.ts`       | Push (merge and number changes), pull (pages) and account deletion      |
| `src/tables.ts`      | The synced tables: wire fields, checks and columns                      |
| `src/migrations.ts`  | The schema, as ordered migrations                                       |
| `src/limits.ts`      | `SYNC_LIMITS`                                                           |
| `scripts/migrate.ts` | Runs pending migrations against `TURSO_DATABASE_URL`                    |

## API

Every body is JSON. Every route but `POST /v1/session` needs the session token as
`Authorization: Bearer <sessionToken>`. Only `POST /v1/session` ever answers a session token,
and nothing logs a session token or an ID token.

### `POST /v1/session`

Signs in. The ID token must carry a valid RS256 signature by one of Google's keys, the
issuer `accounts.google.com`, the audience `GOOGLE_CLIENT_ID` (Wave's web client id), an
expiry in the future and a verified email. The first sign-in with a Google account creates
its Wave account (keyed by Google's `sub`).

```json
{ "idToken": "<Google ID token>" }
```

`200`:

```json
{ "sessionToken": "<43 characters>", "email": "ana@example.com" }
```

`401 { "error": "invalid_id_token" }` when the token doesn't check out,
`403 { "error": "not_allowed" }` when `ALLOWED_EMAILS` is set and the email isn't on it.

The service keeps only a SHA-256 of the session token. A session lasts until it is ended
or the account is deleted.

### `DELETE /v1/session`

Signs this session out. `204`, no body. The account's other sessions stay signed in.

### `POST /v1/push`

Changed rows in, by table. Every table is optional.

```json
{
  "songs": [Song],
  "playlists": [Playlist],
  "playlistEntries": [PlaylistEntry],
  "favorites": [Favorite],
  "preferences": [Preference],
  "plays": [Play]
}
```

Each row of every table but `plays` is a Core `SyncRow`, with the table's own fields:

```json
{ "id": "…", "changedAt": 1760443200000, "phoneId": "…", "deleted": false, …fields }
```

A removal is a tombstone: `"deleted": true`, and the table's own fields can be left out.
Each pushed row is merged with the stored one by `mergeRows`: the later `changedAt` wins and
the greater `phoneId` breaks a tie. Plays are merged by `mergePlays`: a play whose `id` is
already held is ignored.

| Table             | `id`                        | Fields (`?` may be `null`)                                                                                                                                                                                                                         |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `songs`           | recording key               | `title`, `credit`, `album?`, `albumArtist`, `discNumber?`, `trackNumber?`, `durationMs`, `year?`, `genre?`, `videoId?`, `addedAt`                                                                                                                  |
| `playlists`       | playlist id                 | `name`, `createdAt`                                                                                                                                                                                                                                |
| `playlistEntries` | entry id                    | `playlistId`, `orderKey` (Core's `orderKeyBetween`), `songId?` (recording key), `ytSong?` (the YT Music song as the app stores it, text), `addedAt`. Exactly one of `songId` and `ytSong` is set.                                                  |
| `favorites`       | recording key               | `addedAt`                                                                                                                                                                                                                                          |
| `preferences`     | preference name             | `value` (any JSON)                                                                                                                                                                                                                                 |
| `plays`           | play id (made on the phone) | `songId` (recording key), `startedAt`, `listenedMs`, `durationMs?`, `endReason` (`completed`, `skipped`, `stopped`, `interrupted`), `counted` (boolean), `contextType?`, `contextId?`, `source` (`phone`, `auto`), `importedFrom?` (`blackplayer`) |

Times are ms since the epoch; numbers are integers. Ids and text are at most 16,384
characters.

`200`, how many rows of each table won (and were stored):

```json
{
  "accepted": {
    "songs": 1,
    "playlists": 0,
    "playlistEntries": 1,
    "favorites": 0,
    "preferences": 1,
    "plays": 1
  }
}
```

A push is all or nothing. `400 { "error": "bad_request", "detail": "songs[3].durationMs isn't an integer" }`
for a row that isn't valid or a table that doesn't exist.

### `GET /v1/pull?since=<cursor>`

The rows changed after `since`, oldest change first, at most 1,000 a page. Leave `since` out
(or send `0`) for everything.

```json
{
  "songs": [Song],
  "playlists": [Playlist],
  "playlistEntries": [PlaylistEntry],
  "favorites": [Favorite],
  "preferences": [Preference],
  "plays": [Play],
  "cursor": "1234",
  "more": false
}
```

Rows have the shapes pushed. A tombstone comes as `{ "id", "changedAt", "phoneId", "deleted": true }`.
Keep `cursor` for the next pull (it's opaque: send it back as is), and pull again at once while
`more` is `true`. With nothing new, `cursor` is the one sent.

Each accepted change gets the account's next change number in the transaction that writes
it, and a pull reads every table in one snapshot, so a pull never misses a change pushed
while it runs.

### `DELETE /v1/account`

Deletes every row and every session of the account, and the account. `204`, no body.

### Errors

| Status | Body                                                                        |
| ------ | --------------------------------------------------------------------------- |
| 400    | `{ "error": "bad_request", "detail"?: "…" }`                                |
| 401    | `{ "error": "unauthorized" }` (no session, or it ended)                     |
| 401    | `{ "error": "invalid_id_token" }`                                           |
| 403    | `{ "error": "not_allowed" }`                                                |
| 404    | `{ "error": "not_found" }`                                                  |
| 413    | `{ "error": "limit", "limit": "<name>" }`                                   |
| 429    | `{ "error": "limit", "limit": "maxRequestsPerMinute" }`, with `Retry-After` |
| 500    | `{ "error": "internal" }`                                                   |

## Limits

`SYNC_LIMITS` in `src/limits.ts`. Past one, the service answers `413` (or `429` for the
rate) and names it. Starting values, so a 50,000-song Library with 200,000 plays fits:

| Limit                  | Value     |                                                 |
| ---------------------- | --------- | ----------------------------------------------- |
| `maxBodyBytes`         | 2 MiB     | per request; a large first push goes in batches |
| `maxSongs`             | 100,000   | rows per account, tombstones aside              |
| `maxPlaylists`         | 5,000     |                                                 |
| `maxPlaylistEntries`   | 250,000   |                                                 |
| `maxFavorites`         | 100,000   |                                                 |
| `maxPreferences`       | 200       |                                                 |
| `maxPlays`             | 1,000,000 |                                                 |
| `maxRequestsPerMinute` | 120       | per session                                     |

A push that would take a table past its limit is refused whole.

## Configuration

Set on the Worker, never in the repo (`wrangler.toml` holds none of them):

| Name                 | Kind   |                                                                     |
| -------------------- | ------ | ------------------------------------------------------------------- |
| `TURSO_DATABASE_URL` | secret | `libsql://<db>-<org>.turso.io`                                      |
| `TURSO_AUTH_TOKEN`   | secret | a Turso token for that database                                     |
| `GOOGLE_CLIENT_ID`   | secret | Wave's **web** OAuth client id, the audience of the app's ID tokens |
| `ALLOWED_EMAILS`     | secret | optional: emails that may sign in, separated by commas              |

## Running it locally

The tests run every route against a fresh libSQL database file, with a fake Google that
signs ID tokens with a generated key and serves it as a JWKS:

```sh
pnpm --filter @wave/sync test
pnpm --filter @wave/sync typecheck
```

CI runs them with the rest of the monorepo (`pnpm typecheck`, `pnpm lint`, `pnpm test`).

To run the Worker itself, start a local libSQL server with the
[Turso CLI](https://docs.turso.tech/cli/introduction), migrate it, and put the Worker's
settings in `apps/sync/.dev.vars` (ignored by git):

```sh
turso dev --db-file apps/sync/.wrangler/sync.db   # serves http://127.0.0.1:8080
TURSO_DATABASE_URL=http://127.0.0.1:8080 pnpm --filter @wave/sync migrate
```

```ini
# apps/sync/.dev.vars
TURSO_DATABASE_URL=http://127.0.0.1:8080
GOOGLE_CLIENT_ID=<web client id>.apps.googleusercontent.com
```

```sh
pnpm --filter @wave/sync dev   # wrangler dev, on http://localhost:8787
```

Signing in needs a real Google ID token for that client id; the token is checked against
Google's live keys.

## Deploying

Deploying is done by hand. The first time, run the setup wizard from the repo root, in Git
Bash on Windows or any shell on Linux:

```sh
bash apps/sync/setup.sh
```

[`setup.sh`](setup.sh) walks through the steps below and checks each one before going on:
the Turso database and a token for it, Google's consent screen and OAuth clients (the web
client the service checks ID tokens against, and an Android client for `dev.leoperez.wave`
with the SHA-1 of Expo's template debug keystore, which signs both the release and the debug
builds), signing in to Cloudflare, the migrations, `wrangler deploy`, the Worker's secrets,
and a check that the live service answers `401` to requests without a valid sign-in. Last,
it writes `syncUrl` and `googleWebClientId` into `extra` in `apps/mobile/app.config.ts`, for
you to commit. It never prints a secret or writes one to disk; it keeps the web client id
and the Worker's URL in `apps/sync/.env.setup` (ignored by git) for the next run. Running it
again is safe.

By hand, the steps are:

1. Create the database and a token for it:
   `turso db create wave-sync`, `turso db show --url wave-sync`,
   `turso db tokens create wave-sync`.
2. In Google Cloud, find Wave's web OAuth client id (the one the app asks Google for ID
   tokens for).
3. Set the Worker's secrets (`wrangler login` first):

   ```sh
   cd apps/sync
   pnpm exec wrangler secret put TURSO_DATABASE_URL
   pnpm exec wrangler secret put TURSO_AUTH_TOKEN
   pnpm exec wrangler secret put GOOGLE_CLIENT_ID
   ```

4. Migrate and deploy. The `deploy` script runs the pending migrations against the database
   in your shell's environment, then `wrangler deploy` (it needs `run`: `pnpm deploy` is a
   pnpm command of its own):

   ```sh
   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… pnpm --filter @wave/sync run deploy
   ```

## Extending it

- **A route:** a handler in `src/service.ts`, wrapped in `withSession` when it needs a
  session, and an entry in `routes` (`"PUT /v1/soulseek": …`). Document its shapes here.
- **A synced table or field:** a new migration at the end of `MIGRATIONS` (never edit one
  that's deployed) and the matching entry in `SYNC_TABLES`. Push and pull pick it up.
- **A setting:** add it to `Env` in `src/worker.ts` and the table above, and set it with
  `wrangler secret put`.
