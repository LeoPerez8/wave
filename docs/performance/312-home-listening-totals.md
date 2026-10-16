# #312 Home listening summaries: all-time totals kept as plays are written

Ticket: #312 (parent #301). Branch `feat/312-home-listening-totals`, based on `perf/301-performance`
at c9fa645, merged with it at 2a52cd7 (#305, #308, #310).

## What changed

Before, every Home refresh after a play aggregated the whole play history:

- Recently Played grouped every play by album (`play_events ⋈ tracks GROUP BY album`).
- Most Played grouped every counted play by song.
- The listening overview read every played song's listening (`songListening`: every credit link of
  every played song, then every play grouped by song) to sum three numbers.
- Most played albums and Most played artists each summed every counted play
  (`creditedPlayTotals` for all time), on every return to Home (`useFocusEffect`) and after every
  play while Home was focused.
- One `home` query read all four sections, so a star re-read the play sections and a play re-read
  Recently Added and Favorites.

After:

- **Migration `0023_play_totals`** adds `play_totals`, one row per played track: its plays,
  counted plays, time listened (all plays and counted plays), latest play, latest counted play, and
  the album a deleted track's counted plays kept. The migration sums it from `play_events` once.
  Four triggers on `play_events` then keep it:
  - An insert adds the play.
  - An update that only grows a play (listened longer, counted now, an album kept, same track,
    same or later start) adds the difference. This covers `updatePlay`/`endPlay` and
    `deleteTracks` setting `album_id`.
  - Any other update of `track_id`, `started_at`, `listened_ms`, `counted` or `album_id`, and any
    deletion, sums the touched tracks again from their plays (through `play_events_track_idx`).
  - Updates of `pushed`, `sync_id`, `recording_key` and `ongoing` fire nothing.

  Because the totals follow the rows, every writer is covered without changes: `recordPlay`,
  `updatePlay`, `endPlay`, crossfade overlaps, BlackPlayer imports, pulled and pending sync plays,
  and `deleteTracks`. `keyTracks` and `identifyImportedPlays` only set keys and sync ids, which fire
  nothing. A pulled play the phone already holds is
  never inserted again, so a replayed pull adds nothing; a play rewritten with the same values adds
  nothing.

- **Reads.** Most Played walks `play_totals_counted_idx` in order and stops at 10 songs. Recently
  Played reads played songs by latest play through `play_totals_last_played_idx`, 48 at a time, then
  4 times more, until Core's new `recentlyPlayedAlbums` can settle 12 albums. The overview reads one
  row of sums (`listeningSums`, read into totals by Core's new `summedListeningTotals`). All-time
  `creditedPlayTotals` reads the totals; only a track with a counted play stamped after now
  (another phone's clock ahead) has its plays summed again, so the all-time window still ends now.
- **Credited totals' primary artist.** `creditedPlayTotals` decided each row's primary artist with a
  correlated subquery over the materialized credits. Once the plays came from `play_totals`, that
  subquery was most of what was left: at 10,000 songs on 1,000 albums, 364 ms of the statement
  against 33 ms without it (desktop). A `firsts` CTE now takes each song's lowest credited position
  once. The rule is the same, and Stats' rolling windows, which share the statement, get it too.
  `stats.test.ts`'s literal tests (compilations, collaborations, a deleted collaboration whose
  primary artist left) fail when the rule is changed to "position 0".
- **Reconciliation.** `playTotalsDrift(db)` lists the tracks whose totals differ from their
  history, and `rebuildPlayTotals(db)` sums them all again with the migration's statement. Both read
  the whole history and are for checks and repair, not screens.
- **Refresh.** Home's sections are three shared queries over what changes each: `home:added`
  (tracks), `home:plays` (tracks, plays) and `home:favorites` (tracks, favorites). The overview is
  Library's shared counts plus `listeningSums` (tracks, plays). Most played albums and artists are
  one shared query, `home:mostPlayedOfAllTime` (tracks, plays), which reads the credited totals
  once for both. #309's registry does the rest: plays are bursts, so in sight these re-read at most
  every 1.5 s, and hidden they re-read once when Home is shown again. Returning to Home no longer
  re-reads the rankings when nothing changed.
- Most Played breaks ties on plays and latest counted play by song, the latest added first.
  c9fa645 left that order to SQLite. Recently Played breaks ties by album the same way.

## What was measured

`apps/mobile/bench/homeTotals.ts` builds Libraries in an in-memory sql.js database with the real
migrations. Each artist added has 1,000 songs on 100 albums and 10,000 counted plays, one in ten
of songs since deleted (`addHistory`). It measures each read before and after at 1, 10 and 30
artists, and checks with `assert.deepEqual` that both give the same result. "Before" is c9fa645's
SQL, kept in the bench, with the tie-breaks above added. `addHistory` gives every artist's plays the
same times, so ties are everywhere in this fixture. A second Library puts each artist's songs on a
single album (10 albums), Recently Played's worst case: the shelf can't fill, so it reads every
played song, page by page.

It then measures what the triggers cost on two equal Libraries (10,000 songs, 100,000 plays), one
with its triggers dropped: a play as the player writes it (`recordPlay`, `updatePlay` that makes it
counted, `endPlay`), and a BlackPlayer import of 18,000 plays. Last, it times migration 0023 on a
database as 0022 left it, with 100,000 plays.

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/homeTotals.ts [--quick]
```

Times are the median of 41 runs after a warm-up (3 runs for imports). CPU is process CPU over the
runs divided by the runs, because Windows counts CPU in 15.6 ms ticks.

**These are desktop numbers** (Node v24.19.0, win32-x64, sql.js with SQLite 3.49.1 compiled to
WebAssembly), not phone timings. Results file, with every statement's plan:
[`results/312-home-totals-desktop.jsonl`](results/312-home-totals-desktop.jsonl).

### Reads (desktop)

Songs on 100 albums per 1,000 songs. "Rows" are the rows the statements returned, not the rows
SQLite read.

| Library                     | Read                     | Before: statements / rows / ms / CPU ms | After: statements / rows / ms / CPU ms |
| --------------------------- | ------------------------ | --------------------------------------: | -------------------------------------: |
| 1,000 songs, 10,000 plays   | Recently + Most Played   |                  3 / 34 / 15.85 / 12.95 |                   3 / 70 / 1.23 / 1.15 |
|                             | Overview listening       |                 2 / 1,820 / 8.17 / 8.00 |                    1 / 1 / 0.21 / 0.00 |
|                             | All-time credited totals |                    1 / 90 / 9.84 / 8.76 |                   1 / 90 / 3.12 / 3.05 |
|                             | **Refresh after a play** |             11 / 2,059 / 127.41 / 78.12 |                 5 / 161 / 10.43 / 9.90 |
| 10,000 songs, 100,000 plays | Recently + Most Played   |                3 / 34 / 159.16 / 144.44 |                   3 / 70 / 1.19 / 1.15 |
|                             | Overview listening       |              2 / 18,200 / 92.41 / 83.07 |                    1 / 1 / 2.56 / 1.93 |
|                             | All-time credited totals |               1 / 900 / 361.46 / 338.41 |                1 / 900 / 35.83 / 27.44 |
|                             | **Refresh after a play** |           11 / 20,059 / 977.96 / 918.07 |                5 / 971 / 38.20 / 36.98 |
| 30,000 songs, 300,000 plays | Recently + Most Played   |                3 / 34 / 492.40 / 463.80 |                   3 / 70 / 1.24 / 1.15 |
|                             | Overview listening       |            2 / 54,600 / 271.12 / 248.85 |                    1 / 1 / 9.42 / 9.54 |
|                             | All-time credited totals |         1 / 2,700 / 2,831.30 / 2,661.59 |            1 / 2,700 / 104.10 / 100.98 |
|                             | **Refresh after a play** |       11 / 60,059 / 6,548.87 / 6,217.24 |            5 / 2,771 / 117.71 / 111.66 |

"Refresh after a play" is everything Home re-read for one play while in sight. Before: the four
sections, the counts, every song's listening and the credited totals once per ranking section (11
statements). After: the play sections, the listening sums and the credited totals once for both
rankings (5 statements). Recently Added, Favorites and the counts aren't re-read for a play any
more. They're shared with other screens and re-read for their own changes.

Recently Played's worst case, 10,000 songs on 10 albums with 100,000 plays: the shelf can't fill,
so it reads every played song in pages of 48, 192, 768, 3,072 and 12,288. Recently + Most Played
took 7 statements, 13,100 rows and 26.67 ms (before: 3 statements, 516.92 ms). The whole refresh
took 41.80 ms (before: 392.53 ms).

What still grows with the Library after the change: the overview's sums read every `play_totals`
row (2.56 ms at 9,100 played songs, 9.42 ms at 27,300), and the credited totals join every credit
link and group by album and artist (35.83 ms and 104.10 ms). Neither grows with the number of plays.
Recently + Most Played stay at about 1.2 ms at every size.

### Writes and the upgrade (desktop, 10,000 songs, 100,000 plays)

| Write                                                   | With triggers, median ms | Without, median ms |
| ------------------------------------------------------- | -----------------------: | -----------------: |
| A play: `recordPlay`, `updatePlay` (counted), `endPlay` |                     6.00 |               5.75 |
| BlackPlayer import of 18,000 plays (3 runs)             |                 1,322.06 |           1,184.61 |

A play's three writes cost the same within noise. A large import cost about 12% more here (26% in
an earlier `--quick` run with 2 samples). Migration 0023 summed 100,000 plays into 9,100 rows in
218 ms, once, at the first launch after the update.

## Behavior kept

`apps/mobile/src/library/db/playTotals.test.ts`:

- The listening sums of plays as the player writes them (a play that grows into a counted one, a
  skip, a deleted song) match literal values, and are zero with nothing played.
- After a crossfade, a BlackPlayer import, pulled plays (one waiting for its song), edits no writer
  makes today (a play moved to another song, uncounted, started earlier, deleted) and a song
  deletion, `playTotalsDrift` finds nothing. With the triggers mutated so every update takes the
  delta path, this test fails.
- A pull applied twice and pending plays applied twice count each play once.
- A database at 0022 with history, a play that grew into a counted one and a deleted song upgrades
  with totals equal to its history and literal sums, then keeps up with a new play.
- Totals written past the triggers are found by `playTotalsDrift` and fixed by `rebuildPlayTotals`.
- On a seeded random history (60 songs on 20 albums, collaborations, a missing song, 500 plays
  with skips and short plays, BlackPlayer plays, three deleted songs, a play stamped after now),
  Most Played (Library and Android Auto's files-only scope), Recently Played, all-time credited
  totals and the listening totals all equal the whole-history computations.
- None of those reads scans `play_events`. Most Played and Recently Played read `play_totals`
  through its indexes in order, with no temporary sort.

Existing tests pass unchanged: Recently Played, Most Played (counted plays only, a play counted
once it's listened to enough, ties by latest counted play), the v1/v2 upgrade tests, Stats' credited
totals, #311's artist page tests, BlackPlayer and sync. New: Most Played ties by latest added song;
Core `summedListeningTotals` and `recentlyPlayedAlbums`.

Full suites after merging `perf/301-performance` at 2a52cd7: apps/mobile 329 tests, Core 1,882
tests, all passing.

## Not measured, and negative results

**Android: pending.** No phone was attached (`adb devices` listed none), so there are no release
timings, before or after. To take them:

1. Build perf builds of 2a52cd7 (before) and this branch's head (after).
2. With a long queue loaded and Home as the shown tab, run `node scripts/perf/perf.ts run
--scenario skip,tab-switch --label 312-before` on the first build and `--label 312-after` on the
   second, then `perf.ts compare`. Each skip ends a play and starts the next, so with Home in sight
   it is Home refreshing after plays. `tab-switch` covers coming back to Home. Compare the frames
   and the per-step `libraryQueries.reads`.
3. The owner's Library size and play count go in the run's metadata (`LibraryScale.playEvents`).
   Record the summaries here and the files under `results/`.

Limits and negative results:

- sql.js runs SQLite as WebAssembly on a desktop CPU. The phone's SQLite is native and newer, so
  its plans may differ. The plan tests run on sql.js only.
- The all-time credited totals are now bounded by played songs, not plays, but still join every
  credit link (`track_artists ∪ deleted_track_artists`) and group by album and artist. They are
  the largest part of a refresh after. Forcing a table scan of `play_totals` instead of its index
  (`+counted_plays`) made no measurable difference, so it was dropped.
- "Before" in the bench is c9fa645's SQL kept in the bench file, including the correlated
  primary-artist subquery, so the rankings' before/after includes that fix as well as the totals.
- Rolling windows (week, month, year) and Stats' top songs still read `play_events`, as the ticket
  scoped. So does Android Auto's per-artist ranking (`Auto.ts`).
- The overview's sums are one row but read every `play_totals` row (played songs, not plays).
- `recordPlay` resets the previous play with `UPDATE play_events SET ongoing = false WHERE
ongoing = true`, and nothing indexes `ongoing`, so every play start scans the history. This was
  there before #312 and is unchanged.
