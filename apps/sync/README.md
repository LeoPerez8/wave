# Wave sync service

`apps/sync` is the backend behind the Wave account: a Cloudflare Worker in front of one Turso
(libSQL) database. Wave's other backend, the update service, is `apps/updates`. It checks Google ID tokens, holds sessions, merges pushed rows by Core's rules
(`mergeRows`, `mergePlays` from `@wave/core`), serves pulls, keeps each account's Soulseek
account, asks Genius and Ticketmaster for signed-in phones and deletes accounts. See "Wave
account and sync", "Genius About" and "Followed artists" in `docs/spec.md`.

| File                    | What it holds                                                           |
| ----------------------- | ----------------------------------------------------------------------- |
| `src/worker.ts`         | The Worker entry: builds the service from the Worker's secrets and vars |
| `src/service.ts`        | The routes, sessions, the rate limits and the allowlist                 |
| `src/google.ts`         | Checking a Google ID token (RS256 against Google's JWKS)                |
| `src/store.ts`          | Push (merge and number changes), pull (pages) and account deletion      |
| `src/collaborations.ts` | A collaborative playlist's record: owner, members, leaving and removal  |
| `src/invites.ts`        | A collaborative playlist's invite link: create, read, turn off, join    |
| `src/soulseek.ts`       | The account's Soulseek account, its password encrypted (`SOULSEEK_KEY`) |
| `src/proxy.ts`          | A provider's fixed requests: the cache, the provider call, its failures |
| `src/tables.ts`         | The synced tables: wire fields, checks and columns                      |
| `src/migrations.ts`     | The schema, as ordered migrations                                       |
| `src/limits.ts`         | `SYNC_LIMITS` and `USAGE_WARNINGS`                                      |
| `src/sessions.ts`       | Session expiry and the hourly deletion of expired sessions              |
| `src/maintenance.ts`    | The hourly maintenance (the Cron Trigger): expired sessions, usage      |
| `src/usage.ts`          | The hourly usage watch                                                  |
| `src/compatibility.ts`  | The compatibility report: current use against the selected limits       |
| `scripts/migrate.ts`    | Runs pending migrations against `TURSO_DATABASE_URL`                    |

## API

Every body is JSON. Every route but `POST /v1/session`, the invite page (`GET /invite`) and
`GET /.well-known/assetlinks.json` needs the session token as
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
- Past `maxFailedLookupsPerAddressPerMinute` lookups that find no session, or no invite (a
  wrong invite token, see [Invite links](#invite-links)), the address's session routes answer
  `429` with
  `{ "error": "limit", "limit": "maxFailedLookupsPerAddressPerMinute" }` for
  `failedLookupBlockSeconds`, valid sessions included. Requests that find their session never
  count toward it, and other addresses aren't affected.

Both counts come from Cloudflare's rate limiting binding (`[[ratelimits]]` in
`wrangler.toml`), which counts locally and approximately: they're a best-effort brake on
heavy traffic, not an exact count per address. At most once a minute, the Worker logs how many requests it
refused and why (`sync service refused requests: unknown_session=20, held_address=140`), with
no token and no address.

### `POST /v1/session`

Signs in. The ID token must carry a valid RS256 signature by one of Google's keys, the
issuer `accounts.google.com`, an audience matching `GOOGLE_CLIENT_ID` (Wave's web client id)
or the optional `GOOGLE_DESKTOP_CLIENT_ID` (Wave's Desktop OAuth client id), an
expiry in the future and a verified email. The first sign-in with a Google account creates
its Wave account (keyed by Google's `sub`).

```json
{ "idToken": "<Google ID token>" }
```

`200`:

```json
{ "sessionToken": "<43 characters>", "email": "ana@example.com", "name": "Ana Souza" }
```

`name` is the name the service keeps for the account, `null` when it has none. Every sign-in
stores the ID token's `name` claim, cleaned and cut to 100 characters by Core's `accountName`
(`packages/core/src/accountName.ts`); a token without the claim leaves the name there is.
Every sign-in also stores the token's `picture` claim as the account's photo when Core's
`accountPhotoUrl` (`packages/core/src/accountPhoto.ts`) accepts it: an `https:` address on a
host ending in `.googleusercontent.com`. A token without one, or with any other address, stores
none, so a photo removed on Google goes. The members of a collaborative playlist see the account
by its name and photo, and nothing else of it. Migration `0020_account_photo` adds the
`photo_url` column, empty for the accounts there were until they sign in.

`401 { "error": "invalid_id_token" }` when the token doesn't check out,
`403 { "error": "not_allowed" }` when `ALLOWED_EMAILS` is set and the email isn't on it,
`429` past `maxSignInsPerMinute`: attempts from one address (Cloudflare's `CF-Connecting-IP`,
counted before the ID token is checked) or sign-ins to one Google account.

Those counts live in one table that keeps only the current minute and holds at most
`maxSignInKeysPerMinute` addresses and Google accounts together. When it's full, an attempt
from an address or for a Google account not yet counted that minute answers
`429 { "error": "limit", "limit": "maxSignInKeysPerMinute" }`, with `Retry-After` until the
next minute. Keys already counted keep counting toward `maxSignInsPerMinute`, nothing is
evicted or reset, and sessions already made keep working, since a request with a session never
touches the table. The cost: a flood from enough addresses can hold back new sign-ins for the
rest of a minute. That was accepted in #1127 over a table that grows with the flood.

A sign-in that would make a new account is refused, and makes nothing, when the service holds
`maxAccounts` accounts (`403 { "error": "limit", "limit": "maxAccounts" }`) or has made
`maxNewAccountsPerDay` in the last 24 hours (`429 { "error": "limit", "limit":
"maxNewAccountsPerDay" }`, with `Retry-After` until the oldest of them is a day old). Existing
accounts sign in either way. An account is one Google subject, so more phones and repeat
sign-ins take no new place, and a deleted account's place goes to the next new sign-in. The
daily count only sees accounts that still exist, so it isn't a cap on registrations after
deletions.

An account has at most `maxSessionsPerAccount` (10) valid sessions. A sign-in first deletes the
account's sessions that went 90 days without a request, then makes the session only if fewer
than 10 are left, all in one transaction, so sign-ins at the same moment can't pass the limit.
Past it, the sign-in answers `403 { "error": "limit", "limit": "maxSessionsPerAccount" }`,
makes nothing and ends no session: every phone already signed in stays signed in. Signing out
on one phone (`DELETE /v1/session`) frees its place, and Sign Out on All Phones
(`DELETE /v1/sessions`) frees all of the account's places and no other account's. An account
that held more than 10 valid sessions when the limit arrived keeps all of them and gets a new
one only once it is below 10; that excess is counted in the rollout evidence, not reported as
within the limit.

The service keeps only a SHA-256 of the session token. A session lasts until it is ended,
the account is deleted, or it goes 90 days without a request: then it answers
`401 { "error": "unauthorized" }` and is deleted. Every request made with it starts the 90
days again. A session that never comes back is deleted by the account's next sign-in or by the
hourly maintenance ([Hourly maintenance](#hourly-maintenance)), whichever is first.

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
  "dismissedSuggestions": [DismissedSuggestion],
  "dislikes": [Dislike]
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

| Table                  | `id`                             | Fields (`?` may be `null`)                                                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `songs`                | recording key                    | `title`, `credit`, `album?`, `albumArtist`, `discNumber?`, `trackNumber?`, `durationMs`, `year?`, `genre?`, `videoId?`, `addedAt`                                                                                                                                                                                 |
| `playlists`            | playlist id                      | `name`, `createdAt`                                                                                                                                                                                                                                                                                               |
| `playlistEntries`      | entry id                         | `playlistId`, `orderKey` (Core's `orderKeyBetween`), `songId?` (recording key), `ytSong?` (the YT Music song as the app stores it, text), `addedAt`, `title?`, `credit?`, `album?`, `durationMs?`, `videoId?` (a Library song's own fields), `addedBy?` (see below). Exactly one of `songId` and `ytSong` is set. |
| `favorites`            | recording key                    | `addedAt`                                                                                                                                                                                                                                                                                                         |
| `preferences`          | preference key                   | `value?` (text: what the app's key-value store holds, `null` for nothing)                                                                                                                                                                                                                                         |
| `plays`                | play id (made on the device)     | `songId` (recording key), `startedAt`, `listenedMs`, `durationMs?`, `endReason` (`completed`, `skipped`, `stopped`, `interrupted`), `counted` (boolean), `contextType?`, `contextId?`, `source` (`phone`, `auto`, `desktop`), `importedFrom?` (`blackplayer`)                                                     |
| `follows`              | artist name key                  | `name`, `level` (`releases`, `shows`), `followedAt`, `deezerId?`, `ytBrowseId?`                                                                                                                                                                                                                                   |
| `hiddenReleases`       | release key                      | none                                                                                                                                                                                                                                                                                                              |
| `notifiedShows`        | Ticketmaster event id            | none                                                                                                                                                                                                                                                                                                              |
| `dismissedSuggestions` | artist name key                  | `dismissedAt` (when the follow suggestion was dismissed; Undo is a tombstone)                                                                                                                                                                                                                                     |
| `dislikes`             | recording key, or `yt:<videoId>` | `title`, `artists` (a JSON array of names, as text), `durationMs?`, `dislikedAt` (the song as it was listed when disliked; removing the dislike is a tombstone)                                                                                                                                                   |

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

Migration `0014_dislikes` adds `dislikes`, the songs the owner disliked. A dislike's `id` is
the song's recording key, or `yt:<videoId>` for a YT Music song the Library has no file of.
The service merges dislikes and favorites each on their own; a song left with both is settled
by the app (Core's `settleMarks`), which pushes the removal. Deploy it before an app that
sends dislikes: an older service refuses a push naming them, so a phone with a dislike would
push nothing until it's deployed.

`200`, how many rows of each table won (and were stored), and the rows stored with another
change time than the one pushed:

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
    "dismissedSuggestions": 0,
    "dislikes": 0
  },
  "corrected": {
    "playlists": [{ "id": "…", "changedAt": 1760443200000 }]
  }
}
```

A `changedAt` ahead of the service's clock is stored as the service's time (Core's
`withinServiceClock`), before the merge, in every table but `plays`, which carries none.
`corrected` names each such row that was stored, by table, with the time it now has; a table
with none is left out. The app takes that time for its own row (Core's `readPushAnswer`), so
it agrees with the service and doesn't push the row again. An app from before `corrected`
ignores it.

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
  "dislikes": [Dislike],
  "cursor": "1234",
  "more": false,
  "collaborations": [Collaboration],
  "endedCollaborations": [{ "playlistId": "…", "reason": "left", "endedAt": 1760443200000 }]
}
```

Rows have the shapes pushed. A tombstone comes as `{ "id", "changedAt", "phoneId", "deleted": true }`.
Keep `cursor` for the next pull (it's opaque: send it back as is), and pull again at once while
`more` is `true`. With nothing new, `cursor` is the one sent.

Each accepted change gets the account's next change number in the transaction that writes
it, and a pull reads every table in one snapshot, so a pull never misses a change pushed
while it runs.

`collaborations` and `endedCollaborations` are not rows and have no cursor: every page states
them whole, as they are when the pull is answered (see
[Collaborative playlists](#collaborative-playlists)). `collaborations` lists each
collaborative playlist the account is in. `endedCollaborations` lists the playlists the
account was in and isn't any more, each with `reason`: `left` when the account left, `ended`
when the owner removed it or ended the collaboration (the answer doesn't say which). An end stays in every pull until the account joins that playlist again.
A playlist the account owned and ended is in neither list. An app from before these two keys
reads the rest of the page as before (Core's `readPullPage` takes the tables it knows).

### Collaborative playlists

A playlist's collaboration record (`docs/spec.md`, Collaborative playlists; `docs/adr/0005`):
the playlist's rows stay in the owner's account, and the record names the owner and the
members with when each joined. The owner is a member too. A playlist id names one
collaboration in the whole service. All five routes need the session.

A `Collaboration`, with the owner first and the others in the order they joined:

```json
{
  "playlistId": "5f0c…",
  "members": [
    {
      "accountId": "0b6e…",
      "name": "Ana Souza",
      "photoUrl": "https://lh3.googleusercontent.com/a/…",
      "joinedAt": 1760443200000,
      "owner": true,
      "self": true
    }
  ]
}
```

`name` is the account's Google account name and `photoUrl` its Google photo, each `null` when
the service has none; no email is ever given. The app reads a member without `photoUrl` (from a
service before photos were kept) as having none. `self` marks the account that asked. `accountId` is the service's id of the
account, the one `DELETE /v1/collaboration/members` takes.

| Route                                                         | Who                          | What it does                                                                                                  |
| ------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST /v1/collaboration`, body `{ "playlistId": "…" }`        | holder                       | Makes a playlist of the session's account collaborative, with the account as owner. `200` the `Collaboration` |
| `DELETE /v1/collaboration?playlist=<id>`                      | owner                        | Ends it: the record goes, the playlist's rows stay as they are. `204`                                         |
| `GET /v1/collaboration/members?playlist=<id>`                 | a member                     | `200` the `Collaboration`                                                                                     |
| `DELETE /v1/collaboration/members?playlist=<id>&account=<id>` | owner                        | Removes that member. `204`                                                                                    |
| `DELETE /v1/collaboration/membership?playlist=<id>`           | a member who isn't the owner | Leaves. `204`                                                                                                 |

Making a playlist collaborative again answers the collaboration as it is. Nothing here
changes a synced row or a cursor: the owner's and the members' devices learn of a make, a
removal, a leave and an end from their next pull.

Refusals:

- `404 { "error": "not_found" }`: `POST` for a playlist the account doesn't hold (unknown,
  deleted or another account's); removing an account that isn't in the playlist.
- `409 { "error": "taken" }`: `POST` for an id that names another account's collaboration.
- `403 { "error": "not_member" }`: the playlist isn't collaborative or the account isn't in
  it. The two answer the same.
- `403 { "error": "not_owner" }`: ending or removing a member as a member who isn't the owner.
- `403 { "error": "owner_cannot_leave" }`: the owner leaving, or removing itself.
- `400 { "error": "bad_request" }`: no `playlistId`, `playlist` or `account`.

Deleting an account (`DELETE /v1/account`) takes it out of the playlists it is in. Each
playlist it owns passes to the member who joined first, who becomes its owner: the playlist
row and every entry that names its id, Graveyard ones included, move to that account as its
next changes, so its ordinary pull carries them, and they count in its caps from then on,
even past them. A row that account held with the same id is replaced. The other members stay
in it and get no end record. A playlist with no other member goes with the account. An entry
tombstone keeps its playlist id, so it moves with it; one stored before migration
`0019_collaborative_entries` has none and goes with the account. The entries the account
added stay and name no one (`addedBy` becomes `null`).

Migration `0017_collaborations` adds `collaborations`, `collaboration_members` and
`collaboration_ends`, and changes no table there was. Deploy it before an app that calls
these routes.

### Invite links

The only way into a collaborative playlist (`docs/spec.md`, Collaborative playlists, Invite
link). A playlist has at most one active link: an https address on this service,
`https://<service>/invite#<token>`, valid for 7 days, for any number of people. The token is
32 random bytes in base64url, as a session token is, and goes after `#`, so a browser never
sends it. The service keeps only its SHA-256, with the link's expiry and state
(`collaboration_invites`); it can tell the owner when the current link ends, but not the link,
which the app that created it holds.

| Route                                                         | Who        | What it does                                                                                                                                                      |
| ------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/collaboration/invite`, body `{ "playlistId": "…" }` | owner      | Creates a link and ends the active one. `200 { "url": "https://…/invite#…", "expiresAt": 1761048000000 }`                                                         |
| `GET /v1/collaboration/invite?playlist=<id>`                  | owner      | `200 { "invite": { "createdAt": …, "expiresAt": … } }`, or `{ "invite": null }` when none lets people in                                                          |
| `DELETE /v1/collaboration/invite?playlist=<id>`               | owner      | Turns the active link off. `204`, also when there's none                                                                                                          |
| `POST /v1/invite`, body `{ "token": "…" }`                    | anyone     | `200 { "playlistId": "…", "playlistName": "Road trip", "ownerName": "Ana Souza" }`; joins nothing                                                                 |
| `POST /v1/invite/join`, body `{ "token": "…" }`               | anyone     | Makes the session's account a member. `200` the `Collaboration`                                                                                                   |
| `GET /invite`                                                 | no session | The page a browser shows: that this is a Wave invite and to open it in an up-to-date Wave, in the browser's language (`Accept-Language`). Nothing of the playlist |

"Anyone" is any signed-in account. A token goes in the body, never in a URL. Creating a new
link marks the earlier one `replaced`, turning it off marks it `off`, and removing a member
marks it `ended`; a member leaving leaves it as it is. People who joined stay members when
the link ends. Joining again, as a member or the owner, answers the collaboration and keeps
when the account joined; one that left or was ended joins again and loses its end record.
Ending the collaboration, and deleting the owner's account, delete its links.

Refusals, besides the owner routes' `403 not_member` and `403 not_owner` and `400 bad_request`
(no `playlistId` or `playlist`):

- `404 { "error": "not_found" }`: the token names no link, or isn't the shape of one. It counts
  as a failed lookup of the address (`maxFailedLookupsPerAddressPerMinute`), as an unknown
  session does.
- `410 { "error": "invite_ended" }`: the link expired, was turned off or replaced, or ended with a
  removal. Deleting the playlist ends its collaboration, which deletes its links, so their tokens
  answer `404`. A finished link is kept until a new link of its
  playlist is created after its expiry; then its token answers `404`.

Migration `0018_collaboration_invites` adds `collaboration_invites`, and changes no table
there was.

`GET /.well-known/assetlinks.json`, with no session, is Android's App Link check: it names
Wave's package (`dev.leoperez.wave`) and the SHA-256 of both certificates in the release APK's
rotation proof, the two `scripts/ci/sign-apk.sh` pins (`docs/spec.md`, APK signing): the release
key's and Expo's public debug key's. Android's verifier checks a rotated APK by the first
certificate of its proof, the debug key's, so with the release key's alone the phone's
`/invite` filter (`autoVerify: true` in `apps/mobile/app.config.ts`) stays unverified (#1417).
With both, a tapped link opens a released Wave with nothing to turn on in Open by default. A
build signed with the debug key alone, a local build included, is verified too; one signed with
any other key isn't. A change to either pinned key changes the constants in `src/service.ts` and
needs a deploy. Android checks the host when an APK is installed or updated, so a phone that
installed Wave before the deploy gets the host verified with its next APK update.

#### A member's push and pull of one playlist

A member who isn't the owner syncs each collaborative playlist with two requests of its own,
in the same cycle as its account's push and pull. Both write and read the rows in the owner's
account, so the owner's ordinary push and pull carry the members' changes, and both check
membership first. The owner may call them too.

- `POST /v1/collaboration/push?playlist=<id>`: the body and answer of `POST /v1/push`,
  holding only that playlist's row and entries. The rows merge into the owner's as any push
  merges (Core's `mergeTableRows`, a change time ahead of the service's clock corrected) and
  count in the owner's caps. An entry the owner holds in another playlist, or in none (a
  removal stored before entries kept their playlist), is dropped and the rest is stored, so
  the push is still done and the app stops sending it. So is a removal of an entry the service
  never held: nothing says which playlist it was in. The playlist's row takes the member's
  `name` alone; `createdAt` stays as stored.
- `GET /v1/collaboration/pull?playlist=<id>&since=<cursor>`: `{ "playlists": [Playlist],
"playlistEntries": [PlaylistEntry], "cursor": "<n>_<owner>", "more": false }`, every change
  of the playlist's row and entries after the cursor, whoever made it, oldest first and paged
  as `GET /v1/pull`. The cursor is per playlist and opaque to the app; start with none. It names
  the owner whose change numbers it counts, so after the playlist passes to another owner a
  cursor taken before starts from the beginning. Core's `readPullPage` reads it.

Refusals, besides those of `POST /v1/push`:

- `403 { "error": "not_member" }`: the playlist isn't collaborative (never was, or it ended)
  or the account isn't in it.
- `403 { "error": "deleted" }`: a push to a playlist whose row is a tombstone while it is
  still collaborative. The owner deleting the playlist ends its collaboration in the same push,
  as `DELETE /v1/collaboration` does, so members are then refused as `not_member` and their
  account pull says it ended.
- `403 { "error": "not_owner" }`: a push that deletes the playlist.
- `400 { "error": "bad_request", "detail": "…" }`: a push with another table, another
  playlist's row, or an entry that names another playlist; no `playlist`; a cursor that isn't
  one.
- `413 { "error": "limit", "limit": "maxCollaborativeSongs" }` or `"maxCollaborativeEntries"`.

What the service keeps of a collaborative playlist's rows, whoever pushes them, the owner's
ordinary push included:

- **Who added an entry.** `addedBy` is the account id (the `accountId` of the member list) of
  the session that first stored the entry; what an app sends is ignored, and later changes keep
  it. Every new entry of any playlist gets it; making a playlist collaborative names its owner on
  the entries stored before the field. An entry of a deleted account has `null`.
- **A Library song's own fields** (`title`, `credit`, `album`, `durationMs`, `videoId`), for
  the other members to match their Tracks by. An app from before them leaves them out, and a
  row it pushes keeps what's stored; a Library entry it adds to a collaborative playlist, with
  its recording key alone, is filled from the owner's `songs` row.
- **Bounds** (Core's `collaborativeRow`): the playlist's name, an entry's `title`, `credit` and
  `album`, and the title, artists and album inside `ytSong` are cut to 300 characters; a cover
  in `ytSong` (`artworkUrl`) that isn't an https address on YouTube's or Google's image hosts
  (`ytimg.com`, `googleusercontent.com`, `ggpht.com`) becomes `null`.
- **Size.** At most `maxCollaborativeSongs` live entries and `maxCollaborativeEntries` with
  the removed ones, as well as the owner's `maxPlaylistEntries`. A push past one is refused only
  when it raises that count, so a playlist already past it still takes moves and removals.
- **A deleted playlist.** The owner's push that deletes a collaborative playlist ends its
  collaboration (the other members get an `ended` record), and a live entry the same push, or
  a later one while it is still collaborative, sends into it is left out; removals still go in.

Migration `0019_collaborative_entries` adds those entry columns and an index for the
per-playlist pull. Deploy it before an app that sends them.

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
It leaves the collaborative playlists it is in, and the ones it owns end.
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

### `PUT /v1/account/name`

Keeps a name and a photo for the session's account, as a sign-in keeps the ID token's: an app
that signed in before they were kept sends its Google account name and photo once, each only
when it has one.

```json
{ "name": "Ana Souza", "photoUrl": "https://lh3.googleusercontent.com/a/ACg8oc…=s96-c" }
```

Both fields are optional. The name is stored when Core's `accountName` accepts it (text that
isn't empty once cleaned), cleaned and cut to 100 characters as a sign-in's is. The photo is
stored when Core's `accountPhotoUrl` accepts it (an `https:` URL on a host ending in
`.googleusercontent.com`); a photo it doesn't accept is ignored, and the photo there was stays.
`204`, no body, when it stored at least one of them. `400 { "error": "bad_request" }` when it
accepts neither, and nothing changes. A later sign-in replaces the photo with the token's, or
with none. Deleting the account deletes the name and the photo with it.

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
nothing. Each account may send these routes `maxTicketmasterRequestsPerMinute` requests, and
make `maxTicketmasterAttractionSearchesPerDay` attraction searches and
`maxTicketmasterEventLookupsPerDay` event lookups in a UTC day, cached answers included (the
counts are in `upstream_usage`, one row for each). A show check costs at most one of each per
artist, so that's 200 artists a day; the phone stops its own check there without asking.
Failures are Genius's too: `502 { "error": "upstream_failed" }` with nothing of Ticketmaster's
answer (its over-quota error names the key), nothing cached, and a log line that says only
`ticketmaster answered <status>`. A Worker without `TICKETMASTER_API_KEY` or
`TICKETMASTER_LIMITER` answers `503 { "error": "unavailable" }`.

### Errors

| Status | Body                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------- |
| 400    | `{ "error": "bad_request", "detail"?: "…" }`                                                   |
| 401    | `{ "error": "unauthorized" }` (no session, or it ended)                                        |
| 401    | `{ "error": "invalid_id_token" }`                                                              |
| 401    | `{ "error": "id_token_required" }`                                                             |
| 403    | `{ "error": "not_allowed" }`                                                                   |
| 403    | `{ "error": "limit", "limit": "maxAccounts" }`                                                 |
| 403    | `{ "error": "limit", "limit": "maxSessionsPerAccount" }`                                       |
| 404    | `{ "error": "not_found" }`                                                                     |
| 413    | `{ "error": "limit", "limit": "<name>" }`                                                      |
| 429    | `{ "error": "limit", "limit": "maxRequestsPerMinute" }`, with `Retry-After`                    |
| 429    | `{ "error": "limit", "limit": "maxSignInsPerMinute" }`, with `Retry-After`                     |
| 429    | `{ "error": "limit", "limit": "maxSignInKeysPerMinute" }`, with `Retry-After`                  |
| 429    | `{ "error": "limit", "limit": "maxNewAccountsPerDay" }`, with `Retry-After`                    |
| 429    | `{ "error": "limit", "limit": "maxRequestsPerAddressPerMinute" }`, with `Retry-After`          |
| 429    | `{ "error": "limit", "limit": "maxFailedLookupsPerAddressPerMinute" }`, with `Retry-After`     |
| 429    | `{ "error": "limit", "limit": "maxGeniusRequestsPerMinute" }`, with `Retry-After`              |
| 429    | `{ "error": "limit", "limit": "maxGeniusRequestsPerDay" }`, with `Retry-After`                 |
| 429    | `{ "error": "limit", "limit": "maxTicketmasterRequestsPerMinute" }`, with `Retry-After`        |
| 429    | `{ "error": "limit", "limit": "maxTicketmasterAttractionSearchesPerDay" }`, with `Retry-After` |
| 429    | `{ "error": "limit", "limit": "maxTicketmasterEventLookupsPerDay" }`, with `Retry-After`       |
| 500    | `{ "error": "internal" }`                                                                      |
| 502    | `{ "error": "upstream_failed" }`                                                               |
| 503    | `{ "error": "unavailable" }`                                                                   |
| 503    | `{ "error": "busy" }`                                                                          |

## Limits

`SYNC_LIMITS` in `src/limits.ts`. Past one, the service answers `413` (`429` for a rate,
`403` for `maxAccounts` and `maxSessionsPerAccount`) and names it. Starting values, so a 50,000-song Library with 200,000 plays fits:

| Limit                                     | Value     |                                                      |
| ----------------------------------------- | --------- | ---------------------------------------------------- |
| `maxBodyBytes`                            | 2 MiB     | per request; a large first push goes in batches      |
| `maxSongs`                                | 100,000   | rows per account, tombstones included                |
| `maxPlaylists`                            | 5,000     |                                                      |
| `maxPlaylistEntries`                      | 250,000   |                                                      |
| `maxCollaborativeSongs`                   | 2,000     | live entries of one collaborative playlist           |
| `maxCollaborativeEntries`                 | 10,000    | its entries with the removed ones                    |
| `maxFavorites`                            | 100,000   |                                                      |
| `maxPreferences`                          | 200       |                                                      |
| `maxPlays`                                | 1,000,000 |                                                      |
| `maxFollows`                              | 5,000     |                                                      |
| `maxHiddenReleases`                       | 50,000    |                                                      |
| `maxNotifiedShows`                        | 50,000    |                                                      |
| `maxDismissedSuggestions`                 | 50,000    |                                                      |
| `maxDislikes`                             | 50,000    |                                                      |
| `maxRequestsPerMinute`                    | 120       | per session                                          |
| `maxSignInsPerMinute`                     | 10        | `POST /v1/session`, per address and per account      |
| `maxSignInKeysPerMinute`                  | 1,000     | addresses and accounts counted in a minute, together |
| `maxAccounts`                             | 10        | accounts the service holds at once                   |
| `maxNewAccountsPerDay`                    | 10        | new accounts in any 24 hours                         |
| `maxSessionsPerAccount`                   | 10        | valid sessions per account, for a new sign-in        |
| `maxRequestsPerAddressPerMinute`          | 600       | every route, per address                             |
| `maxFailedLookupsPerAddressPerMinute`     | 20        | lookups that find no session or invite, per address  |
| `failedLookupBlockSeconds`                | 300       | how long an address past the line above is held back |
| `maxGeniusRequestsPerMinute`              | 30        | the Genius routes, per account                       |
| `maxGeniusRequestsPerDay`                 | 1,000     | Genius requests the cache didn't answer, per account |
| `maxTicketmasterRequestsPerMinute`        | 300       | the Ticketmaster routes, per account                 |
| `maxTicketmasterAttractionSearchesPerDay` | 200       | attraction searches, cached or not, per account      |
| `maxTicketmasterEventLookupsPerDay`       | 200       | event lookups, cached or not, per account            |

A table's row limit counts its tombstones with its live rows, and the service never removes either
to make room. A push is refused whole only when a table it adds an id to would then hold more rows
than its limit; a change to an id the account already holds (an edit, a removal, bringing it back)
always fits, so a table already past its limit keeps its rows and refuses only new ids. A refused
push stores nothing and moves no cursor.

The two per-address rates, `maxGeniusRequestsPerMinute` and `maxTicketmasterRequestsPerMinute`
are also the `simple.limit` of `ADDRESS_LIMITER`, `FAILED_LOOKUP_LIMITER`, `GENIUS_LIMITER` and
`TICKETMASTER_LIMITER` in `wrangler.toml`; a test fails when they differ. Change both, then
deploy. The two per-address rates are best effort (Refused before the database). The phone stops a show check at 200 artists a UTC day, Core's
`TICKETMASTER_ARTISTS_PER_DAY`, checking artists it never checked first and then the oldest
checks, so a longer list is covered over the following days. Ticketmaster allows the key 5,000
requests a day in all, shared by every account.

A push that would take a table past its limit is refused whole.

## Hourly maintenance

Every hour (`[triggers]` in `wrangler.toml`) the Worker runs `src/maintenance.ts`. It deletes
every session that went 90 days without a request, so a phone that never comes back doesn't
keep its place, and runs the usage watch below. Each task runs whatever happens to the other:
missing analytics secrets or a failed Cloudflare request don't stop the session cleanup, and a
failed cleanup logs `maintenance: couldn't delete expired sessions` and still runs the watch.
It deletes nothing else: no valid session, synced row or tombstone.

### Every session lost while the account is full

If an account holds 10 valid sessions and none of those phones still has its token (all reset,
lost or reinstalled), a new sign-in is refused until one expires, 90 days after its last
request. Nothing in the service resets this, on purpose: there is no public route to end
sessions without one of them, and no way around the Google sign-in. When the holder can't wait,
the owner ends that account's sessions with the runbook's step for ending sessions, scoped to
that one account, after confirming who is asking through a channel the owner already trusts.
The account's data stays, and the holder signs in again.

## Usage watch

Every hour, as part of the hourly maintenance, the Worker reads today's requests to every Worker
on the Cloudflare account (Workers Free stops all of them at 100,000 a day, from midnight UTC)
and compares them with `USAGE_WARNINGS` in `src/limits.ts`:

| Threshold              | Value  |                                 |
| ---------------------- | ------ | ------------------------------- |
| `workerRequestsPerDay` | 70,000 | of Workers Free's 100,000 a day |

Past it, it logs a line starting `wave usage warning:` with `console.error`, once a UTC day
(the `usage_warnings` table remembers which went out). When it can't read the figures it logs
the same kind of line, once a day. Search the Worker's logs for `wave usage warning` to see
them; a Cloudflare notification on that line emails the owner. Without its secrets the watch
is skipped. Change the threshold in `src/limits.ts` and deploy.

Each run first deletes the `usage_warnings` rows older than today and the 29 UTC days before
it, so with today's two kinds of line the table holds at most 60 rows. That cleanup runs with
or without the secrets and whether or not Cloudflare answers; if it fails, the run logs a note
and still reads the figures. There's no route that runs it.

### Operational tables

The rows the service keeps for itself, apart from the synced Library, and what bounds each:

| Table                   | Bound                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `usage_warnings`        | today and the 29 UTC days before, deleted by the usage watch                               |
| `upstream_usage`        | one row per account and provider count (three today), reset by the next UTC day's request  |
| `sign_in_windows`       | `maxSignInKeysPerMinute` keys of the current minute; a sign-in deletes older minutes' rows |
| `sessions`              | ended by sign-out, 90 idle days or account deletion (`POST /v1/session`)                   |
| `accounts`              | `maxAccounts`                                                                              |
| `soulseek_accounts`     | one row per account                                                                        |
| `migrations`            | one row per migration                                                                      |
| `collaborations`        | one row per collaborative playlist, a live playlist of its owner when made                 |
| `collaboration_members` | one row per collaborative playlist and account in it, so at most `maxAccounts` a playlist  |
| `collaboration_ends`    | one row per account and playlist it was in and isn't any more; deleted with the account    |

The usage watch deletes `usage_warnings` rows and nothing else. Sessions, sign-in counts,
tombstones and synced rows are bounded by the session, sign-in and table limits above, never by
it; it never resets a provider's count for the day either.

Turso's usage (rows read and written, storage) is checked by hand once a month, in Turso's
dashboard. The Worker holds no Turso Platform token: one can do far more than read usage, and
the Worker already holds the database.

## Compatibility report

Before a limit from the security readiness spec (#1122) is switched on, the compatibility report
checks that it wouldn't interrupt how the service is used now. It only reads and only counts:
accounts are `account-1`, `account-2`… by creation order, and no token, email, Google subject,
key or row leaves the database. It changes nothing, evicts no account and revokes no session.

It compares, against the limits it's checking (`SELECTED_LIMITS` in `src/compatibility.ts`):

- accounts held, against `maxAccounts`;
- per account, valid sessions (used in the last 90 days) against `maxSessionsPerAccount`, and
  expired ones the hourly maintenance hasn't deleted yet apart;
- per account and synced table, rows held with tombstones counted, against the table's limit;
- this minute's sign-in counters against `maxSignInKeysPerMinute`, and older ones apart;
- `usage_warnings` rows against 60, and those older than the 30 days kept;
- `upstream_usage` rows, and the most one account holds, against three.

The result is `compatible`, `incompatible` or `insufficient-evidence`, dated, with the
environment's name, the revision checked and the reasons. Over `maxAccounts`, `maxSessionsPerAccount`
or a table's limit is flagged, and so is being exactly at one: the next phone's sign-in or the
next new row would be refused. A full sign-in counter table is flagged too. Without the database,
or without the owner's checks of the installed app, the result is `insufficient-evidence`, never
`compatible`.

Run it from the owner's machine with a read-only database token, right before activation:

```sh
turso db tokens create wave-sync --read-only --expiration 1h
TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=<read-only token> \
  pnpm --filter @wave/sync run compatibility --environment production-sync \
  --revision <commit being switched on> \
  --installed-client sign-in=passed,push-pull=passed,library-preserved=passed,sessions-preserved=passed
```

It prints the report as JSON and exits 0 when compatible, 1 when incompatible and 2 on
insufficient evidence. Pass `--installed-client` only with what you saw on a phone running the
installed Wave against that service: signing in again, a push and a pull, the Library unchanged
after them, and the phone's other sessions still signed in. Leave out a check you didn't see; it
stays pending. `--source fixture` marks a local or test database.

Without access to the database, run it anyway: it prints a dated `insufficient-evidence` report.
Keep that as the pending evidence, and don't switch the limit on. `activationBlockers` in
`src/compatibility.ts` is what decides whether a report can authorize activation: only a
`compatible` report of the live service, for the same revision, taken in the hour before. An
older report, one from a test database or one for another revision doesn't count, so take a new
one each time.

## Configuration

Set on the Worker, never in the repo (`wrangler.toml` holds none of them; it holds only the
rate limiting bindings, which `wrangler deploy` creates and which need Wrangler 4.36 or
later, the usage watch's Cron Trigger and the Workers Logs and Issues settings, with
invocation logs off):

| Name                         | Kind   |                                                                             |
| ---------------------------- | ------ | --------------------------------------------------------------------------- |
| `TURSO_DATABASE_URL`         | secret | `libsql://<db>-<org>.turso.io`                                              |
| `TURSO_AUTH_TOKEN`           | secret | a Turso token for that database                                             |
| `GOOGLE_CLIENT_ID`           | secret | Wave's **web** OAuth client id, the audience of the app's ID tokens         |
| `GOOGLE_DESKTOP_CLIENT_ID`   | secret | optional: Wave's Desktop OAuth client id; unset accepts only the web client |
| `SOULSEEK_KEY`               | secret | base64 of 32 random bytes: version 1 of the Soulseek key                    |
| `SOULSEEK_KEY_<n>`           | secret | optional: version n (2 or more) of the Soulseek key, the same way           |
| `ALLOWED_EMAILS`             | secret | optional: emails that may sign in, separated by commas                      |
| `GENIUS_ACCESS_TOKEN`        | secret | Genius's client access token, for the Genius routes                         |
| `TICKETMASTER_API_KEY`       | secret | Ticketmaster Discovery's API key, for the Ticketmaster routes               |
| `CLOUDFLARE_ACCOUNT_ID`      | secret | optional, for the usage watch: the Cloudflare account id                    |
| `CLOUDFLARE_ANALYTICS_TOKEN` | secret | optional, for the usage watch: a token with only Account Analytics Read     |

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
client the service checks ID tokens against, an Android client for `dev.leoperez.wave` with
the SHA-1 of Expo's template debug keystore, which signs local builds and the releases before
the release key, and one with the release key's SHA-1, which signs every release since), signing in to Cloudflare, the migrations, `wrangler deploy`, the Worker's secrets,
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
   pnpm command of its own). It stops before `wrangler deploy` when the database holds more
   than `maxAccounts` accounts, and removes none:

   ```sh
   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… pnpm --filter @wave/sync run deploy
   ```

Before the first deploy with `maxSessionsPerAccount`, count each account's valid sessions in
the live database (read only, counts only; the [compatibility report](#compatibility-report)
does it) and record any account at or above 10 in the rollout evidence. If that count shows the limit would refuse a sign-in someone needs, stop and agree a
plan with the owner first; the limit never ends a session to make room, but it does refuse new
ones.

Deploy play snapshot and video id support before releasing an app that sends those
fields. Existing clients can keep pushing and pulling while the new service runs.

Before the desktop sign-in ticket ships, the owner must create a Desktop OAuth client,
set `GOOGLE_DESKTOP_CLIENT_ID` on the Worker (for example with
`pnpm exec wrangler secret put GOOGLE_DESKTOP_CLIENT_ID` from `apps/sync`), and deploy
with `pnpm --filter @wave/sync run deploy`. Keep the client id out of the repo.
Deploy this Worker's `desktop` play-source support and ship the phone release that
accepts it before any desktop build sends plays. Existing phones keep their web client.

## Extending it

- **A route:** a handler in `src/service.ts`, wrapped in `withSession` when it needs a
  session, and an entry in `routes` (`"PUT /v1/soulseek": …`). Document its shapes here.
- **A synced table or field:** a new migration at the end of `MIGRATIONS` (never edit one
  that's deployed) and the matching entry in `SYNC_TABLES`. Push and pull pick it up.
- **A setting:** add it to `Env` in `src/worker.ts` and the table above, and set it with
  `wrangler secret put`.
