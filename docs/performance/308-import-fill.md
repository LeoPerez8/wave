# #308 Keep the app responsive while an imported playlist fills: work per batch given

Ticket: #308 (parent #301). Branch `feat/308-import-fill`, based on `perf/301-performance` at
c9fa645.

## What changed

An import gives its playlist the songs found about once a second (`give` in
`apps/mobile/src/library/playlistImports.ts`). Before, each batch:

- **Append** (`appendPlaylistSongs`, `apps/mobile/src/library/db/playlists.ts`) read every entry of
  the filling playlist and JSON-parsed every stored YT Music song in it to check for duplicates,
  then read every order key to find the last one.
- **Library › Playlists**, when in sight, read every playlist's mosaic (window functions over every
  entry of every playlist) and totals (every stored YT Music song of every playlist pulled into
  JavaScript and parsed), at most every 1.5 s.
- **The filling playlist's page**, when in sight, parsed every stored song twice: once for its
  entries, once for its totals.
- The page's import line and the notification redrew for every search answered, and the line also
  for every search asked.

Now:

- **Append** asks SQLite which of the batch's songs the playlist holds (track ids, and video ids
  read with `json_extract`). Only those candidate rows are decoded, to check they're readable as
  before. The new order keys come from the last entry alone; at the end, `placeEntries` only uses
  that one.
- **Revisions** (migration **0022**, `playlist_revisions`): SQLite triggers raise a counter per
  playlist on every write to its entries that can change its mosaic or totals: insert, delete
  (including the cascade when a song leaves the Library), and updates of `playlist_id`, `track_id`,
  `yt_song`, `order_key`, `sync_id` or `deleted`. Row 0 is the Library's. It goes up when a
  track's length or album, an album's cover or a cover's files change. Updates of `pushed` or the
  stamps alone don't raise it, so joining an account recomputes nothing. Triggers catch every
  writer: this phone's edits, sync pulls, links to downloads, signing out.
- **Summary cache** (`playlistSummaries`): Library › Playlists and the page keep each playlist's
  mosaic and totals with the revisions they were worked out at. A read works out again only the
  playlists whose revision (or the Library's) moved. It holds one entry per live playlist and drops
  deleted ones. The page counts its totals from the entries it just read (same rules, see below)
  and shares the result with the list.
- **Mosaic of one playlist** (`walkCovers`): reads entries from the top, 16, then 64, then 256…,
  until four different covers turn up. Before, the window query read the whole playlist. The
  window query is still used when more than four playlists are stale (the first read).
- **Totals in SQL**: `selectPlaylistTotals` checks a stored song's readability in SQLite
  (`READABLE_YT_SONG`, the same checks as Core's `readPlaylistYtSong`) and sums its length there.
  A test runs both over 17 well-formed and malformed stored songs.
- **Page entries** (`streamedSongs`): reading a playlist whole again only decodes the YT Music
  entries added or changed since (by entry id and `changed_at`). One playlist's songs are kept, the
  ones its page shows anyway. An entry that became a Library song drops out of it, so signing out
  (unstamped) still reads fresh.
- **Paced import line and notification**: Core's `importProgressOnly` tells progress (songs found
  and given, searches asked, refused, paused) from anything else. Progress reaches the page and the
  notification at most once a second (`IMPORT_PROGRESS_SHOWN_EVERY_MS`). An import queued,
  cancelled, stopped, done or tried again shows at once. The import itself still runs on the
  unpaced value.
- `playlistsChanged` doesn't tidy deleted playlists' images for bursts (additions delete nothing).

Changes already carried the playlist's id and `burst` (#309), so a batch reaches only the filling
playlist's page, Library › Playlists and the Library counts. Hidden ones wait (#309's registry).

## What was measured

### Desktop benchmark

`apps/mobile/bench/playlistFill.ts` builds a Library in sql.js with the real migrations: 1,500
tracks, and four other playlists (2,500 and 2,500 streamed entries, 500 streamed + 500 Library,
50 Library). Then it fills a new playlist in batches of 20 (18 streamed songs, 2 Library songs,
some already in). At 500, 1,500 and 3,000 entries it measures, after each batch, the append, a
Library › Playlists read, a page read and an unchanged list read. It counts statements, rows
returned and `JSON.parse` calls (stored songs decoded). Times are medians of 7 runs.

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/playlistFill.ts [--quick]
# against c9fa645's db modules:
git archive c9fa645 apps/mobile/src/library/db | tar -x -C apps/mobile/.bench-base
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/playlistFill.ts \
  --db apps/mobile/.bench-base/apps/mobile/src/library/db
```

**Desktop numbers** (Node v24.19.0, win32-x64, sql.js: SQLite in WebAssembly, V8's JSON.parse),
not phone timings. Results: [`results/308-playlist-fill-desktop-before.jsonl`](results/308-playlist-fill-desktop-before.jsonl),
[`results/308-playlist-fill-desktop-after.jsonl`](results/308-playlist-fill-desktop-after.jsonl).

| Step, filling playlist at 3,012 entries   | Before ms | After ms | Rows returned before → after | Decoded before → after |
| ----------------------------------------- | --------: | -------: | ---------------------------: | ---------------------: |
| Append a batch                            |      11.3 |      7.4 |                    6,061 → 4 |              2,880 → 0 |
| Library › Playlists after a batch         |      98.0 |     17.2 |                   8,570 → 28 |              8,542 → 0 |
| Library › Playlists, nothing changed      |     111.1 |      0.1 |                   8,840 → 11 |              8,812 → 0 |
| The filling playlist's page after a batch |      47.9 |      6.5 |                6,678 → 3,527 |             6,372 → 18 |

At 500 and 1,500 entries the list after a batch went from 70.7 to 4.2 ms and from 85.7 to 9.0 ms,
the page from 13.1 to 3.2 ms and from 29.0 to 5.3 ms. The append grows with the playlist only in
SQLite (the duplicate check scans the playlist's stored video ids), not in JavaScript.

What's left in the list after a batch is the filling playlist's own totals: 17.1 ms at 3,000
entries, in SQL.

### On the phone

**Pending.** No phone was attached (`adb devices` empty), and the change has no native part, so
no APK was built. The perf build now reports `playlistWork.*` with each flush, and
`import.progressShown`. The runner copies them to each step (`playlistWork`,
`importProgress.progressShown`, README "Instrumentation for later tickets"). New render counts:
PlaylistsList, PlaylistScreen, PlaylistImportLine. To measure, build a perf APK from c9fa645 and
one from this branch, set `importLink` in `scripts/perf/fixture.json` (a playlist of 2,000+ songs;
a Spotify one exercises the search pacing), then:

```sh
node scripts/perf/perf.ts run --scenario import,tab-switch,push-library,search-first-tap,now-playing \
  --variant import --label 308-before
node scripts/perf/perf.ts run --scenario import,tab-switch,push-library,search-first-tap,now-playing \
  --variant import --label 308-after
node scripts/perf/perf.ts compare <before> <after>
```

Compare `during-import` frames and long tasks, and the navigation latencies in the import variant.
From the `playlistWork` counters (after build only), `decoded.unrelated` and
`summarized.unrelated` should stay at their first-read values while the import runs. Delete the
imported playlist between runs.

## Behavior kept

- Duplicate prevention: same results as before for Library and YT Music songs, songs given twice,
  unreadable stored songs (not counted as held) and removed entries (a song removed can be added
  again). Order: appended after the last entry, past tied keys and tombstones.
- Counts, lengths and mosaics stay correct after an addition, a removal, a YT Music entry becoming
  a Library song (download link), a Library song's new length, an album's new cover, a cover's new
  file, a song leaving the Library (cascade), entries pulled from the Wave account, and an upgrade
  through migration 0022 (`playlistSummaries.test.ts`). The page and the list count alike.
- Tombstones: untouched. Nothing deletes or skips them beyond what `live` did.
- `selectPlaylistCovers` and `selectPlaylistTotals` keep their results and signatures. They now also
  take a list of ids.
- Tests: `node --test` in `packages/core` (1,793 pass), the app's tests (305 pass), the runner's
  (48 pass). The app, Core and `scripts/perf` typecheck.

## Not measured, and limits

- Device numbers: pending (above).
- Totals in SQL vs JavaScript: on the desktop, SQL totals for the 3,000-entry playlist take
  17.1 ms against 6.9 ms with V8's JSON.parse. The SQL path was kept because, on the phone, the
  JavaScript path also moves every stored song across JSI into Hermes, whose JSON.parse is slower
  than V8's, while expo-sqlite's SQLite is native, not WebAssembly. That reasoning is
  **unverified**; the phone run should settle it.
- The page's entries still come from one ordered read of the whole playlist (ids and stamps) plus
  its Library songs (`playlistTracks`), every 1.5 s while in sight. Paging the page's list is
  #310's kind of work.
- Not changed, still per batch or per change:
  - Search's index follows `playlistsVersion`, so while Search is in focus during an import it
    rebuilds every 3 s, re-reading every Library source. That's #306's per-source refresh.
  - `WaveSync.changed` follows every playlist change (3 s debounce).
  - The imports' persistence is a 1 s debounce, re-armed for every answer (#307 note, for #315).
- `linkPlaylistEntries` (a download landing, a scan's end) still decodes every stored YT Music
  song of every playlist to match them. That runs on downloads, not on import batches.
- The summary cache must not be read inside a write transaction that rolls back. The revision
  would return to a value the cache already holds for the rolled-back state. Nothing does this
  today: the list and page reads don't run in transactions.
- Migration slot: **0022** (`0022_playlist_revisions`). #312 may also add one; whichever merges
  second renumbers.
