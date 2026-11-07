# Wave sync service

`apps/sync` is Wave's only backend: a Cloudflare Worker in front of one Turso (libSQL)
database. It checks Google ID tokens, holds sessions, merges pushed rows by Core's rules
(`mergeRows`, `mergePlays` from `@wave/core`), serves pulls, keeps each account's Soulseek
account, asks Genius and Ticketmaster for signed-in phones and deletes accounts. See "Wave
account and sync", "Genius About" and "Followed artists" in `docs/spec.md`.

| File                 | What it holds                                                           |
| -------------------- | ----------------------------------------------------------------------- |
| `src/worker.ts`      | The Worker entry: builds the service from the Worker's secrets and vars |
| `src/service.ts`     | The routes, sessions, the rate limits and the allowlist                 |
| `src/google.ts`      | Checking a Google ID token (RS256 against Google's JWKS)                |
| `src/store.ts`       | Push (merge and number changes), pull (pages) and account deletion      |
| `src/soulseek.ts`    | The account's Soulseek account, its password encrypted (`SOULSEEK_KEY`) |
| `src/proxy.ts`       | A provider's fixed requests: the cache, the provider call, its failures |
| `src/tables.ts`      | The synced tables: wire fields, checks and columns                      |
| `src/migrations.ts`  | The schema, as ordered migrations                                       |
| `src/limits.ts`      | `SYNC_LIMITS`                                                           |
| `scripts/migrate.ts` | Runs pending migrations against `TURSO_DATABASE_URL`                    |

## API

Every body is JSON. Every route but `POST /v1/session` needs the session token as
`Authorization: Bearer <sessionToken>`. Only `POST /v1/session` ever answers a session token,
and nothing logs a session token, an ID token, an address or a Soulseek password.

### Refused before the database

Some requests are refused before they cost a database query, by the address Cloudflare
names in `CF-Connecting-IP` (kept only as a SHA-256):

- Past `maxRequestsPerAddressPerMinute`, any route answers `429` with
  `{ "error": "limit", "limit": "maxRequestsPerAddressPerMinute" }`. It's sized for a carrier
  that puts many phones behind one address.
- A token that isn't the shape `POST /v1/session` gives (43 base64url characters) answers
  `401 { "error": "unauthorized" }` without a lookup.
- Past `maxFailedLookupsPerAddressPerMinute` lookups that find no session, the address's
  session routes answer `429` with
  `{ "error": "limit", "limit": "maxFailedLookupsPerAddressPerMinute" }` for
  `failedLookupBlockSeconds`, valid sessions included. Requests that find their session never
  count toward it, and other addresses aren't affected.

Both counts come from Cloudflare's rate limiting binding (`[[ratelimits]]` in
`wrangler.toml`), which counts per Cloudflare location and approximately. The held addresses
are kept in the Worker's isolate. At most once a minute, the Worker logs how many requests it
refused and why (`sync service refused requests: unknown_session=20, held_address=140`), with
no token and no address.

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
`403 { "error": "not_allowed" }` when `ALLOWED_EMAILS` is set and the email isn't on it,
`429` past `maxSignInsPerMinute`: attempts from one address (Cloudflare's `CF-Connecting-IP`,
counted before the ID token is checked) or sign-ins to one Google account.

A sign-in that would make a new account is refused, and makes nothing, when the service holds
`maxAccounts` accounts (`403 { "error": "limit", "limit": "maxAccounts" }`) or has made
`maxNewAccountsPerDay` in the last 24 hours (`429 { "error": "limit", "limit":
"maxNewAccountsPerDay" }`, with `Retry-After` until the oldest of them is a day old). Existing
accounts sign in either way.

The service keeps only a SHA-256 of the session token. A session lasts until it is ended,
the account is deleted, or it goes 90 days without a request: then it answers
`401 { "error": "unauthorized" }` and is deleted. Every request made with it starts the 90
days again.

### `DELETE /v1/session`

Signs this session out. `204`, no body. The account's other sessions stay signed in.

### `DELETE /v1/sessions`

Signs out everywhere: ends every session of the account, this one included. `204`, no body.
Other accounts' sessions stay.

### `POST /v1/push`

Changed rows in, by table. Every table is optional.

```json
{
  "songs": [Song],
  "playlists": [Playlist],
  "playlistEntries": [PlaylistEntry],
  "favorites": [Favorite],
  "preferences": [Preference],
  "plays": [Play],
  "follows": [Follow],
  "hiddenReleases": [HiddenRelease],
  "notifiedShows": [NotifiedShow],
  "dismissedSuggestions": [DismissedSuggestion]
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

| Table                  | `id`                        | Fields (`?` may be `null`)                                                                                                                                                                                                                         |
| ---------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `songs`                | recording key               | `title`, `credit`, `album?`, `albumArtist`, `discNumber?`, `trackNumber?`, `durationMs`, `year?`, `genre?`, `videoId?`, `addedAt`                                                                                                                  |
| `playlists`            | playlist id                 | `name`, `createdAt`                                                                                                                                                                                                                                |
| `playlistEntries`      | entry id                    | `playlistId`, `orderKey` (Core's `orderKeyBetween`), `songId?` (recording key), `ytSong?` (the YT Music song as the app stores it, text), `addedAt`. Exactly one of `songId` and `ytSong` is set.                                                  |
| `favorites`            | recording key               | `addedAt`                                                                                                                                                                                                                                          |
| `preferences`          | preference key              | `value?` (text: what the app's key-value store holds, `null` for nothing)                                                                                                                                                                          |
| `plays`                | play id (made on the phone) | `songId` (recording key), `startedAt`, `listenedMs`, `durationMs?`, `endReason` (`completed`, `skipped`, `stopped`, `interrupted`), `counted` (boolean), `contextType?`, `contextId?`, `source` (`phone`, `auto`), `importedFrom?` (`blackplayer`) |
| `follows`              | artist name key             | `name`, `level` (`releases`, `shows`), `followedAt`, `deezerId?`, `ytBrowseId?`                                                                                                                                                                    |
| `hiddenReleases`       | release key                 | none                                                                                                                                                                                                                                               |
| `notifiedShows`        | Ticketmaster event id       | none                                                                                                                                                                                                                                               |
| `dismissedSuggestions` | artist name key             | `dismissedAt` (when the follow suggestion was dismissed; Undo is a tombstone)                                                                                                                                                                      |

Times are ms since the epoch; numbers are integers. Ids and text are at most 16,384
characters. The tables and their fields are Core's wire (`SYNC_TABLE_NAMES`, `SYNC_FIELDS` in
`packages/core/src/syncWire.ts`), which the app reads pulls with; `src/tables.ts` builds its
tables from them.

Plays also accept optional, nullable `snapshot` and `videoId` fields. `snapshot` uses
Core's `PlaySnapshot` shape: `{ title: string, artist: string, album: string | null,
artworkPath: string | null, thumbPath: string | null }`. `artist` is the artist credit
as written; the artwork fields hold cover references, not image bytes. `videoId` is a
streamed play's YouTube video id; `songId` stays its recording key. Older clients may
omit both fields, which come back as null. Snapshot text has the same length limit
as other text. Migration `0005_play_snapshots` adds the nullable storage columns.

Migration `0006_follows` adds `follows`, `hidden_releases` and `notified_shows`. A service
from before it refuses a push naming them, so deploy it before an app that sends them. The
app leaves empty tables out of a push (Core's `pushBody`), so only a phone with follows
would be refused.

Migration `0009_dismissed_suggestions` adds `dismissed_suggestions`, the follow suggestions
the owner dismissed. Deploy it before an app that sends them; as with follows, only a phone
with a dismissal would be refused by an older service.

`200`, how many rows of each table won (and were stored):

```json
{
  "accepted": {
    "songs": 1,
    "playlists": 0,
    "playlistEntries": 1,
    "favorites": 0,
    "preferences": 1,
    "plays": 1,
    "follows": 0,
    "hiddenReleases": 0,
    "notifiedShows": 0,
    "dismissedSuggestions": 0
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
  "follows": [Follow],
  "hiddenReleases": [HiddenRelease],
  "notifiedShows": [NotifiedShow],
  "dismissedSuggestions": [DismissedSuggestion],
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

### `PUT /v1/soulseek`

Keeps the Soulseek account Download in best quality uses as the account's, replacing the one
it had. Only the app's native module sends it, with the session it holds: the credentials
never pass through the app's JS.

```json
{ "username": "quietfern42", "password": "…" }
```

`204`, no body. `400 { "error": "bad_request", "detail": "…" }` for a username Soulseek
can't log in with (1 to 30 printable ASCII characters, no space at either end) or an empty
password (at most 1,024 characters).

The password is kept encrypted with AES-GCM under the current Soulseek key, with the
account's id as additional data; the database never holds it in the clear. Each row records
the version of the key it was kept under (see [Soulseek keys](#soulseek-keys)).

### `GET /v1/soulseek`

The account's Soulseek account, or `null` when it has none:

```json
{ "account": { "username": "quietfern42", "password": "…" } }
```

A password kept under an older key is read with that key and kept again under the current
one. A password that doesn't decrypt (its version's key was replaced or removed) answers
`null` too, so the next phone's account goes up in its place. Without any Soulseek key, or
with one that isn't 32 bytes of base64 under a key name, both Soulseek routes answer `500`
and the log names the secret; the other routes still work.

### `DELETE /v1/account`

Deletes every row and every session of the account, its Soulseek account, and the account.
The session isn't enough: the body holds a Google ID token from a fresh sign-in.

```json
{ "idToken": "<Google ID token>" }
```

The token must pass the `POST /v1/session` checks, have been issued (`iat`) within the last
5 minutes and name the session account's Google `sub`. `204`, no body.

`401 { "error": "id_token_required" }` when the body has no ID token (an app from before this
check), `401 { "error": "invalid_id_token" }` when it doesn't check out. Either way nothing is
deleted and the session stays; the app tells these apart from `unauthorized`, which means the
session itself ended.

### `GET /v1/genius/search?q=<text>`, `GET /v1/genius/song?id=<id>`, `GET /v1/genius/referents?song=<id>&page=<n>`

Genius's search, song and referents as the Lyrics view asks them, answered with Genius's JSON
as it came. The service asks Genius with its own `GENIUS_ACCESS_TOKEN`; a phone never holds
it. Each route stands for exactly one Genius request, built by Core's `geniusUpstreamUrl`
(`packages/core/src/geniusProxy.ts`) from the functions the phone used to call Genius with:

| Route                          | Genius request                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `search?q=<text>`              | `api.genius.com/search?q=<text>`                                               |
| `song?id=<id>`                 | `api.genius.com/songs/<id>?text_format=plain`                                  |
| `referents?song=<id>&page=<n>` | `api.genius.com/referents?song_id=<id>&text_format=plain&per_page=50&page=<n>` |

Any other parameter, a repeated one, an id that isn't a positive whole number, a page past 20
or an empty search, or one over 1,000 characters, answers `400 { "error": "bad_request" }`
and asks Genius nothing. Redirects aren't followed.

Answers are kept in Cloudflare's cache for a day, keyed by the Genius request alone (a hash
of it), never by the account, so another phone asking the same thing gets it with no Genius
request. Each account may send these routes `maxGeniusRequestsPerMinute` requests, cached
answers included, and make Genius answer `maxGeniusRequestsPerDay` in a UTC day (cached
answers don't count; the counts are in `upstream_usage`). Genius answering anything but `200`
JSON, an answer holding the token, or no answer in 10 s gives
`502 { "error": "upstream_failed" }` with nothing of Genius's answer, and nothing is cached.
The log line says only `genius answered <status>`. A Worker without `GENIUS_ACCESS_TOKEN` or
`GENIUS_LIMITER` answers `503 { "error": "unavailable" }`.

### `GET /v1/ticketmaster/attractions?keyword=<name>`, `GET /v1/ticketmaster/events?attractionId=<id>&countryCode=<cc>`

A show check's attraction search and events, answered with Ticketmaster Discovery's JSON as it
came. The service asks Ticketmaster with its own `TICKETMASTER_API_KEY`; a phone never holds
it. Each route stands for exactly one request, built by Core's `ticketmasterUpstreamUrl`
(`packages/core/src/ticketmasterProxy.ts`), and the service adds `&apikey=<key>`:

| Route                                       | Ticketmaster request (`app.ticketmaster.com/discovery/v2/…`)            |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `attractions?keyword=<name>`                | `attractions.json?keyword=<name>&classificationName=music&size=200`     |
| `events?attractionId=<id>&countryCode=<cc>` | `events.json?attractionId=<id>&countryCode=<cc>&sort=date,asc&size=200` |

Any other parameter, a repeated one, an empty name or one over 500 characters, an id that
isn't letters, digits, `_` or `-` (64 at most), or a country that isn't two capital letters
answers `400 { "error": "bad_request" }` and asks Ticketmaster nothing.

Answers are kept in Cloudflare's cache for 12 hours, keyed by the request without the key (a
hash of it), never by the account. Ticketmaster takes about 5 requests a second for the key,
from every phone together, so the requests an isolate sends it start at least 250 ms apart; a
request that would wait more than 5 s for its turn answers `503 { "error": "busy" }` and asks
nothing. Each account may send these routes `maxTicketmasterRequestsPerMinute` requests and
make Ticketmaster answer `maxTicketmasterRequestsPerDay` in a UTC day, counted as for Genius.
Failures are Genius's too: `502 { "error": "upstream_failed" }` with nothing of Ticketmaster's
answer (its over-quota error names the key), nothing cached, and a log line that says only
`ticketmaster answered <status>`. A Worker without `TICKETMASTER_API_KEY` or
`TICKETMASTER_LIMITER` answers `503 { "error": "unavailable" }`.

### Errors

| Status | Body                                                                                       |
| ------ | ------------------------------------------------------------------------------------------ |
| 400    | `{ "error": "bad_request", "detail"?: "…" }`                                               |
| 401    | `{ "error": "unauthorized" }` (no session, or it ended)                                    |
| 401    | `{ "error": "invalid_id_token" }`                                                          |
| 401    | `{ "error": "id_token_required" }`                                                         |
| 403    | `{ "error": "not_allowed" }`                                                               |
| 403    | `{ "error": "limit", "limit": "maxAccounts" }`                                             |
| 404    | `{ "error": "not_found" }`                                                                 |
| 413    | `{ "error": "limit", "limit": "<name>" }`                                                  |
| 429    | `{ "error": "limit", "limit": "maxRequestsPerMinute" }`, with `Retry-After`                |
| 429    | `{ "error": "limit", "limit": "maxSignInsPerMinute" }`, with `Retry-After`                 |
| 429    | `{ "error": "limit", "limit": "maxNewAccountsPerDay" }`, with `Retry-After`                |
| 429    | `{ "error": "limit", "limit": "maxRequestsPerAddressPerMinute" }`, with `Retry-After`      |
| 429    | `{ "error": "limit", "limit": "maxFailedLookupsPerAddressPerMinute" }`, with `Retry-After` |
| 429    | `{ "error": "limit", "limit": "maxGeniusRequestsPerMinute" }`, with `Retry-After`          |
| 429    | `{ "error": "limit", "limit": "maxGeniusRequestsPerDay" }`, with `Retry-After`             |
| 429    | `{ "error": "limit", "limit": "maxTicketmasterRequestsPerMinute" }`, with `Retry-After`    |
| 429    | `{ "error": "limit", "limit": "maxTicketmasterRequestsPerDay" }`, with `Retry-After`       |
| 500    | `{ "error": "internal" }`                                                                  |
| 502    | `{ "error": "upstream_failed" }`                                                           |
| 503    | `{ "error": "unavailable" }`                                                               |
| 503    | `{ "error": "busy" }`                                                                      |

## Limits

`SYNC_LIMITS` in `src/limits.ts`. Past one, the service answers `413` (`429` for a rate,
`403` for `maxAccounts`) and names it. Starting values, so a 50,000-song Library with 200,000 plays fits:

| Limit                                 | Value     |                                                      |
| ------------------------------------- | --------- | ---------------------------------------------------- |
| `maxBodyBytes`                        | 2 MiB     | per request; a large first push goes in batches      |
| `maxSongs`                            | 100,000   | rows per account, tombstones aside                   |
| `maxPlaylists`                        | 5,000     |                                                      |
| `maxPlaylistEntries`                  | 250,000   |                                                      |
| `maxFavorites`                        | 100,000   |                                                      |
| `maxPreferences`                      | 200       |                                                      |
| `maxPlays`                            | 1,000,000 |                                                      |
| `maxFollows`                          | 5,000     |                                                      |
| `maxHiddenReleases`                   | 50,000    |                                                      |
| `maxNotifiedShows`                    | 50,000    |                                                      |
| `maxDismissedSuggestions`             | 50,000    |                                                      |
| `maxRequestsPerMinute`                | 120       | per session                                          |
| `maxSignInsPerMinute`                 | 10        | `POST /v1/session`, per address and per account      |
| `maxAccounts`                         | 100       | accounts the service holds                           |
| `maxNewAccountsPerDay`                | 10        | new accounts in any 24 hours                         |
| `maxRequestsPerAddressPerMinute`      | 600       | every route, per address                             |
| `maxFailedLookupsPerAddressPerMinute` | 20        | lookups that find no session, per address            |
| `failedLookupBlockSeconds`            | 300       | how long an address past the line above is held back |
| `maxGeniusRequestsPerMinute`          | 30        | the Genius routes, per account                       |
| `maxGeniusRequestsPerDay`             | 1,000     | Genius requests the cache didn't answer, per account |
| `maxTicketmasterRequestsPerMinute`    | 300       | the Ticketmaster routes, per account                 |
| `maxTicketmasterRequestsPerDay`       | 15,000    | Ticketmaster requests the cache didn't answer        |

The two per-address rates, `maxGeniusRequestsPerMinute` and `maxTicketmasterRequestsPerMinute`
are also the `simple.limit` of `ADDRESS_LIMITER`, `FAILED_LOOKUP_LIMITER`, `GENIUS_LIMITER` and
`TICKETMASTER_LIMITER` in `wrangler.toml`; a test fails when they differ. Change both, then
deploy. The Ticketmaster limits fit the show checks of an account with `maxFollows` artists
followed at shows (a show check starts its calls at least 250 ms apart, and each artist costs
an attraction search once and an events call every 12 hours). Ticketmaster allows the key
5,000 requests a day in all, so that key, not these limits, is what a very large account
would run out.

A push that would take a table past its limit is refused whole.

## Configuration

Set on the Worker, never in the repo (`wrangler.toml` holds none of them; it holds only the
rate limiting bindings, which `wrangler deploy` creates and which need Wrangler 4.36 or
later):

| Name                   | Kind   |                                                                     |
| ---------------------- | ------ | ------------------------------------------------------------------- |
| `TURSO_DATABASE_URL`   | secret | `libsql://<db>-<org>.turso.io`                                      |
| `TURSO_AUTH_TOKEN`     | secret | a Turso token for that database                                     |
| `GOOGLE_CLIENT_ID`     | secret | Wave's **web** OAuth client id, the audience of the app's ID tokens |
| `SOULSEEK_KEY`         | secret | base64 of 32 random bytes: version 1 of the Soulseek key            |
| `SOULSEEK_KEY_<n>`     | secret | optional: version n (2 or more) of the Soulseek key, the same way   |
| `ALLOWED_EMAILS`       | secret | optional: emails that may sign in, separated by commas              |
| `GENIUS_ACCESS_TOKEN`  | secret | Genius's client access token, for the Genius routes                 |
| `TICKETMASTER_API_KEY` | secret | Ticketmaster Discovery's API key, for the Ticketmaster routes       |

### Soulseek keys

Soulseek passwords are kept under the highest key version the Worker has: `SOULSEEK_KEY` is
version 1 and `SOULSEEK_KEY_2`, `SOULSEEK_KEY_3`, … the next ones. Each row records its
version and is read with that version's key, then kept again under the current key, so the
app sees no change. To replace the key, set the next version and leave the older ones:

```sh
cd apps/sync
openssl rand -base64 32 | pnpm exec wrangler secret put SOULSEEK_KEY_2
```

An older version can go once no row uses it
(`SELECT count(*) FROM soulseek_accounts WHERE key_version < 2`); a row still under a
removed version reads as none, and the account's next phone puts its account up again.

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
SOULSEEK_KEY=<openssl rand -base64 32>
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
`SOULSEEK_KEY` (made once, and kept on the Worker on later runs), and a check that the live
service answers `401` to requests without a valid sign-in. Last,
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
   openssl rand -base64 32 | pnpm exec wrangler secret put SOULSEEK_KEY
   pnpm exec wrangler secret put GENIUS_ACCESS_TOKEN
   pnpm exec wrangler secret put TICKETMASTER_API_KEY
   ```

   Make `SOULSEEK_KEY` once and never overwrite it: the Soulseek accounts kept under it
   couldn't be read again. To replace the key, add the next version instead
   ([Soulseek keys](#soulseek-keys)).

4. Migrate and deploy. The `deploy` script runs the pending migrations against the database
   in your shell's environment, then `wrangler deploy` (it needs `run`: `pnpm deploy` is a
   pnpm command of its own):

   ```sh
   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… pnpm --filter @wave/sync run deploy
   ```

Deploy play snapshot and video id support before releasing an app that sends those
fields. Existing clients can keep pushing and pulling while the new service runs.

## Extending it

- **A route:** a handler in `src/service.ts`, wrapped in `withSession` when it needs a
  session, and an entry in `routes` (`"PUT /v1/soulseek": …`). Document its shapes here.
- **A synced table or field:** a new migration at the end of `MIGRATIONS` (never edit one
  that's deployed) and the matching entry in `SYNC_TABLES`. Push and pull pick it up.
- **A setting:** add it to `Env` in `src/worker.ts` and the table above, and set it with
  `wrangler secret put`.
