# #311 Artist statistics scoped to the artist: the stats block's reads

Ticket: #311 (parent #301). Branch `feat/311-scoped-artist-stats`, based on `perf/301-performance`
at 761375e.

## What was measured

Opening an Artist's page runs `Stats.artist` (`apps/mobile/src/stats/Stats.ts`) for its stats
block. This doc covers the SQLite statements that read runs, their query plans, the rows they
return and their CPU time, before and after the change.

`apps/mobile/bench/artistStats.ts` builds a Library in an in-memory sql.js database with the real
migrations (`testDatabase.ts`). The selected artist has 120 songs, 2,460 plays (one in ten of
songs since deleted, which still credit them), a collaboration with another artist and a song
deleted after its plays. The bench then adds other artists' history, 1,000 songs and 10,000 plays
per artist, and measures both reads at each size:

- **before**: what `Stats.artist` read until this change: `songListening`, all-time
  `trackPlayTotals` and `songsCrediting`, then Core's `artistStats`;
- **after**: `artistPlays`, then Core's `artistStats`.

At every size it checks that both reads give the same stats block (`assert.deepEqual`). Times are
the median of 41 runs after a warm-up. CPU is the process CPU over the 41 runs divided by 41,
because Windows counts CPU in 15.6 ms ticks.

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/artistStats.ts [--quick]
```

**These are desktop numbers** (Node v24.19.0, win32-x64, sql.js with SQLite 3.49.1 compiled to
WebAssembly), not phone timings. The app's expo-sqlite bundles SQLite 3.53.3. Results file:
[`results/311-artist-stats-desktop.jsonl`](results/311-artist-stats-desktop.jsonl), which also
holds every statement's plan.

Both reads are followed by `songsByIds` for at most five most played songs. That statement is the
same before and after and isn't counted here.

## Before (761375e)

`Stats.artist` read the whole history and then kept one artist's songs:

1. `songListening`, statement 1: every credit link of every played song. Plan: `SCAN play_events
USING COVERING INDEX play_events_track_idx` for the `IN (SELECT track_id FROM play_events)`.
2. `songListening`, statement 2: every play event grouped by song. Plan: `SCAN play_events USING
INDEX play_events_track_idx`.
3. `trackPlayTotals` for all time: every counted play up to now. Plan: `SEARCH play_events USING
INDEX play_events_started_at_idx (started_at<?)`, a range that covers the whole history.
4. `songsCrediting`: the artist's songs, `SEARCH track_artists USING INDEX
track_artists_artist_idx`.

Core's `listeningTotals` then filtered every song's listening with `artistIds.includes`.

## After

`artistPlays` (`apps/mobile/src/library/db/stats.ts`) reads only the artist's songs:

1. The artist's listening, in one statement. The artist's songs come from `track_artists` and
   `deleted_track_artists` through their artist indexes. A `CROSS JOIN` fixes the join order so
   play events are reached from those songs through `play_events_track_idx`. The credits of the
   played songs come through each credit table's `(track_id, position)` primary key. Plan:
   `SEARCH track_artists USING INDEX track_artists_artist_idx`, `SEARCH deleted_track_artists
USING INDEX deleted_track_artists_artist_idx`, `SEARCH play_events USING INDEX
play_events_track_idx (track_id=?)`, `SEARCH track_artists USING INDEX
sqlite_autoindex_track_artists_1 (track_id=?)` (and the same for the deleted credits), `SEARCH
tracks USING INTEGER PRIMARY KEY`. The only `SCAN`s are over the statement's own small CTEs.
2. `songsCrediting`, unchanged.
3. `trackPlayTotals` for all time, but only for the artist's songs in the Library that have a
   counted play (one statement per 500 such songs). Plan: `SEARCH tracks USING INTEGER PRIMARY
KEY`, `SEARCH play_events USING INDEX play_events_track_idx (track_id=?)`.

| Other artists' history    | Read   | Statements | Rows returned | Median ms | CPU ms |
| ------------------------- | ------ | ---------: | ------------: | --------: | -----: |
| none (2,460 plays)        | before |          4 |           471 |      3.66 |   3.80 |
|                           | after  |          3 |           351 |      3.80 |   3.44 |
| 1,000 songs, 10,000 plays | before |          4 |         3,191 |     18.93 |  17.15 |
|                           | after  |          3 |           351 |      3.74 |   3.80 |
| 10,000 songs, 100k plays  | before |          4 |        27,671 |    201.22 | 168.05 |
|                           | after  |          3 |           351 |      4.12 |   3.44 |
| 30,000 songs, 300k plays  | before |          4 |        82,071 |    627.57 | 550.71 |
|                           | after  |          3 |           351 |      4.08 |   4.20 |

Before, the work grew with the whole Library's history. After, the returned rows (121 + 121 + 109) and the time stay the same however much history other artists have. When the artist's
history is the whole history, both cost about the same.

## Behavior kept

`apps/mobile/src/library/db/stats.test.ts`, "One artist's plays":

- For **every** artist in a fixture, the stats block from `artistPlays` equals the one from the
  whole-history read. The fixture has a collaboration credited to two artists, a compilation, a
  song deleted with its credits kept, a song deleted before Wave kept credits, skip-only plays, a
  tie on plays and time broken by the latest play, a tie on everything but the title, a play
  stamped after now (it counts in listening but not in the ranking's window), and an unplayed
  artist.
- For every artist, `artistPlays(...).listening` holds exactly `songListening`'s rows for the
  songs whose credit names the artist, in the same shape.
- No statement `artistPlays` runs reads a whole `play_events`, `tracks`, `track_artists` or
  `deleted_track_artists` (no `SCAN` of them, covering-index scans included), and the three
  indexes above appear as `SEARCH` steps. A version that joined the credit tables as a `UNION ALL`
  subquery passed the result tests but scanned both credit tables. This test failed on it.
- Adding 2,500 songs and 40,000 plays by two other artists changes neither the result nor the rows
  each statement returns.

The two existing "Artist page stats" tests, written with literal expectations, now read through
`artistPlays` and pass unchanged. Two mutations of the new read were tried and caught by these
tests: dropping kept credits of deleted songs, and widening the ranking window past now. Core's
`artistStats` is unchanged apart from its input docs: it still filters by artist, so it accepts
either input.

Full suites after merging `perf/301-performance` (with #303 and #314): apps/mobile 286 tests,
Core 1,763 tests, `scripts/perf` 46 tests, all passing.

## Release runner: `push-artist`

The runner gained `push-artist`: Library › Artists › the fixture's artist (`push`), then Back
(`pop`). The push's response mark is the new `artist.stats`, set on the frame after the page's
stats block shows what it read. So `responseMs` covers the tap, the navigation and the stats read
together. The fixture's `artist` (or `--artist`) names the artist. It must show on the Artists
list's first screen. Pick one with a long play history.

## Not measured: Android

**Pending.** No phone was attached (`adb devices` listed none), so there are no release
Artist-page timings, before or after. To take them:

1. Set `artist` in `scripts/perf/fixture.json` and build a perf build of 761375e plus the second
   commit of this branch (the runner scenario and the mark), so "before" has the mark too. Also
   build this branch's head.
2. `node scripts/perf/perf.ts run --scenario push-artist,push-library --label 311-before` on the
   first build, `--label 311-after` on the second, then `perf.ts compare`.
   `push-library/idle/push` is the navigation-only control.
3. Record the summaries here and the files under `results/`.

Before the first device run, check that `uiautomator dump` finds `Artists` and the artist's name
as text nodes, as it does for `Albums`.

Limits:

- sql.js runs SQLite as WebAssembly on a desktop CPU. The phone's SQLite is native and newer, so
  its plans may differ. The query plan test runs on sql.js only.
- `artistPlays` still runs `songsCrediting` and the played-songs `trackPlayTotals` as separate
  statements. Their work is bounded by the artist's songs, not the history.
- `Auto.ts` (Android Auto's per-artist ranking) still reads all-time `trackPlayTotals` over the
  whole history, and `songListening` is still read by Home's listening overview (#312). Neither
  is on the artist page's path.
