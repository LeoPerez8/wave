# #310 Paged Songs list: opening Library › Songs without every Track's details

Ticket: #310 (parent #301). Branch `feat/310-paged-songs`, based on `perf/301-performance` at
c9fa645 (#309 merged).

## What changed

Before, opening Library › Songs read every Track as a full `SongRow` (`listSongs`: 21 columns
plus two correlated subqueries per row), sorted all of them again in JavaScript (`sortSongs`)
and kept the whole array for Play, Shuffle, the spine and selection. The list was virtualized,
so only the rows on screen were mounted, but every row's details still reached JavaScript.

Now the screen reads:

1. **The order** (`listSongOrder(sort)`, shared query `songOrder:<key>:<dir>` with reads
   `{ tracks: true }`): every Track id in the chosen sort, its spine letter and whether it has a
   file. SQLite runs the sort. Core's `songOrderTerms` gives the `ORDER BY`: the order
   `sortSongs` gives, ending on the Track id, so the order is total and stable. The whole
   order crosses into JavaScript as one `group_concat` string (`"12:a,-7:b,…"`, a missing song's
   id negated), not as 10,000 row objects. That needs SQLite 3.44 or later; expo-sqlite bundles
   3.53.
2. **The rows near the screen** (`songSummaries(ids)`): id, title, artist credit, duration,
   thumbnail and whether the song has a file, read 50 at a time by Core's `createPagedRows`. It
   reads the pages on screen plus one each way, keeps three each way and drops the rest (at most
   9 pages, 450 rows, held). Rows are filed by Track id, never by position.
3. **Full rows only when an action needs them**:
   - Play, Shuffle and a tap (`playTrackIds`) skip the missing songs in the order and read the
     queue's rows (`songsByIds`) for every song that plays, on screen or not. A tapped missing
     song downloads, as before.
   - The row menu (`openTrackActionsById`) reads its song when it opens.
   - Selecting (`songsWithIds`) reads the full rows of the checked songs and of the rows near the
     screen, so checking a visible row updates the bar at once. Select All reads every song.
     Until the rows are read, the list's selection target is `null` and the selection bar waits.
     It never acts on part of the selection.

`listSongs`, `useSongs` and the shared `songs` query are unchanged. Search's index (#306) reads
that query, and Library long-press queueing (`librarySectionSongs`) reads `listSongs`. Other
lists (an artist's, a genre's, Favorites) still use `TrackList` with full rows.

## Desktop benchmark

`apps/mobile/bench/songsList.ts` builds a 10,000-Track Library in an in-memory sql.js database
with the real migrations (`addLibrary` in `testDatabase.ts`). It has 400 artists, 1,000 albums
with covers, titles spread over the alphabet, track numbers, and one missing song in fifty. The
bench measures each read's median time over 21 runs. It also measures the JavaScript heap the
read allocates, garbage included (the young generation is enlarged so no GC runs during one
read), and what its result retains once collected.

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/songsList.ts [--quick] [--tracks=10000]
```

**These are desktop numbers** (Node v24.19.0, win32-x64, sql.js 3.49 compiled to WebAssembly,
V8). They are not phone timings: the phone runs native SQLite 3.53, Hermes and expo-sqlite's
JSI row conversion. Results file:
[`results/310-songs-list-desktop.jsonl`](results/310-songs-list-desktop.jsonl).

### Opening Songs: the reads before the first rows

Before means `listSongs`, then `sortSongs` in the sort. After means `listSongOrder` plus
`songSummaries` for the first 50 ids.

| Sort               | Before ms | After ms | Before allocated | After allocated | Before retained | After retained |
| ------------------ | --------: | -------: | ---------------: | --------------: | --------------: | -------------: |
| Song name, A to Z  |     121.8 |     20.1 |         107.4 MB |          1.5 MB |         12.2 MB |          95 kB |
| Song name, Z to A  |     123.0 |     22.4 |         107.2 MB |          1.4 MB |         12.2 MB |          95 kB |
| Artist, A to Z     |     132.7 |     21.8 |         107.5 MB |          1.5 MB |         12.2 MB |          98 kB |
| Artist, Z to A     |     134.1 |     24.4 |         107.4 MB |          1.5 MB |         12.2 MB |          95 kB |
| Album, A to Z      |     133.2 |     20.3 |         107.3 MB |          1.5 MB |         12.2 MB |          95 kB |
| Album, Z to A      |     129.7 |    59.5¹ |         107.4 MB |          1.5 MB |         12.2 MB |          90 kB |
| Date added, newest |    209.4¹ |     15.8 |         106.6 MB |          0.9 MB |         12.2 MB |          93 kB |
| Date added, oldest |     124.5 |     10.4 |         107.3 MB |          0.9 MB |         12.2 MB |          93 kB |

¹ Outliers from machine noise: the order read alone took 21.4 ms for Album Z to A and the next
sort's before took 124.5 ms.

Opening Songs now does about a sixth of the read time and allocates about 1/70 of the
JavaScript heap. It retains about 95 kB instead of 12.2 MB: the ids, the spine and one page of
summaries, not 10,000 full rows. React no longer gets a 10,000-row array either. Before,
`useSortedSongs` copied and sorted it, and `useListSelection`, the spine keys and `ListIntro`
each mapped over it on every new result. None of that is in these numbers.

An earlier version of the order read returned one row object per Track: 31 ms and 21.7 MB
allocated for Song name A to Z. Returning the order as one string cut the allocation to 1.2 MB.

### Browsing, and actions over the whole list

| Read                                                      |   Median ms | Allocated | Retained |
| --------------------------------------------------------- | ----------: | --------: | -------: |
| One page (50 summaries, rows 5,000 to 5,049)              |         1.0 |    367 kB |    13 kB |
| Scroll the whole list, a screen (15 rows) at a time       | 371.7 (98)² |   91.2 MB |      ~0³ |
| Play or Shuffle the whole list (9,800 playable full rows) |       146.3 |  113.6 MB |  12.0 MB |
| Select All (10,000 full rows)                             |       126.5 |  117.5 MB |  12.2 MB |

² The scroll's 200 page reads (10,000 rows read once each, at most 300 held) took 371.7 ms in
the full run and 98.2 ms in a `--quick` run of the same code. The difference is noise. Per page,
expect about 1 to 2 ms, spread over the time the scroll takes.

³ Nothing is held once the scroll's paged rows are dropped. While the list is open, at most 450
summaries are held.

What moved: Play, Shuffle and a tap on a row now read the queue's rows when pressed, about what
opening Songs used to cost. Before, that cost came at every opening and every re-read during a
scan (at most every 1.5 s while visible, #309). Now it comes only when something plays. The queue
gets its tracks' rows, as before, for every song in the list, on screen or not. A lighter queue
projection (`toQueueTrack` needs 7 columns, not the 21 plus two subqueries `songsByIds` reads)
would cut this. It is left for a later ticket.

### Indexes: none added

The order's plan is `SCAN tracks`, `SEARCH artists/albums USING INTEGER PRIMARY KEY`, `USE TEMP
B-TREE FOR group_concat(ORDER BY)`. SQLite sorts an aggregate's `ORDER BY` itself, whatever
indexes exist. Two alternatives were measured on the same 10,000 Tracks (desktop):

- An ordered subquery under `group_concat` uses `tracks_title_sort_idx` for the first term (then
  a temp B-tree for the four tie terms). It took 14.8 ms against 15.9 ms. That is a 1 ms
  saving, and SQLite doesn't guarantee that order for an aggregate.
- An index on `tracks(added_at)` for the date sorts took 11.7 ms against 10.2 ms without it.

The ties of every sort but date added reach into `artists.sort` and `albums.title_sort`, which no
`tracks` index can cover. So there is **no migration** in this ticket, and no migration slot is
taken (#312 and #308 can use idx 22).

## Behavior kept

- **Every sort**: `apps/mobile/src/library/db/songOrder.test.ts` checks, for all eight sorts on a
  Library built to hit every tie (one title by several artists, two albums of one name, discs and
  track numbers with gaps, songs added together, missing songs, articles, accents), that the
  order equals the old path's: `trackQuery` ordered `BY_TITLE`, then `sortSongs`. It checks the
  spine entries too (`spineEntries(songSpineKeys(...))`) and the missing songs. Mutations caught:
  the disc and the album id dropped from the ties, the file swapped for the title, and nulls not
  replaced. Core's `songOrder.test.ts` checks the terms against `sortSongs` under SQLite's
  `ORDER BY` semantics.
- **Collation**: SQLite compares text by code point and `sortSongs` by UTF-16 unit. They differ
  only between characters past U+FFFF (emoji, rare CJK) and characters from U+E000 to U+FFFF, at
  the same place in two sort keys. In that case the list follows SQLite's order.
- **Exact count**: the intro line counts `order.ids`, every Track.
- **A–Z jumps**: the spine comes from the order's letters, computed by the same Core
  `spineEntries`. A jump scrolls to the row's index. A row whose page isn't read yet shows a
  placeholder (`Loading song` to screen readers) until it arrives.
- **Current Track and favorites**: rows read the playing id and `useFavoriteIds` as before.
- **Selection**: keys are Track ids, as before. Select All selects the whole order. The bar acts
  on the checked songs in list order once their full rows are read, never on part of them.
- **Stale pages, duplicates, missing rows**: Core's `pagedRows.test.ts` checks that each place
  shows its own key's row after a new order (a scan adding a song first, a deletion), and that
  the rows on screen are read again. A read that started before a new order can't overwrite the
  new order's rows. A key the read no longer finds stays a placeholder and isn't asked again
  until the order changes. A failed read is asked again on the next move, not in a loop. Rows
  far from the screen are dropped. Every change to the tracks re-reads the order (scan batches
  throttled to 1.5 s in sight and paused while hidden, as for every #309 query), and each new
  order re-reads the pages on screen. A sort change shows the previous order until the new one
  is read, then reads its pages. Scan batches still don't carry Track ids (#309), so every change
  re-reads the whole order. It is cheap enough that per-id invalidation wasn't needed.
- **Unchanged consumers**: `listSongs`, `useSongs` and `TrackList` are untouched.

Full suites at the head of this branch: Core 1,805 tests, apps/mobile 290 tests, `scripts/perf`
47 tests, all passing. `tsc --noEmit` passes for Core and apps/mobile. `scripts/perf` can't be
typechecked in this checkout (no `@types/node` at the root).

## Release runner: `push-tracklist` waits for the first rows

`push-tracklist`'s push now expects `songs.rows`, marked on the frame after Library › Songs first
shows rows. So `responseMs` covers the tap, the navigation and the reads behind the first rows,
which is the ticket's first usable frame. The mark was added to the old list in its own commit
(385d304), so a build of that commit is the before and the branch head is the after.

## Not measured: Android

**Pending.** No phone was attached (`adb devices` listed none), so there are no release
timings, frame or memory numbers, before or after. To take them, with a Library of about
10,000 Tracks on the S24+:

1. Perf builds (`EXPO_PUBLIC_WAVE_PERF=1`) of 385d304 (before: old list with the mark) and of
   this branch's head (after).
2. `node scripts/perf/perf.ts run --scenario push-tracklist,push-library --label 310-before` on
   the first, `--label 310-after` on the second, then `perf.ts compare`. `push-library` is the
   navigation control. Compare `push-tracklist/idle/push`: first frame, response (`songs.rows`),
   frames, and the flush's JS heap. The after build's flush meta also has `songPages` (reads, rows
   read, stale rows, rows held).
3. Scrolling: `--scenario scroll-songs` (flings up and down on Library › Songs, from the
   integration branch's glass scenarios) on both builds; compare frame totals and the histogram.
   The runner has no spine-drag step: drag the spine by hand and check how often placeholders
   show.
4. Retained memory: `dumpsys meminfo` after opening Songs and going back, both builds.

Other lists (an artist's or a genre's songs, Favorites, playlists) still read full rows. Measure
them on the phone before paging them too: they are usually far shorter than the whole Library.
