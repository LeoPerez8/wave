# Shared playlists

Research for playlists that several Wave users edit, and whether people on YouTube Music can take part. Checked on 2026-11-20 against `ac8c95dc` (Release Wave 0.73.0-ti). Repo facts cite a path and line; everything else cites the page or file that owns the claim. "Inference:" marks a conclusion no source states, and each part ends with what could not be verified.

## Summary

- The spec excludes this today: "sharing between accounts" is in Out of Scope ([docs/spec.md:1298](spec.md#L1298)), and the service admits 10 accounts ([apps/sync/src/limits.ts:64](../apps/sync/src/limits.ts#L64)).
- Every synced row is keyed by `(account_id, id)` and authorised by one equality on the session's account. Playlists have no owner, member or visibility.
- The order model already fits several editors: a fractional `order_key` per entry with row-level last writer wins, the design Figma runs and the one Kleppmann's move paper arrives at. What does not carry over is deciding conflicts by device clocks the service never checks.
- A streamed entry is self-contained and travels between users. A Library entry is a recording key built from its owner's tags and does not.
- There is no channel from the service to a device; a change is seen at the next pull.
- YouTube Music has collaborative playlists, joined by an invite link. The official Data API has no notion of them. The private InnerTube API can join one and read it; no source shows a non-owner collaborator adding or reordering through either route, and removing has one report from 2020. A two-account test would settle it.
- Wave writes only to YT Music playlists whose page has the owner's editable header, as OuterTune, Metrolist and ytmusicapi do. Whether a collaborator gets that header is unknown.

## Wave today

What exists, and what is missing for two users to edit the same playlist. Read on 2026-11-20 at `ac8c95dc` (Release Wave 0.73.0-ti). Every citation is a line I opened. "Inference:" marks a conclusion drawn from code that no test or spec line states.

The spec rules this feature out today. Its Out of Scope list names "Uploading audio to the Wave account, a web view of it, sharing between accounts, and signing in with anything but Google" ([docs/spec.md:1298](spec.md#L1298)). The account is described as "a backup and nothing more" (story 79, [docs/spec.md:209](spec.md#L209)), and its purpose as "Changing phones without losing the Library" ([docs/spec.md:602](spec.md#L602)). Shared playlists change that decision, so the spec needs an edit before any ticket.

### Account

- A Wave account is one Google subject. The `accounts` table has a random `id`, `google_sub TEXT NOT NULL UNIQUE`, `email`, `created_at` and `change_seq` ([apps/sync/src/migrations.ts:19](../apps/sync/src/migrations.ts#L19)). The id is `crypto.randomUUID()`, made at the first sign-in ([apps/sync/src/service.ts:343](../apps/sync/src/service.ts#L343)). The email is rewritten at every sign-in ([apps/sync/src/service.ts:339](../apps/sync/src/service.ts#L339)).
- The Worker verifies the Google ID token itself: RS256 signature against Google's JWKS, issuer, audience among Wave's client ids, expiry, a non-empty `sub`, and `email_verified === true` ([apps/sync/src/google.ts:108](../apps/sync/src/google.ts#L108), checks at lines 123 to 136). Two audiences are accepted, the phone's web client id and the desktop's ([apps/sync/src/service.ts:237](../apps/sync/src/service.ts#L237)).
- The session token is 32 random bytes in base64url, 43 characters ([apps/sync/src/service.ts:215](../apps/sync/src/service.ts#L215), [apps/sync/src/service.ts:325](../apps/sync/src/service.ts#L325)). The database keeps only its SHA-256 ([apps/sync/src/migrations.ts:26](../apps/sync/src/migrations.ts#L26), [apps/sync/src/service.ts:364](../apps/sync/src/service.ts#L364)). `POST /v1/session` answers `{ sessionToken, email }` and nothing else ([apps/sync/src/service.ts:388](../apps/sync/src/service.ts#L388)). The client never learns the account id or the Google subject.
- Every other route resolves `Authorization: Bearer <token>` to one `account_id` ([apps/sync/src/service.ts:425](../apps/sync/src/service.ts#L425), returned at line 460). A session ends after 90 days unused ([apps/sync/src/sessions.ts:11](../apps/sync/src/sessions.ts#L11)); an account holds at most 10 ([apps/sync/src/limits.ts:73](../apps/sync/src/limits.ts#L73)).
- The phone signs in with Android's Credential Manager (`GetSignInWithGoogleOption`, [GoogleSignIn.kt:21](../apps/mobile/modules/wave-native/android/src/main/java/expo/modules/wavenative/account/GoogleSignIn.kt#L21)), sends the ID token once and keeps the session token encrypted in no-backup storage ([AndroidWaveAccount.kt:10](../apps/mobile/modules/wave-native/android/src/main/java/expo/modules/wavenative/account/AndroidWaveAccount.kt#L10), [WaveAccountStore.kt:42](../packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/account/WaveAccountStore.kt#L42)). JS never holds it; the native module sends pushes and pulls ([docs/spec.md:604](spec.md#L604)).
- The desktop signs in through the default browser with a Desktop OAuth client, loopback and PKCE, then calls the same `POST /v1/session` ([docs/spec-desktop.md:264](spec-desktop.md#L264)). It keeps the token encrypted with Electron's `safeStorage`, in the main process ([apps/desktop/src/main/account/sessionStore.ts:2](../apps/desktop/src/main/account/sessionStore.ts#L2), [docs/spec-desktop.md:459](spec-desktop.md#L459)).
- The service holds at most 10 accounts, first come, and makes at most 10 new ones a day ([apps/sync/src/limits.ts:64](../apps/sync/src/limits.ts#L64), [docs/spec.md:603](spec.md#L603)). An optional email allowlist exists, unset by default ([apps/sync/src/service.ts:321](../apps/sync/src/service.ts#L321)).

### Storage

- One Turso (libSQL) database behind the Worker, "with the account's id on every row" ([docs/spec.md:628](spec.md#L628)). Ten synced tables: songs, playlists, playlist entries, favorites, preferences, plays, follows, hidden releases, notified shows, dismissed suggestions ([packages/core/src/syncWire.ts:148](../packages/core/src/syncWire.ts#L148)). Each has the primary key `(account_id, id)`.
- The playlist table, from migration `0002_synced_rows` ([apps/sync/src/migrations.ts:63](../apps/sync/src/migrations.ts#L63)):

```sql
CREATE TABLE playlists (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  change_no INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  phone_id TEXT NOT NULL,
  deleted INTEGER NOT NULL,
  name TEXT,
  created_at INTEGER,
  PRIMARY KEY (account_id, id)
)
```

- The playlist-entry table ([apps/sync/src/migrations.ts:75](../apps/sync/src/migrations.ts#L75)), plus `removed_at INTEGER` added by `0008_playlist_graveyard` ([apps/sync/src/migrations.ts:208](../apps/sync/src/migrations.ts#L208)):

```sql
CREATE TABLE playlist_entries (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  change_no INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  phone_id TEXT NOT NULL,
  deleted INTEGER NOT NULL,
  playlist_id TEXT,
  order_key TEXT,
  song_id TEXT,
  yt_song TEXT,
  added_at INTEGER,
  PRIMARY KEY (account_id, id)
)
```

- A playlist row carries a name and a creation time. It has no owner column, no visibility and no member list. `playlist_entries.playlist_id` is plain text with no foreign key.
- Every read and write filters on the session's account: held rows ([apps/sync/src/store.ts:40](../apps/sync/src/store.ts#L40)), the upsert's conflict target ([apps/sync/src/store.ts:81](../apps/sync/src/store.ts#L81)), the pull ([apps/sync/src/store.ts:207](../apps/sync/src/store.ts#L207)). Two tests pin the isolation: "an account never sees another account's rows" and "an account's push never changes or deletes another account's rows of the same id" ([apps/sync/src/sync.test.ts:418](../apps/sync/src/sync.test.ts#L418), [apps/sync/src/sync.test.ts:426](../apps/sync/src/sync.test.ts#L426)).
- Per-account caps count tombstones: 5,000 playlists and 250,000 playlist entries ([apps/sync/src/limits.ts:15](../apps/sync/src/limits.ts#L15)), enforced in the push transaction ([apps/sync/src/store.ts:178](../apps/sync/src/store.ts#L178)). Text fields stop at 16,384 characters ([apps/sync/src/tables.ts:93](../apps/sync/src/tables.ts#L93)). Tombstones never expire ([docs/spec.md:174](spec.md#L174), [docs/spec.md:1257](spec.md#L1257)).
- Not stored on the service: playlist images ([docs/spec.md:170](spec.md#L170)) and which YT Music or Spotify playlist an import came from ([docs/spec.md:619](spec.md#L619)). A playlist's song sort syncs as a preference keyed by playlist id ([docs/spec.md:614](spec.md#L614)), so it is per account.

### Playlist model

- A playlist's id and an entry's id are random 128-bit hex strings made on the device that created the row (`lower(hex(randomblob(16)))`, [packages/client/src/db/schema.ts:380](../packages/client/src/db/schema.ts#L380); columns at lines 410 and 483). Local integer ids never leave the device ([docs/spec.md:621](spec.md#L621)).
- Order is a text key per entry, not a position. `order_key` is a base-62 fractional index that sorts as text ([packages/core/src/orderKey.ts:1](../packages/core/src/orderKey.ts#L1)). A playlist lists entries by `order_key`, then entry id ([packages/core/src/orderKey.ts:149](../packages/core/src/orderKey.ts#L149); the local index is `(playlist_id, order_key, sync_id)`, [packages/client/src/db/schema.ts:495](../packages/client/src/db/schema.ts#L495)). `orderKeyBetween(before, after)` makes a key between two neighbours ([packages/core/src/orderKey.ts:112](../packages/core/src/orderKey.ts#L112)).
- Adding or moving an entry writes that entry's row only. The exception is landing between entries that share a key, which are then re-keyed around it ([packages/core/src/orderKey.ts:180](../packages/core/src/orderKey.ts#L180)). A move in the store is one `order_key` update ([packages/client/src/db/playlists.ts:598](../packages/client/src/db/playlists.ts#L598)). Core's `moveItem` is only the array move the UI uses ([packages/core/src/playlists.ts:103](../packages/core/src/playlists.ts#L103)).
- Every synced row carries `changedAt`, `phoneId` and `deleted` ([packages/core/src/sync.ts:92](../packages/core/src/sync.ts#L92)). The device assigns `changedAt` from its own clock as `max(now, previous + 1)` ([packages/client/src/db/sync.ts:30](../packages/client/src/db/sync.ts#L30)). `phoneId` is a random id per install ([packages/client/src/db/sync.ts:17](../packages/client/src/db/sync.ts#L17)). The Worker checks only that `changedAt` is a safe integer ([apps/sync/src/tables.ts:168](../apps/sync/src/tables.ts#L168)) and never compares it with its own clock.
- The only server-assigned number is `change_no`, taken from the account's `change_seq` in the transaction that stores the row ([apps/sync/src/store.ts:167](../apps/sync/src/store.ts#L167)). It pages pulls and takes no part in deciding a conflict.
- A removal is a tombstone. A manual removal also keeps `removedAt` and the entry's fields for the Graveyard ([packages/core/src/syncWire.ts:46](../packages/core/src/syncWire.ts#L46), [packages/client/src/db/playlists.ts:501](../packages/client/src/db/playlists.ts#L501)). Deleting a playlist tombstones its live entries and then the playlist row ([packages/client/src/db/playlists.ts:1510](../packages/client/src/db/playlists.ts#L1510)).
- A playlist never holds a song twice, but the check is local and runs when a song is added, against what that device holds ([packages/client/src/db/playlists.ts:441](../packages/client/src/db/playlists.ts#L441), [packages/core/src/playlistEntries.ts:153](../packages/core/src/playlistEntries.ts#L153)).
- The local tables are `playlists` ([packages/client/src/db/schema.ts:405](../packages/client/src/db/schema.ts#L405)) and `playlist_items` ([packages/client/src/db/schema.ts:478](../packages/client/src/db/schema.ts#L478)), shared by the phone and the desktop through `packages/client`. An item holds `track_id` or `yt_song`, never both (check at line 504).

### Merge rule

`mergeRows` works per row, on the whole row, last writer wins ([packages/core/src/sync.ts:139](../packages/core/src/sync.ts#L139)). The comparison is `wins` ([packages/core/src/sync.ts:111](../packages/core/src/sync.ts#L111)):

1. the greater `changedAt` wins, by the clocks of the devices that made the changes;
2. at equal times, the greater `phoneId` compared as text;
3. for the same change, the removal.

There is no per-field merge. The Worker's upsert overwrites every column of the row with the winner's ([apps/sync/src/store.ts:75](../apps/sync/src/store.ts#L75)); the one exception is a field an older client omits, which is `songs.releaseDate` only ([apps/sync/src/tables.ts:56](../apps/sync/src/tables.ts#L56)). A tombstone is a change like any other. An older edit arriving late can't undo a removal, and an edit stamped after the removal brings the row back ([packages/core/src/sync.ts:132](../packages/core/src/sync.ts#L132); tests at [packages/core/src/sync.test.ts:198](../packages/core/src/sync.test.ts#L198) and [packages/core/src/sync.test.ts:206](../packages/core/src/sync.test.ts#L206)). The result is the same in any arrival order ([packages/core/src/sync.test.ts:223](../packages/core/src/sync.test.ts#L223)). The app applies pulled rows with the same function ([packages/client/src/db/syncRows.ts:893](../packages/client/src/db/syncRows.ts#L893)), and plays merge by id only ([packages/core/src/sync.ts:176](../packages/core/src/sync.ts#L176)).

The spec says what this assumes: "It relies on the phones' clocks. They're set by the network on Android, which is close enough for one person's phones" ([docs/spec.md:622](spec.md#L622)).

What happens today between two devices of one account:

- **Both add a track at the end.** Both compute the same key after the same last entry. The entries have different ids, so both rows survive, and they list one after the other in entry-id order, the same on both devices. Tested at [packages/core/src/orderKey.test.ts:69](../packages/core/src/orderKey.test.ts#L69). Inference: if both added the same song, the playlist ends with it twice, since `applyEntry` runs no duplicate check on a pulled row ([packages/client/src/db/syncRows.ts:982](../packages/client/src/db/syncRows.ts#L982)).
- **Both move different tracks.** Each move changed one row, so both are accepted and the order is the sort of all keys. Each key was computed from that device's view of the neighbours, so the result converges but may match neither user's intended neighbours. Two moves into the same gap produce the same key and fall back to entry-id order. Inference: I found no test of concurrent moves; the tests cover concurrent adds and an add against a rename and a removal ([packages/client/src/sync/syncCycle.test.ts:318](../packages/client/src/sync/syncCycle.test.ts#L318)).
- **Both move the same track.** One row, so the later `changedAt` wins and the other move is lost.
- **One deletes a track the other moves.** Same row. If the removal has the later stamp, the entry is gone (in the Graveyard when removed by hand). If the move has the later stamp, the entry comes back live at the moved position, because the pulled live row replaces the tombstone ([packages/client/src/db/syncRows.ts:1013](../packages/client/src/db/syncRows.ts#L1013)). Which one is "later" is a comparison of two device clocks.
- **One deletes the playlist while the other adds to it.** The deleting device tombstones the entries it knows and the playlist row. The other device's new entry is a new row the deleter never saw, and adding does not stamp the playlist row (it only sets the local `updatedAt`, [packages/client/src/db/playlists.ts:1536](../packages/client/src/db/playlists.ts#L1536)). So nothing competes with the playlist's tombstone, and the playlist stays deleted on both. Inference: the added entry remains stored as a live row under a deleted playlist, which nothing lists; I found no test for it.

### Sync protocol

- Routes ([apps/sync/src/service.ts:723](../apps/sync/src/service.ts#L723)): `POST /v1/session`, `DELETE /v1/session`, `DELETE /v1/sessions`, `POST /v1/push`, `GET /v1/pull`, `DELETE /v1/account`, `PUT` and `GET /v1/soulseek`, three Genius routes and two Ticketmaster routes.
- A push is `{ "<table>": [rows] }`, every table optional ([apps/sync/src/service.ts:158](../apps/sync/src/service.ts#L158)). One invalid row refuses the whole push. The answer is the count accepted per table ([apps/sync/src/service.ts:494](../apps/sync/src/service.ts#L494)). The client cuts pushes at 1,000 rows and 1.5 MB ([packages/core/src/syncWire.ts:313](../packages/core/src/syncWire.ts#L313)); the Worker takes bodies up to 2 MiB ([apps/sync/src/limits.ts:13](../apps/sync/src/limits.ts#L13)).
- A pull is `GET /v1/pull?since=<cursor>`. It answers up to 1,000 rows changed after that change number, across all tables in change order, with the next cursor and `more` ([apps/sync/src/service.ts:497](../apps/sync/src/service.ts#L497), [apps/sync/src/store.ts:198](../apps/sync/src/store.ts#L198)). The cursor is per account.
- One cycle pulls, settles, pushes, and pulls again after a push ([packages/client/src/sync/syncCycle.ts:241](../packages/client/src/sync/syncCycle.ts#L241)). The phone and the desktop share it.
- Timing: an edit goes up 3 seconds after the last one; the phone pulls on opening, after each push, and on return to the foreground when the last finished sync is 5 minutes old; the desktop also pulls every 15 minutes ([packages/core/src/syncTriggers.ts:8](../packages/core/src/syncTriggers.ts#L8), lines 15 and 18; [docs/spec.md:624](spec.md#L624); [apps/desktop/src/main/sync/desktopSync.ts:160](../apps/desktop/src/main/sync/desktopSync.ts#L160)).
- No push or realtime channel. The spec says "There's no background job, and Android Auto's headless start doesn't sync" ([docs/spec.md:624](spec.md#L624)). Not found: a search for WebSocket, EventSource, Firebase, FCM and Durable Objects in `apps/sync/src`, `apps/sync/wrangler.toml`, `apps/mobile/src/sync`, `packages/client/src/sync` and `apps/desktop/src/main/sync` returned nothing. The Worker's only scheduled work is the hourly maintenance ([apps/sync/wrangler.toml:40](../apps/sync/wrangler.toml#L40)).
- A session may send 120 requests a minute ([apps/sync/src/limits.ts:25](../apps/sync/src/limits.ts#L25)).

### Track identity

An entry holds exactly one of `songId` and `ytSong` ([apps/sync/src/tables.ts:59](../apps/sync/src/tables.ts#L59)).

- **Streamed (YT Music) entry.** `ytSong` is a JSON text with the video id, title, artists, album, album id, length, cover URL and explicit mark ([packages/core/src/playlistEntries.ts:285](../packages/core/src/playlistEntries.ts#L285)). It is self-contained, so any device with YT Music on can show and stream it. The video id is the identity (`yt:<videoId>`, [docs/spec.md:55](spec.md#L55)).
- **Unsearched and unavailable entries.** The same column holds title, artists, album, length and cover with a marker and no video id ([packages/core/src/playlistEntries.ts:361](../packages/core/src/playlistEntries.ts#L361)). Also self-contained; an unsearched one is resolved by a YouTube Music search on whichever device needs it ([docs/spec.md:22](spec.md#L22)).
- **Library (local file) entry.** `songId` is the recording key, and the entry carries nothing else about the song ([packages/core/src/syncWire.ts:55](../packages/core/src/syncWire.ts#L55)). The key is built from the file's tags: album title and album artist, the normalised title, and disc and track number when present ([packages/core/src/sync.ts:51](../packages/core/src/sync.ts#L51)). The song's title, credit, album, length and its YouTube video id (when it was downloaded from YouTube Music) live in the pushing account's `songs` row ([packages/core/src/syncWire.ts:18](../packages/core/src/syncWire.ts#L18)).
- Could another user's device resolve a Library entry? Not from the entry alone. On a pull, an entry whose recording key has no Track on the device waits in `sync_pending` ([packages/client/src/db/syncRows.ts:1005](../packages/client/src/db/syncRows.ts#L1005)). Within one account the `songs` row arrives too and the song shows as a missing song that can be downloaded ([docs/spec.md:625](spec.md#L625), [docs/spec.md:626](spec.md#L626)). Inference: across accounts the other user would need that `songs` row, or the metadata copied into the entry, and two users who own the same recording with different tags get different keys.
- Wave already has a way to turn a Library song into a self-contained entry. A song that leaves the Library becomes an unsearched entry holding what the Library knew of it, or a YT Music entry when it has a video id ([docs/spec.md:22](spec.md#L22), [docs/spec.md:606](spec.md#L606)).
- Metadata matching that exists: `recordingMatches` and `libraryFinder` compare a normalised title, a shared artist and a length within a few seconds ([packages/core/src/ytMusic.ts:141](../packages/core/src/ytMusic.ts#L141), [packages/core/src/ytMusic.ts:225](../packages/core/src/ytMusic.ts#L225)); the Spotify import adds edition notes and a 3-second length bound ([docs/spec.md:779](spec.md#L779)); `findRecording` breaks recording-key ties by length ([packages/core/src/sync.ts:74](../packages/core/src/sync.ts#L74)). A YT Music match found for a Library song is remembered on that phone only, never synced ([apps/mobile/src/ytmusic/ytMatchMemory.ts:5](../apps/mobile/src/ytmusic/ytMatchMemory.ts#L5)).
- No fingerprint or ISRC identity. The Spotify sources Wave reads give no ISRC ([docs/spotify-playlists.md:25](spotify-playlists.md#L25)), and the spec says songs are matched by title, artists and length ([docs/spec.md:778](spec.md#L778)). Recognize fingerprints microphone audio for Shazam and keeps nothing ([docs/spec.md:56](spec.md#L56)).

### Existing sharing

- **Share** copies a Wave playlist out to another service. It makes an unlisted playlist on the signed-in YouTube Music account, or a public one on Spotify, and opens the share sheet with that link ([docs/spec.md:479](spec.md#L479), [docs/spec.md:483](spec.md#L483), [docs/spec.md:486](spec.md#L486)). Sharing again updates the same remote playlist by diffing: remove, add, then the fewest moves ([packages/core/src/playlistShare.ts:184](../packages/core/src/playlistShare.ts#L184), line 235, `syncSharedPlaylist` at line 317). Wave's copy always wins; the remote id is remembered on that phone only, and "There's no background sync: only Share and Export update it" ([docs/spec.md:485](spec.md#L485)).
- **Export to YT Music** sends playlists as private copies and favorites as likes ([docs/spec.md:491](spec.md#L491)).
- **Import** reads a YouTube Music or Spotify playlist from a link, a share, or the signed-in library. `playlistLinks.ts` recognises the links ([packages/core/src/playlistLinks.ts:47](../packages/core/src/playlistLinks.ts#L47)). "The import is a one-time copy: the playlist doesn't follow its source afterwards" ([docs/spec.md:782](spec.md#L782)).
- Callers: `apps/mobile/src/share/sharePlaylist.tsx`, `apps/mobile/src/share/ytSharedPlaylists.ts`, `apps/mobile/src/library/ytExportRun.ts` and `apps/desktop/src/main/links/links.ts`.
- Not found: a Wave-to-Wave link, an invitation, another user's profile or any lookup of a user. `grep -i collaborat` over `apps/sync/src`, `packages/core/src`, `packages/client/src`, `apps/mobile/src`, `apps/desktop/src` and `packages/kotlin-shared/src` matches only artist collaborations. The one product mention is that the Spotify import reads the account's "private and collaborative playlists" ([docs/spec.md:761](spec.md#L761)).

### How Wave talks to YT Music

- No official API. Wave uses innertubex, the library Metrolist uses, against YouTube's internal `youtubei` endpoints ([docs/spec.md:535](spec.md#L535)). The spec records that the owner accepted this on #156 ([docs/spec.md:778](spec.md#L778)).
- Auth is anonymous or a browser session cookie. No OAuth. Signed out, requests carry only visitor data and locale ([YtClient.kt:216](../packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/yt/YtClient.kt#L216)), and "everything YT Music does also works signed out" ([docs/spec.md:584](spec.md#L584)). Signed in, the phone takes the cookie from Google's sign-in page in a web view and hands it to innertubex ([docs/spec.md:584](spec.md#L584)). Writes add `Authorization: SAPISIDHASH …` computed from the cookie ([YtPlaylistWrites.kt:188](../packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/yt/YtPlaylistWrites.kt#L188), line 230).
- Reads of the user's playlists: the account's library playlists through browse `FEmusic_liked_playlists` ([YtPages.kt:125](../packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/yt/YtPages.kt#L125), line 145), any playlist by id page by page, and Liked Songs as playlist `LM` ([docs/spec.md:587](spec.md#L587), [docs/spec.md:750](spec.md#L750)).
- Writes: `playlist/create` and `browse/edit_playlist` with add, remove, move, rename and privacy actions ([YtPlaylistWrites.kt:65](../packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/yt/YtPlaylistWrites.kt#L65), lines 137 and 149), and `like/like` ([YtLikes.kt:11](../packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/yt/YtLikes.kt#L11)). Wave writes only to playlists it made on the signed-in account. `ownPlaylist` returns null when the page lacks the editable header ([YtPlaylistWrites.kt:124](../packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/yt/YtPlaylistWrites.kt#L124), [YtOwnPlaylistParser.kt:55](../packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/yt/YtOwnPlaylistParser.kt#L55)), and Share then makes a new playlist: "one the signed-in account can't edit (another account's), is made again" ([docs/spec.md:485](spec.md#L485)).
- The desktop runs the same Kotlin client on a JVM, with `libraryPlaylists`, `ownPlaylist`, `createPlaylist` and `editPlaylist` in its protocol ([apps/desktop/src/main/kotlin/protocol.ts:17](../apps/desktop/src/main/kotlin/protocol.ts#L17), lines 25, 34 and 61). Its session comes from the installed browser's cookies, and since PR #1249 (`feat/brave-session-login`) from the default browser's existing session on Linux ([docs/spec-desktop.md:277](spec-desktop.md#L277), [docs/spec-desktop.md:291](spec-desktop.md#L291)).
- The YouTube cookie stays on the device, out of JS and out of the Wave account ([docs/spec.md:585](spec.md#L585), [docs/spec.md:619](spec.md#L619)). The sync Worker never talks to YouTube.

### Security

- The threat model names outside attackers going after what holds a credential. "The owner, the accounts with write access to the repository and the machines they work from are trusted" ([docs/spec.md:1241](spec.md#L1241)). It has no notion of one Wave user acting against another, because today an account can only reach its own rows.
- The service's defences are per address, per session and per account: address and failed-lookup limits, account and session caps, 90-day session expiry ([docs/spec.md:1245](spec.md#L1245)). Deleting an account needs a fresh Google sign-in and deletes every row with that `account_id` ([apps/sync/src/service.ts:508](../apps/sync/src/service.ts#L508), [apps/sync/src/store.ts:229](../apps/sync/src/store.ts#L229)).
- Synced history has no retention period, an accepted risk ([docs/spec.md:1257](spec.md#L1257)).
- Service logs hold no token, address or account ([docs/spec.md:1245](spec.md#L1245)), so there is no audit trail of who changed which row beyond `phone_id` on the row.
- A provider key is a secret of the sync Worker, and no APK or bundle holds a credential ([docs/spec.md:1242](spec.md#L1242)).
- Readiness for switching on the sync limits said "not ready" on 2026-11-18 ([docs/spec.md:1250](spec.md#L1250)).

### Prior discussion

Searched `gh issue list --repo LeoPerez8/wave --state all --limit 100` for playlist, share, collaborat, sync, "shared playlist", friend and profile. "collaborat" returned nothing, and no issue proposes playlists shared between Wave users. The ones that bear on it:

- #169 Wave account: sync the Library between phones; #170 Core: recording key and sync merge rules; #171 Sync service: Worker, Turso schema, sessions, push and pull; #175 Sync playlists, favorites, plays and preferences while signed in. These built everything above.
- #461 Share songs, lyrics and playlists; #483 Share a playlist on YT Music; #487 Share a playlist on Spotify; #1063 Export playlists to YT Music; #1208 Share a playlist to Spotify from the desktop (open).
- #162 Share a playlist to Wave from YT Music; #163 Import a Spotify playlist from a link or a share; #486 Import Playlists › From Spotify.
- #944 Graveyard: a playlist's songs removed by hand; #982 Deleting a song keeps it in your playlists. Both shaped entry tombstones.
- #1026 Limits on accounts; #1125 Admit ten simultaneous Wave accounts with automatic replacement; #1124 Bound retained sync records while preserving deletion behavior; #1007 Security hardening against external attackers (open).
- #1218 Reorder a playlist's songs by dragging on the desktop (open).

### Gaps for multi-user editing

1. **Identity and lookup of other users.** An account is a Google subject and an email, and the client is told only its own email ([apps/sync/src/service.ts:388](../apps/sync/src/service.ts#L388)). There is no handle, display name, user-visible id, or route that finds another account. Any invite has to pick what it exposes: an email is personal data that today never leaves its own account.
2. **Membership and permissions.** Playlist rows have no owner or member columns ([apps/sync/src/migrations.ts:63](../apps/sync/src/migrations.ts#L63)), and authorisation is a single equality on `account_id` ([apps/sync/src/store.ts:40](../apps/sync/src/store.ts#L40)). Roles, invitations, leaving and revocation do not exist. Revocation has no carrier either: a removed member's device keeps its local copy and would keep pushing.
3. **A store scoped to one account.** The primary key, the row caps, the change counter and the pull cursor are all per account ([apps/sync/src/migrations.ts:24](../apps/sync/src/migrations.ts#L24), [apps/sync/src/store.ts:167](../apps/sync/src/store.ts#L167), [apps/sync/src/store.ts:207](../apps/sync/src/store.ts#L207)). A shared playlist needs rows that several accounts can read and write, its own change sequence or a cursor per shared playlist, a rule for whose quota its entries and tombstones count against, and a rule for what `DELETE /v1/account` does to a playlist others still use ([apps/sync/src/store.ts:229](../apps/sync/src/store.ts#L229)). The service also admits only 10 accounts ([apps/sync/src/limits.ts:64](../apps/sync/src/limits.ts#L64)).
4. **Merge rule for concurrent edits to an ordered list.** Fractional keys already make concurrent adds and moves of different entries converge, so the order model can stay. What does not carry over is deciding conflicts by device clocks the service never checks ([apps/sync/src/tables.ts:168](../apps/sync/src/tables.ts#L168)); the spec defends that only for "one person's phones" ([docs/spec.md:622](spec.md#L622)). Open cases: delete against move resolved by whichever clock is ahead, whole-row overwrite when two people change different fields of one entry, duplicates when two people add the same song, an entry added to a playlist someone else deleted, and no tested behaviour for concurrent moves.
5. **Track identity across users.** YT Music, unsearched and unavailable entries travel as they are. A Library entry is a recording key whose metadata sits in the owner's `songs` table and whose value depends on the owner's tags ([packages/core/src/sync.ts:51](../packages/core/src/sync.ts#L51)). A shared playlist needs entries that carry their own metadata, plus a rule for matching them to each member's Library; `libraryFinder` and the leaving-song conversion are the existing pieces. A member without the file and with YT Music off can't play such an entry ([packages/core/src/playlistEntries.ts:193](../packages/core/src/playlistEntries.ts#L193)).
6. **Refresh and notification.** A device learns of a change only when it next pulls: on opening, after its own push, on foreground after 5 minutes, or every 15 minutes on the desktop ([docs/spec.md:624](spec.md#L624)). There is no channel from the service to a device, and nothing tells a user that someone else changed a playlist or invited them.
7. **Abuse and threat model.** The model assumes an account can only harm itself ([docs/spec.md:1241](spec.md#L1241)). A shared playlist lets a signed-in user write rows another user's app will read and render: up to 16,384 characters of text per field, including the `ytSong` JSON with a cover URL the reader's app fetches ([apps/sync/src/tables.ts:93](../apps/sync/src/tables.ts#L93), [packages/core/src/playlistEntries.ts:285](../packages/core/src/playlistEntries.ts#L285)). Limits, logging and deletion are all per account, and rows record a `phone_id` but not which account wrote them. The spec's Security section would need a second actor, a malicious or careless member, before the design is settled.
8. **YT Music as a second side.** Wave reads any playlist it can browse and writes only playlists the signed-in account owns, through undocumented endpoints with the user's cookie on the user's device ([docs/spec.md:485](spec.md#L485)). Nothing follows a remote playlist after import or share ([docs/spec.md:782](spec.md#L782)). Editing a YouTube Music playlist together with people who are not on Wave would have to run from a member's device with that member's cookie, since the Worker holds no YouTube session. Whether YouTube Music's editable header appears for a collaborator, so that `ownPlaylist` would accept the playlist, is not established by anything in this repo.

## YouTube Music collaborative playlists

All pages and files below were opened on 2026-11-20. Code is cited at a pinned commit. "Inference:" marks my reading; everything else is what the source says.

Short answer: collaboration is a real YouTube/YT Music feature, but the official Data API does not know it exists, and the only route that demonstrably reaches it is the private InnerTube API with the user's Google web session. Nothing I found proves that a non-owner collaborator can add or reorder through either route; removal as a collaborator has one 2020 report.

### 1. Product behaviour (Google help pages)

Sources:

- YouTube: "Collaborate on playlists", https://support.google.com/youtube/answer/6109639?hl=en
- YT Music: "Make or edit a playlist", desktop variant https://support.google.com/youtubemusic/answer/7205933?hl=en and Android variant https://support.google.com/youtubemusic/answer/7205933?hl=en&co=GENIE.Platform%3DAndroid

Making a playlist collaborative and inviting

- YouTube: open the playlist, share, "Select Invite collaborators", "Choose who you'd like to invite." (YouTube page)
- YT Music desktop: edit (pencil), "Select Collaborate", "Select collaborators who can add songs and videos", then "Invite collaborators to your playlist by sharing the link." So the invite is a link. (YT Music page, desktop)
- Privacy: "If your playlist isn't unlisted or public yet, you'll be asked to make it shareable before your invite is sent." A private playlist cannot be collaborative. (YouTube page; same sentence on the YT Music Android variant)

Revoking

- YouTube: "Turn on or off Collaborate. When turned off, all collaborators will be removed from the playlist." (YouTube page)
- YT Music Android: "The playlist owner can turn off sharing at any time, preventing new people from adding to the playlist." (Android variant)
- YT Music desktop has "The playlist owner can deactivate the sharing link at any time, preventing others from adding to the playlist", but in the page text it sits in the Taste match section, so I don't count it as a statement about ordinary collaborative playlists.
- Neither page says how to remove one collaborator while keeping the others. Unknown.
- A collaborator can leave: "Once you leave a playlist, you can't add new videos and you won't show up as a collaborator anymore. Even after you leave, any videos you added will stay on the playlist." (YouTube page)

What a collaborator can do

- YouTube: "If you accept an invite to collaborate on a playlist, you can add videos or remove videos that you added in the past." and "Only you and the playlist owner can remove the content you've added." (YouTube page)
- YT Music: "As a collaborator on a playlist, you can share, sort, add to, and edit the playlist." (both YT Music variants). The page does not define "sort" or "edit".
- The two pages disagree in scope: YouTube's limits a collaborator to adding and removing their own items; YT Music's one sentence is broader and vaguer. Neither says a collaborator can rename or delete the playlist, or remove someone else's item. Unknown for rename, delete and manual reorder by a collaborator.
- Attribution: "After you add a video, your profile picture will be shown on that video in the playlist." (YouTube page)

Voting (newer feature)

- "Ranked voting allows signed-in users to upvote or downvote videos in your playlist and influence the order in which they appear. Voting is anonymous and users are allowed one vote per video." Options: Everyone, Collaborators only, Off. "Collaborative playlists will turn voting on by default." (YouTube page; it also links a "playlist voting on YouTube Music" video, so the feature exists in both apps.)

Limits

- "You can add hundreds of people to your playlist and include thousands of videos or songs." (YouTube page; YT Music Android variant). No exact number for collaborators or items on either page. Unknown beyond that wording.
- "There's a limit to how many public playlists a channel can create each day across YouTube Music, YouTube main app, and the YouTube API." (YT Music page). No figure given.

YouTube vs YT Music

- The YouTube page points music users to the YT Music page ("If you're looking for YouTube Music, visit this page"). The Android YT Music variant links back to "collaborative playlists on YouTube". Inference: one underlying feature with two front ends; the playlist IDs are shared (the InnerTube code in section 3 uses ordinary `PL…` IDs).
- Taste match is a separate YT Music playlist type (auto-generated daily, "up to 10 total participants", "On your web browser, you can view and listen to playlists, but you can't create or join new ones"). It is not an editable shared list. (YT Music page, desktop)

### 2. Official API (YouTube Data API v3)

Sources: `playlists` https://developers.google.com/youtube/v3/docs/playlists , `playlists.list` https://developers.google.com/youtube/v3/docs/playlists/list , `playlists.update` https://developers.google.com/youtube/v3/docs/playlists/update , `playlistItems` https://developers.google.com/youtube/v3/docs/playlistItems , `.list` https://developers.google.com/youtube/v3/docs/playlistItems/list , `.insert` https://developers.google.com/youtube/v3/docs/playlistItems/insert , `.update` https://developers.google.com/youtube/v3/docs/playlistItems/update , `.delete` https://developers.google.com/youtube/v3/docs/playlistItems/delete , errors https://developers.google.com/youtube/v3/docs/errors , quota https://developers.google.com/youtube/v3/determine_quota_cost , revision history https://developers.google.com/youtube/v3/revision_history

No collaboration concept

- The word "collab" appears on none of those eleven pages (text search of each downloaded page, checked 2026-11-20). The `playlists` resource has `snippet`, `status.privacyStatus`, `status.podcastStatus`, `contentDetails.itemCount`, `player`, `localizations`: no collaborator list, no collaborative flag. `playlistItems` has `snippet.videoOwnerChannelId` (the video's uploader), nothing for who added the item.
- `playlists.list` `mine=true` returns "playlists owned by the authenticated user". There is no parameter for playlists the user collaborates on. A client must already know the playlist ID.

Writes by a non-owner

- No page states whether a collaborator may write. The documented failure for an unauthorized write is 403 `playlistItemsNotAccessible`: "The request is not properly authorized to insert the specified playlist item." (insert; same wording with "delete"/"update" on those pages). `playlists.update` has 403 `playlistForbidden`: "This operation is forbidden or the request is not properly authorized."
- So: unknown from the docs. Inference: the API's model is owner-only, and a collaborator's insert most likely returns `playlistItemsNotAccessible`. This needs a one-call test with a collaborator's token to settle; I did not run one.
- `manualSortRequired` (400) on insert/update: "The request attempts to set the playlist item's position, but the playlist does not use manual sorting." Inference: a collaborative playlist with voting on (the default) may be vote-sorted, so position writes could fail even for the owner. Not stated by Google.
- Other insert errors: 403 `playlistContainsMaximumNumberOfVideos` ("already contains the maximum allowed number of items", no number given), 400 `playlistOperationUnsupported`.

Reads

- `playlistItems.list` costs 1 unit; unauthorized read gives 403 `playlistItemsNotAccessible` ("not properly authorized to retrieve the specified playlist"). Inference: since a collaborative playlist must be public or unlisted (section 1), it is readable by ID like any other; the docs don't say this in terms.

Quota and scopes (checked 2026-11-20)

- `playlistItems.insert`, `.update`, `.delete`, `playlists.insert`, `.update`, `.delete`: 50 units each. `list` calls: 1 unit. (each method page; quota table)
- Default: "100 search.list calls, 100 videos.insert calls, and 10,000 units per day combined for all other endpoints." (quota page). Inference: 200 playlist writes per day for the whole API project, shared by every Wave user, unless Google grants more after an audit.
- Write scopes: `https://www.googleapis.com/auth/youtube`, `…/youtube.force-ssl`, `…/youtubepartner` (insert/update/delete pages).

Issue tracker

- Not verified. issuetracker.google.com returned only a sign-in shell to my fetch, and three web searches found no tracker entry about collaborative playlists. I can't cite the long-standing request or its status.
- The API revision history page has no entry mentioning collaboration (text search, newest entry November 16, 2026).

Terms

- API Services Terms, 3.1: clients must "only access (or attempt to access) the YouTube API Services to develop and operate your API Client(s) by the means described in the Agreement, including in accordance with the documentation". https://developers.google.com/youtube/terms/api-services-terms-of-service (page last updated 2026-11-06)
- Developer Policies, "Undocumented Services": "You must not use undocumented APIs without express permission." and "You must not reverse engineer undocumented YouTube API services". Also: must not "use YouTube API Services to create, offer, or act as a substitute for, or substantially similar service to, any YouTube Applications"; must not "separate, isolate, or modify the audio or video components"; no "background player"; and "must not … scrape YouTube Applications". https://developers.google.com/youtube/terms/developer-policies (last updated 2026-11-06)
- YouTube Terms of Service (dated December 15, 2023): you may not "access the Service using any automated means (such as robots, botnets or scrapers) except (a) in the case of public search engines … or (b) with YouTube's prior written permission", nor "access, reproduce, download, … or otherwise use any part of the Service or any Content except: (a) as expressly authorized by the Service; or (b) with prior written permission". https://www.youtube.com/static?template=terms&gl=US&hl=en
- Inference: an audio-only streaming client like Wave conflicts with the Developer Policies if it registers as an API client, and InnerTube access conflicts with the consumer Terms. Using both in one app (official OAuth client for playlists, InnerTube for streaming) puts the app's API project under the "undocumented APIs" clause.

### 3. Unofficial route (InnerTube), from source

ytmusicapi, commit `86fcd17` (main on 2026-11-20; latest release 1.12.4, 2026-11-17, https://github.com/sigma67/ytmusicapi/releases). File: https://github.com/sigma67/ytmusicapi/blob/86fcd17ee3ff0d19bc807558d4e1a637df395143/ytmusicapi/mixins/playlists.py (line anchors below are in this file). Base URL is `https://music.youtube.com/youtubei/v1/` (https://github.com/sigma67/ytmusicapi/blob/86fcd17ee3ff0d19bc807558d4e1a637df395143/ytmusicapi/constants.py#L1-L2).

| Call                                  | Endpoint                                                  | Actions                                                                                                                                                                                                                                                                                                                                                                            | Auth                             |
| ------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `get_playlist` (#L18)                 | `browse` with `browseId = "VL" + playlistId` (#L143-L145) | none                                                                                                                                                                                                                                                                                                                                                                               | none required (no `_check_auth`) |
| `create_playlist` (#L255)             | `playlist/create` (#L292)                                 | none                                                                                                                                                                                                                                                                                                                                                                               | required (#L273)                 |
| `edit_playlist` (#L322)               | `browse/edit_playlist` (#L410)                            | `ACTION_SET_PLAYLIST_NAME`, `ACTION_SET_PLAYLIST_DESCRIPTION`, `ACTION_SET_PLAYLIST_PRIVACY`, `ACTION_CREATE_COLLABORATION_INVITE_LINK`, `ACTION_SET_CLOSED_TO_CONTRIBUTIONS`, `ACTION_MOVE_VIDEO_BEFORE` (`setVideoId`, `movedSetVideoIdSuccessor`), `ACTION_ADD_PLAYLIST`, `ACTION_SET_PLAYLIST_VIDEO_ORDER`, `ACTION_SET_ADD_TO_TOP`, `ACTION_SET_ALLOW_ITEM_VOTE` (#L368-L405) | required (#L364)                 |
| `join_collaborative_playlist` (#L301) | `browse/edit_playlist` (#L317)                            | `ACTION_JOIN_COLLABORATION` with `joinCollaborationToken` (#L314)                                                                                                                                                                                                                                                                                                                  | required (#L310)                 |
| `add_playlist_items` (#L437)          | `browse/edit_playlist` (#L486)                            | `ACTION_ADD_VIDEO` (`addedVideoId`, optional `dedupeOption`), `ACTION_ADD_PLAYLIST` (#L465, #L479)                                                                                                                                                                                                                                                                                 | required (#L453)                 |
| `remove_playlist_items` (#L497)       | `browse/edit_playlist` (#L523)                            | `ACTION_REMOVE_VIDEO` (`setVideoId`, `removedVideoId`) (#L519)                                                                                                                                                                                                                                                                                                                     | required (#L506)                 |
| `delete_playlist` (#L423)             | `playlist/delete` (#L432)                                 | none                                                                                                                                                                                                                                                                                                                                                                               | required (#L430)                 |

Collaboration support in ytmusicapi

- Owner side: `edit_playlist(collaboration=True)` sends `ACTION_CREATE_COLLABORATION_INVITE_LINK` and returns the `jct` query value of the response's `collaborationInviteLink` as `joinCollaborationToken` (#L376-L377, #L413-L418). `collaboration=False` sends `ACTION_SET_CLOSED_TO_CONTRIBUTIONS`. Docstring: "Collaborators cannot interact with private playlists." (#L346). Added in PR https://github.com/sigma67/ytmusicapi/pull/879 (merged 2026-04).
- Joiner side: `join_collaborative_playlist(playlistId, joinCollaborationToken)`: "Given an invite token, join a collaborative playlist and add it to your library." Token is "`jct` in YTM's invite URL". "If you're already a collaborator, an Unauthorized server error is raised." (#L301-L320)
- Reading: "Collaborative playlists replace `author` with limited data about `collaborators`" — a text label ("by Sample Author and 1 other") and avatar URLs only, no channel IDs (#L128-L141; parser https://github.com/sigma67/ytmusicapi/blob/86fcd17ee3ff0d19bc807558d4e1a637df395143/ytmusicapi/parsers/playlists.py#L56-L65). Per-track `communityVoteStatus` is returned when voting is on. `owned` is true only when the response has the editable header (#L160).
- The live test creates a playlist with one account, enables collaboration, joins with a second account, and asserts two collaborator avatars; it never adds, removes or moves as the second account. https://github.com/sigma67/ytmusicapi/blob/86fcd17ee3ff0d19bc807558d4e1a637df395143/tests/mixins/test_playlists.py#L241-L280 . The same file notes YTM rejects edits to a new playlist "for up to ~20s after creation" and waits 15 s "for collaboration to be enabled".
- Collaborator removal: issue "It's not possible to remove items from collaborative playlists" (2020-05-18): "As a collaborator, I'd like to be able to remove items from a collaborative playlist. I'm able to do that with this change". The fix (PR 24) made the parser read `setVideoId` from each item's menu instead of only on owned playlists. https://github.com/sigma67/ytmusicapi/issues/23 , https://github.com/sigma67/ytmusicapi/pull/24 . Today `remove_playlist_items` still fails locally when items carry no `setVideoId`: "Cannot remove songs, because setVideoId is missing. Do you own this playlist?" (#L508-L511). Inference: a collaborator gets `setVideoId` only for items the server lets them remove (their own, per the help page), so removal works for those. One user report from 2020, not re-tested since.
- Collaborator add, reorder, rename: no issue, test or doc line in the repo addresses them (searched its issues and PRs for collaborative / collaboration / collaborator(s); 25 hits, the relevant ones are cited here). Unknown.
- Fragility on record: parsing collaborative playlists broke twice on server-side layout changes: https://github.com/sigma67/ytmusicapi/issues/603 (2024-06) and https://github.com/sigma67/ytmusicapi/issues/820 (2025-10, fixed by PR 821).

Auth in ytmusicapi (checked 2026-11-20)

- `_check_auth` only requires some credential, browser or OAuth (https://github.com/sigma67/ytmusicapi/blob/86fcd17ee3ff0d19bc807558d4e1a637df395143/ytmusicapi/ytmusic.py#L266-L274).
- Browser auth: request headers copied from a signed-in music.youtube.com session; the library computes a SAPISID hash and requires the `__Secure-3PAPISID` cookie. "These credentials remain valid as long as your YTMusic browser session is valid (about 2 years unless you log out)." https://github.com/sigma67/ytmusicapi/blob/86fcd17ee3ff0d19bc807558d4e1a637df395143/docs/source/setup/browser.rst
- OAuth: "As of November 2024, YouTube Music requires a Client Id and Secret for the YouTube Data API to connect to the API." It uses the TV/limited-input device flow with scope `https://www.googleapis.com/auth/youtube`. https://github.com/sigma67/ytmusicapi/blob/86fcd17ee3ff0d19bc807558d4e1a637df395143/docs/source/setup/oauth.rst
- OAuth is broken for many users: issue 813 (open since 2025-09, 41 comments), header "Recommended workaround: use browser based auth instead of oauth." Maintainer, 2026-09-01: "We had a working solution with the TV auth and Google/YTMusic team likely intentionally went ahead and restricted it. … Therefore I don't see any path forward here." https://github.com/sigma67/ytmusicapi/issues/813#issuecomment-5491110689 . The repo's own live tests still run an OAuth account, so it works for some setups; treat it as unreliable.
- Inference: for a client, the dependable InnerTube write path is the Google web session (cookies), not OAuth.

Android clients

- OuterTune, `dev` branch, commit `12f61da` (2026-02-01). Its `innertube` module posts to `browse/edit_playlist` with exactly five actions: `ACTION_ADD_VIDEO`, `ACTION_ADD_PLAYLIST`, `ACTION_MOVE_VIDEO_BEFORE`, `ACTION_REMOVE_VIDEO`, `ACTION_SET_PLAYLIST_NAME`; plus `playlist/create` and `playlist/delete`. https://github.com/OuterTune/OuterTune/blob/12f61da05f82fdb870c97dcc89c847ce29c75428/innertube/src/main/java/com/zionhuang/innertube/models/body/EditPlaylistBody.kt#L13-L46 , https://github.com/OuterTune/OuterTune/blob/12f61da05f82fdb870c97dcc89c847ce29c75428/innertube/src/main/java/com/zionhuang/innertube/InnerTube.kt#L350-L462 . No collaboration or invite-link action. A playlist is editable only if the response has the owner's header: `val editable = base?.musicEditablePlaylistDetailHeaderRenderer != null` (https://github.com/OuterTune/OuterTune/blob/12f61da05f82fdb870c97dcc89c847ce29c75428/innertube/src/main/java/com/zionhuang/innertube/YouTube.kt#L332).
- Metrolist, commit `eb54dd7` (2026-11-20). Playlist writes go through `YouTubePlaylistEdits.kt` with the `WEB_REMIX` client: create, rename, description, cover, add, add-playlist, move (`setVideoId` + successor), remove. Every write requires cookie auth (`require(innerTube.hasSapCookieAuth(session))`, line 73) and is serialised with a 500 ms gap (`PLAYLIST_EDIT_THROTTLE_MS = 500L`, line 37). https://github.com/MetrolistGroup/Metrolist/blob/eb54dd7b56c58f86b52d9ab6b2a149026194a637/shared/src/commonMain/kotlin/com/metrolist/shared/api/YouTubePlaylistEdits.kt . GitHub code search for "collab" in MetrolistGroup/Metrolist returned only credits strings and a lyrics test; in MetrolistGroup/metroproto (the submodule) nothing. No collaboration or `jct` handling found. Its low-level `innertubex` package is not in this repo's tree and I did not read it.
- InnerTune (`dev`, commit `bfba5ec`, last push 2025-11): its `innertube` module tree has no edit-playlist body file. Code search for "collab" returned nothing.
- Inference: none of the three treats a playlist the user collaborates on as editable, because they key editability on the owner-only header. Whether the server sends that header to a collaborator is unknown; ytmusicapi's `owned` flag uses the same test.

### 4. Verdict: third-party client signed in as a non-owner collaborator

| Operation            | Official Data API v3                                                                                                                                                                                                   | InnerTube (private API)                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read items           | Works by playlist ID (`playlistItems.list`, 1 unit). Inference from the public/unlisted requirement; no doc line about collaborators. Cannot discover which playlists the user collaborates on (`mine` is owner-only). | Works: `browse` `VL<id>`, no login needed for a public/unlisted list; returns collaborator label, avatars, vote status (ytmusicapi `get_playlist`).                     |
| Join via invite link | Doesn't: no method or field exists (reference pages).                                                                                                                                                                  | Works: `ACTION_JOIN_COLLABORATION` with the link's `jct` token (ytmusicapi `join_collaborative_playlist`, covered by its live test).                                    |
| Add                  | Unknown: no source settles it. Documented failure would be 403 `playlistItemsNotAccessible`.                                                                                                                           | Unknown: no source settles it. `ACTION_ADD_VIDEO` is the call; no test or report as a collaborator. Inference: likely works, since it is the web client's own endpoint. |
| Remove own item      | Unknown: same as add.                                                                                                                                                                                                  | Works per one 2020 report (ytmusicapi issue 23 / PR 24), `ACTION_REMOVE_VIDEO` with the item's `setVideoId`. Not re-verified.                                           |
| Remove others' items | Unknown. Product rule says no ("Only you and the playlist owner can remove the content you've added").                                                                                                                 | Unknown; product rule says no.                                                                                                                                          |
| Reorder              | Unknown. `manualSortRequired` applies if the list is not manually sorted.                                                                                                                                              | Unknown. `ACTION_MOVE_VIDEO_BEFORE` exists; no evidence for collaborators. Voting (on by default) changes ordering.                                                     |
| Rename / delete      | Unknown; `playlists.update` documents 403 `playlistForbidden`. Help pages give collaborators no such right.                                                                                                            | Unknown; help pages give collaborators no such right.                                                                                                                   |

Needs the user's Google login

- Every write on both routes. Official: OAuth consent with the `youtube` scope under Wave's own Google Cloud project (subject to verification and the 10,000 units/day default). InnerTube: the user's Google web session cookies (SAPISID); OAuth there is unreliable (ytmusicapi issue 813).
- Reading a public or unlisted collaborative playlist needs no login on InnerTube and only an API key on the official API (inference for the latter).

Fragile

- InnerTube response shapes change without notice; collaborative-playlist parsing broke in 2024 and 2025 (ytmusicapi issues 603, 820).
- New playlists reject edits for up to ~20 s; enabling collaboration takes seconds to settle (ytmusicapi tests).
- Collaborator identity is a display string and avatars, not IDs.
- Turning collaboration off removes all collaborators (YouTube help), so the owner can dissolve the shared store at any time.
- Voting may reorder the list or block manual positions.
- Official API: 50 units per write against a 10,000-unit project-wide day.

Terms

- InnerTube: outside what YouTube's Terms authorise ("automated means", "except as expressly authorized by the Service").
- Official API: allowed for playlist management in itself, but the Developer Policies forbid undocumented APIs, substitutes for YouTube apps, audio separation and background play, which describes the rest of Wave.

### Not verified

- Google issue tracker entry for collaborative playlists in the Data API: could not open or find it.
- Whether a collaborator's OAuth token can insert/update/delete through the Data API: docs silent, not tested.
- Whether a collaborator can add or reorder through InnerTube: no source; needs a two-account test.
- Whether the InnerTube response gives a collaborator the editable header or per-item `setVideoId` today (the 2020 report predates several layout changes).
- Exact limits (items per playlist, collaborators): help pages say only "hundreds of people" and "thousands of videos or songs".
- How an owner removes a single collaborator, and whether an old invite link can be revoked without ending collaboration.
- Metrolist's `innertubex` request layer (not in the repo tree I read); conclusions about Metrolist rest on its app-level edit class and code search.

## Concurrent edits to an ordered list

Sources were opened on 2026-11-20. "Inference:" marks my reading; everything else is what the linked page says. The last section lists what I could not open.

### What Wave has today

- Every synced row carries `id`, `changedAt` (the phone's clock), `phoneId` and `deleted` ([packages/core/src/sync.ts:92](../packages/core/src/sync.ts#L92)). `mergeRows` keeps one winner per id: the later `changedAt`, then the greater phone id, then the removal ([sync.ts:111](../packages/core/src/sync.ts#L111), [sync.ts:139](../packages/core/src/sync.ts#L139)). The whole row wins or loses; there is no per-column merge. A tombstone is a change like any other, so "an edit made after it brings the row back" ([sync.ts:133](../packages/core/src/sync.ts#L133)).
- The service runs the same function and stores what it accepts under a per-account change number ([apps/sync/src/store.ts:154](../apps/sync/src/store.ts#L154), [store.ts:171](../apps/sync/src/store.ts#L171)).
- `playlist_entries` is one row per entry with its own `id`, `playlist_id`, `order_key`, `song_id` or `yt_song`, and the primary key `(account_id, id)` ([apps/sync/src/migrations.ts:75](../apps/sync/src/migrations.ts#L75)); `removed_at` was added for the Graveyard ([migrations.ts:208](../apps/sync/src/migrations.ts#L208)).
- Order is already a fractional index: `orderKeyBetween` makes a base-62 string key between two neighbours, so "adding or moving one entry changes that entry's row only" ([packages/core/src/orderKey.ts:1](../packages/core/src/orderKey.ts#L1), [orderKey.ts:112](../packages/core/src/orderKey.ts#L112)). Two phones adding at the same place make the same key; both stay, sorted by entry id ([orderKey.ts:13](../packages/core/src/orderKey.ts#L13), [orderKey.ts:149](../packages/core/src/orderKey.ts#L149)), and `placeEntries` re-keys such a run when something is later put inside it ([orderKey.ts:180](../packages/core/src/orderKey.ts#L180)).
- Inference: this is the design Figma and Evan Wallace describe below (position key per item, last writer wins per item, id as tie-break), with tombstones added. The same track twice is two rows with two ids, so duplicates need no special handling.

### Spotify

- The Web API models a playlist as a history of snapshots: "Every time you add, remove, or move a track, your modification is applied on top of all previous modifications", and "Concurrent changes are then automatically merged into the latest playlist version" (https://developer.spotify.com/documentation/web-api/concepts/playlists). The page does not say how the merge works.
- Add: `POST /playlists/{id}/items` takes `position`, "a zero-based index"; without it items are appended; at most 100 per request; returns a new `snapshot_id` (https://developer.spotify.com/documentation/web-api/reference/add-tracks-to-playlist, the deprecated `/tracks` page; the February 2026 guide renames these endpoints to `/items`: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).
- Reorder: `PUT /playlists/{id}/items` with `range_start` ("The position of the first item to be reordered"), `insert_before` ("The position where the items should be inserted"), `range_length` (default 1) and an optional `snapshot_id` ("The playlist's snapshot ID against which you want to make the changes"). Example from the page: first item to the end of a 10-item playlist is `range_start` 0, `insert_before` 10 (https://developer.spotify.com/documentation/web-api/reference/reorder-or-replace-playlists-items). So a move is index-based and moves a contiguous range in one operation.
- Remove: `DELETE /playlists/{id}/items` takes up to 100 `{uri}` objects and an optional `snapshot_id`: "The API will validate that the specified items exist and in the specified positions and make the changes, even if more recent changes have been made to the playlist" (https://developer.spotify.com/documentation/web-api/reference/remove-items-playlist). That is the only documented statement on a stale snapshot: the change is applied anyway, not rejected. No error for an old snapshot is documented.
- Duplicates: the reference documents no `positions` field today and does not say what removing a URI does when the track appears twice. Developers on Spotify's own forum report that `positions` is ignored and every copy is removed; no Spotify employee answers in the thread (https://community.spotify.com/t5/Spotify-for-Developers/Positions-field-in-JSON-body-is-ignored-when-removing-tracks/td-p/6044424). Treat that as user reports, not documentation.
- Collaboration in the API: setting `collaborative` to true "means that anyone with the link can add to or remove a track from it"; adding or removing named collaborators is a different feature the Web API does not offer, and a playlist cannot be both collaborative and public (https://developer.spotify.com/documentation/web-api/concepts/playlists).
- Collaboration in the app: "Make any playlist Collaborative to let your friends add, remove, and reorder tracks." Inviting "generates a link that's valid for 7 days"; the owner removes a person with "Remove as collaborator" (https://support.spotify.com/us/article/collaborative-playlists/). The page gives no finer permissions.
- Storage: I found no post about playlist storage on Spotify's engineering blog (search of engineering.atspotify.com returned nothing on it). The closest first-party material is a 2013 Cassandra Summit talk by Jimmy Mårdell, then a Spotify engineer. Its slides say "Every playlist is a version controlled object", show revisions as `ADD(ix=0, track=A,B,C)`, `MOV(from=2, to=1, len=1)`, `REM(from=2, len=1)`, say "Multiple heads possible!" and "Conflict resolution – Operational Transformation", and that clients keep a "Local queue of playlist modifications" (https://www.slideshare.net/slideshow/playlists-at-spotify-cassandra-summit-london-2013/27314044). Nothing confirms this is still the design.
- Inference: Spotify is a server-ordered operation log with index-based operations transformed against concurrent ones. Offline edits queue on the client and are rebased on arrival. It needs the server.

### Apple Music

- "If you subscribe to Apple Music, you can share a playlist and collaborate on it with others. Everyone can add, remove, and reorder music and react with emoji". The owner can turn on Approve Collaborators; otherwise "anyone with the link can join the collaborative playlist". The owner can remove people or stop the collaboration (https://support.apple.com/guide/iphone/collaborate-on-a-playlist-iphcbe62053f/ios).
- Apple documents nothing about how concurrent edits are resolved. No first-party source found.
- API: `LibraryPlaylists.Attributes` lists `artwork`, `canEdit`, `dateAdded`, `description`, `hasCatalog`, `name`, `playParams`, `isPublic`, `trackTypes`, `inFavorites`; no attribute mentions collaboration (https://developer.apple.com/documentation/applemusicapi/libraryplaylists/attributes-data.dictionary). Inference: the Apple Music API does not expose collaboration state. I did not review every endpoint.

### Fractional indexing

- Figma stores each child's position as "a fraction between 0 and 1 exclusive" and inserts by taking the average of the neighbours (https://www.figma.com/blog/how-figmas-multiplayer-technology-works/). Indexes are strings in base 95 (https://www.figma.com/blog/realtime-editing-of-ordered-sequences/).
- Figma's stated drawbacks: "Index length can grow over time", "Merging new elements from multiple clients may interleave them", "Averaging between two identical indices doesn't work". Its answers: length "isn't a concern for us since we don't need to order huge numbers of elements"; interleaving "is usually fine"; and for identical indexes, "The server can avoid ever having two objects with an identical position by just generating and assigning a unique position to the second insert operation" (same post). It chose this over OT because "we didn't need to work with enormous sequences and we didn't need to avoid interleaving".
- Evan Wallace's serverless version: order is by position "using object id as a tie-breaker"; each position is a last-writer-wins value; identical positions are "unlikely to happen in practice due to the randomized jitter"; "If two peers both simultaneously insert a run of objects at the same location, the resulting objects may be interleaved", so it suits "photos in an album" and not text. It "doesn't require 'tombstones'", and objects "can be reordered any number of times without leaving any additional information behind" (https://madebyevan.com/algos/crdt-fractional-indexing/).
- The common library, `rocicorp/fractional-indexing`, is "based on Implementing Fractional Indexing by David Greenspan" with variable-length integers, and points to jitter "To minimize the likelihood of index collisions" (https://github.com/rocicorp/fractional-indexing). Inference: Wave's `orderKey.ts` uses the same key shape (head letter for integer length, base-62 digits), without jitter and with the id tie-break and local re-keying instead.
- Under concurrency. Add: both kept, order by key then id; runs may interleave. Move: one row changes; two moves of the same item resolve to one position (last writer). Delete versus move: depends on how the delete is stored (Figma drops the object; with a tombstone row it is last writer wins). Offline: nothing special, keys stay valid for any length of time. Cost: one string column. Server: optional.

### LexoRank and other ranks

- Atlassian's only first-party material I found is the Jira Data Center admin page. It calls LexoRank "a ranking system" for issues and documents rebalancing by rank length: at 128 characters a rebalance "is scheduled for the next 12 hours", at 160 it starts immediately, at 254 ranking operations that would exceed it stop; a rebalance will "evenly distribute the ranked issues and significantly reduce the rank length", and "During the rebalancing, all ranking operations execute as usual" (https://confluence.atlassian.com/adminjiraserver/managing-lexorank-938847803.html). It does not describe the algorithm or concurrent ranking. No first-party description of the algorithm found.
- Trello: the REST reference types a card's `pos` only as `oneOf [string, number]` with no description (https://developer.atlassian.com/cloud/trello/rest/api-group-cards/). No first-party description of the ordering scheme found.
- Linear: the blog entry "Scaling the Linear Sync Engine" (Tuomas Artman, 2023-06-29) is an announcement of a talk and describes no mechanism (https://linear.app/now/scaling-the-linear-sync-engine). The talk is a video I could not read. No first-party written source found; the usual claims about Linear come from third-party write-ups, which I leave out.
- Inference: a rank is a fractional index with an operational fix for key growth (rebalance). A rebalance rewrites many rows, which in a last-writer-wins store collides with any concurrent move, so it wants a server to coordinate it.

### List CRDTs

- Interleaving. Kleppmann et al.: Logoot and LSEQ assign each element an identifier "from a dense ordered set", and when two users insert at the same place "the resulting character sequence is an arbitrary interleaving of the two". RGA "does not suffer from this problem" for sequential typing but "can exhibit a lesser variant"; its inserts are anchored to the preceding element and deletes leave "a tombstone" (https://martin.kleppmann.com/papers/interleaving-papoc19.pdf). Inference: Logoot/LSEQ identifiers are fractional indexes with a replica id built in, so they share fractional indexing's interleaving.
- Fugue (Weidner and Kleppmann) defines "maximal non-interleaving" and gives list CRDTs that satisfy it (https://arxiv.org/abs/2305.00583).
- YATA / Yjs: each item stores the ids of its left and right neighbours at insert time (`origin`, `originRight`), used "when peers concurrently insert at the same location" (https://github.com/yjs/yjs/blob/main/INTERNALS.md). Deleted items stay: "We can't garbage collect deleted structs (tombstones) while ensuring a unique order of the structs", though their content can be dropped (https://github.com/yjs/yjs/blob/main/README.md). Sync is by state vector between any two peers (INTERNALS.md).
- Automerge: for concurrent inserts at one index, "arbitrarily choose one to insert first and then insert the other immediately afterwards"; a run keeps its order, except "primarily when inserting elements in reverse" (https://automerge.org/docs/reference/under-the-hood/merge-rules/). Its sync protocol runs between two peers over "a reliable in-order stream", each keeping a state per peer (https://automerge.org/automerge/automerge/sync/index.html).
- Moves. Kleppmann, PaPoC 2020: existing list CRDTs have no move; delete-and-reinsert means that "if two replicas concurrently move the same element, the result is that the element is duplicated". His fix is "a last-writer wins (LWW) register" per element "containing the position of that element", so "Moving an element to a new location is then merely a matter of updating the value of that element's register"; the set of elements is an add-wins set. Moving a range atomically is unsolved: "there is no known algorithm for performing such moves of ranges" (https://martin.kleppmann.com/papers/list-move-papoc20.pdf).
- Who ships move today:
  - Loro: yes. `MovableList` "uses the algorithm from Moving Elements in List CRDTs", and is "approximately 80% slower in encode/decode and consumes about 50% more memory" than `List` (https://github.com/loro-dev/loro-docs/blob/main/pages/docs/tutorial/list.mdx).
  - Yjs: not in the stable line. The `Y.Array` docs list `insert`, `delete`, `push`, `unshift` and no move (https://docs.yjs.dev/api/shared-types/y.array). The prerelease v14.0.0-0 "enables single-range moves in Y.Arrays", and "v13 can't read v14 updates (if content has ever been moved)" (https://github.com/yjs/yjs/releases/tag/v14.0.0-0); the releases page marks v13.6.33 as latest and v14 as release candidates (https://github.com/yjs/yjs/releases). The older PR "Experimental move feature" is still open (https://github.com/yjs/yjs/pull/357).
  - Automerge: the list docs give `push`, `unshift`, `insertAt`, `deleteAt`, `splice` and no move (https://automerge.org/docs/reference/documents/lists/), and the merge rules mention none. No first-party statement that a move exists or is planned was found.
- Under concurrency. Add: both kept; no interleaving of runs with Fugue or YATA, possible with Logoot/LSEQ. Move: duplicates the item unless the library has a real move. Delete: tombstone, delete wins over a concurrent delete; delete versus move depends on the move design. Offline: any duration, merges with any peer. Cost: per-element metadata and tombstones kept for the life of the list, a document format the library owns, a runtime dependency. Server: not needed.
- Inference: the hard parts these solve are character-level interleaving and serverless merging. A playlist has neither: items are whole rows with ids, and Wave has a server.

### Simpler server-centred designs

- Last writer wins per row or property, with a position value. Figma: the server keeps "the latest value that any client has sent for a given property on a given object", so on a conflict "the document will just end up with the last value that was sent to the server". It is deliberate: "Figma isn't using true CRDTs though. CRDTs are designed for decentralized systems where there is no single central authority ... There is some unavoidable performance and memory overhead with doing this. Since Figma is centralized (our server is the central authority), we can simplify our system". Object ids are made on the client so creation works offline. Offline: the client "downloads a fresh copy of the document, reapplies any offline edits on top of this latest state". Deletes: "Figma doesn't store any properties of deleted objects on the server"; undo restores from the deleting client's buffer (https://www.figma.com/blog/how-figmas-multiplayer-technology-works/).
- Inference on the difference from Wave: Figma's "last" is arrival order at the server, so an edit made offline days ago overwrites newer ones when the client reconnects. Wave's is the phone's `changedAt`, so the old offline edit loses, but a phone with a wrong clock can win or lose unfairly. Figma merges per property; Wave per row.
- Server-ordered operation log: Spotify above (operations against a snapshot, merged by the server). Intent survives better (a range move stays a range, runs do not interleave), at the price of operation transformation code and stored history.
- Optimistic concurrency with a version check and rebase: Spotify's optional `snapshot_id` is the documented example, and it is lenient, applying the change "even if more recent changes have been made". No first-party source found for a consumer playlist API that rejects a stale version and makes the client retry.

### Where a playlist makes the heavy approaches unnecessary

Inference, from the sources above:

- Interleaving matters for text because adjacency carries meaning. For up to a few thousand whole-row items it is a cosmetic issue, which is how Figma and Wallace treat it.
- Key growth needs thousands of inserts into one gap. Jira rebalances at 128 characters; Wave's keys are three or four characters after thousands of appends ([orderKey.ts:9](../packages/core/src/orderKey.ts#L9)).
- Kleppmann's move algorithm is a last-writer-wins position per element in an add-wins set. Rows with ids, an `order_key` column and row-level last writer wins already are that, so concurrent moves of one entry cannot duplicate it.
- Tombstones, the main storage cost of list CRDTs, are already kept per row, and the Graveyard uses them.
- Range moves are the one thing only an operation log does atomically. With per-item keys, moving ten songs is ten row changes that can each lose to someone else's later move.

### Comparison

| Approach                                                  | Concurrent add                                                        | Concurrent move                                    | Delete vs move                                | Offline for days                                            | Cost                                                      | Needs server                           |
| --------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| Fractional key + LWW per row (Figma, Wallace, Wave today) | Both kept; same-spot runs may interleave; equal keys need a tie-break | One position wins; no duplicate                    | Later change wins if deletes are tombstones   | Works; old edits lose (client clock) or win (arrival order) | One string column; tombstones if kept                     | No, but one helps (unique keys, clock) |
| Rank with rebalancing (LexoRank)                          | As above                                                              | As above                                           | As above                                      | As above; a rebalance in between rewrites keys              | Key column plus a rebalance job                           | Yes, for the rebalance                 |
| List CRDT without move (RGA, YATA/Yjs 13, Automerge)      | Both kept; runs stay together (not Logoot/LSEQ)                       | Delete + insert duplicates the item                | Delete wins; the re-insert survives as a copy | Works, any peer                                             | Per-item metadata, permanent tombstones, library format   | No                                     |
| List CRDT with move (Loro MovableList, Yjs 14 prerelease) | Both kept, no interleaving                                            | One position wins                                  | Library-defined                               | Works, any peer                                             | As above plus move metadata (Loro: about 50% more memory) | No                                     |
| Server-ordered op log with transform (Spotify)            | Both kept in server order                                             | Range moves stay whole; transformed against others | Server decides by order                       | Queue replays on reconnect, rebased                         | Op history, snapshots, transform code                     | Yes                                    |
| Version check, reject and retry                           | Second writer retries                                                 | Second writer retries                              | Second writer retries                         | Poor: a long offline queue retries one edit at a time       | Small                                                     | Yes                                    |

### Recommendation for Wave (my inference)

Keep the current model and extend it; do not adopt a CRDT library or an operation log.

- Why: `order_key` plus row-level last writer wins is the design Figma runs in production and the one Kleppmann's move paper arrives at. It gives the three guarantees a shared playlist needs: concurrent adds are both kept, two moves of one entry end in one place, and a removal is a tombstone that merges like any change. It works offline for any length of time and costs no new storage. A CRDT library would add a runtime dependency to Core, which must have none, and replace SQL rows with a library-owned document, to solve interleaving and serverless merge, which Wave does not have.
- What has to change for several editors:
  1. Scope. Entry rows are keyed by `(account_id, id)` ([migrations.ts:87](../apps/sync/src/migrations.ts#L87)); a shared playlist's rows must merge in one place for all its members.
  2. Clock. `changedAt` is each phone's clock ([sync.ts:96](../packages/core/src/sync.ts#L96)). Between one person's phones a skew is harmless; between people it decides who wins. The service can refuse or clamp a `changedAt` ahead of its own time, which keeps `mergeRows` unchanged.
  3. Same-spot runs. Two people who each append five songs offline get the same five keys, and key-then-id order alternates them one by one. Either accept it, or let the service re-key the later run after the earlier one when it accepts it, which is Figma's fix ("assigning a unique position to the second insert operation") and means the service returns changed rows to the phone that sent them.
  4. Remove versus move. Row-level merge means a move stamped after someone's removal brings the entry back ([sync.ts:135](../packages/core/src/sync.ts#L135)). That is defensible ("someone still wanted it"), and the Graveyard makes the opposite case recoverable. If the owner wants removal to win, it needs a rule in `wins` or a separate timestamp for `order_key`.
  5. The same song added by two people at once becomes two entries. That is consistent with duplicates being allowed; hiding or merging them is a product choice, not a sync one.
- Main alternative: a server-ordered operation log in Spotify's style (add, remove, move against a snapshot, transformed by the service). It keeps range moves whole, never interleaves runs and gives a history for free. It is a second sync protocol beside `mergeRows`, needs transformation code that is easy to get wrong, and loses the property that phone and service merge with the same function. Choose it if playlist history or exact intent under heavy concurrent editing becomes a product requirement.

### Not verified

- The original RGA, Logoot and LSEQ papers: HAL refused automated access (inria.hal.science, hal.science), and the RGA paper was not attempted behind its publisher. They are described here only through Kleppmann's two papers, which I read in full.
- The YATA paper itself (ResearchGate returned 403); Yjs is described from its README and INTERNALS.md.
- Linear's sync talk (video) and any first-party text on Linear's or Trello's ordering.
- The Cassandra Summit abstract page (sched.com returned 503); the talk is cited from its slides, read through the fetch tool's text extraction.
- How Spotify removes one of two copies of a track: not in the documentation; only forum reports.
- How Apple Music resolves concurrent edits, and whether any Apple Music API endpoint outside `LibraryPlaylists.Attributes` exposes collaboration.
- Whether Automerge plans a move operation: its docs show none, and an issue search by title found nothing, which is weak evidence.
- The year of Yjs v14.0.0-0 (the release page shows "18 Aug" without a year).
- Quotes from Spotify's docs and support page, both Figma posts, Wallace's page, Apple's guide, the LexoRank page, Loro's docs, Automerge's merge rules, the Yjs README and v14 release note, and the rocicorp README were checked against the raw page text. The remaining quotes (SlideShare slides, Spotify's reorder and add pages and migration guide, Yjs INTERNALS.md and `Y.Array` docs, Automerge's list and sync docs, Apple's API page, Trello, Linear, the Fugue abstract) come through the fetch tool's reader and were not re-checked character by character.

## Open questions

- Does the spec change to allow sharing between accounts, and does the 10-account limit stay?
- How does one user reach another: an invite link, an email, a handle?
- What does a member see of the others (email, name, nothing), and is an entry attributed to who added it?
- Which roles exist, and who can add, remove, reorder, rename, delete and invite?
- How does a member leave or get removed, and what happens to their device's copy and their later pushes?
- Where do a shared playlist's rows live, whose caps do they count against, and what does deleting the owner's account do to it?
- Is the service's clock used to bound `changedAt` between people?
- Does a removal beat a later move, or does the later change win as today?
- Are same-spot runs from two offline editors left interleaved or re-keyed by the service?
- Is the same song added by two people one entry or two?
- How does a Library song enter a shared playlist: as a self-contained entry matched on each member's device, or not at all?
- Does a member need YT Music on to play what others added?
- How soon must a member see another's change: next pull, a shorter poll, or a push channel?
- Is a user told about an invite or a change, and how?
- What does the threat model say about a malicious or careless member?
- Is YouTube Music in scope, and as what: a store Wave edits in place, a mirror of a Wave playlist, or left out? The two-account InnerTube test comes first.
