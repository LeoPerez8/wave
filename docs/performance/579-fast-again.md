# Wave is fast again (#579): desktop benchmarks

These are **desktop numbers: Node and sql.js (WebAssembly SQLite), not Hermes or the
phone's SQLite**. They identify synchronous work to investigate; they do not predict
phone frame times. This initial #583 inventory changes the measurement harness, not
LibraryStore's reads, so before/after timing differences are run-to-run variation.

## Run the suite

```sh
pnpm --filter @wave/mobile bench:fast-again --quick
pnpm --filter @wave/mobile bench:fast-again --before /path/to/ti-worktree --reference /path/to/v0.7.0-ti-worktree
pnpm --filter @wave/mobile bench:fast-again --quick --bench libraryReads
```

Node 22.18 or newer and the normal workspace dependencies are required. The baseline
worktrees need their checked-out Wave source, but do not need separate dependency
installs. Without a baseline option its comparison column is `null`, not an invented
before number. Unknown flags, invalid worktree paths and result mismatches exit nonzero.
`--help` prints the flags.

The runner auto-discovers every `bench` export under
`apps/mobile/bench/fastAgain/benches/*.ts`. Each bench runs at 1,000, 12,000 and
50,000 songs; `--quick` uses only the first two sizes and three measured runs instead
of eleven. It prints desktop-labelled JSONL: metadata, measurements, the twenty
slowest reads per size/variant, reads whose **median exceeds 16 ms at 12,000 songs**,
and one `comparison` table per bench. The table's columns are size, read, before,
after and reference, with complete metric objects as cells. For a pure JSONL file,
suppress pnpm's command wrapper:

```sh
pnpm --silent --filter @wave/mobile bench:fast-again --before /path/to/ti-worktree --reference /path/to/v0.7.0-ti-worktree > results.jsonl
```

## Shared fixture and measurements

`src/library/db/fastAgainFixture.ts` exports `createFastAgainFixture(size = 1000)`
for both benches and work-count tests, `FAST_AGAIN_SIZES` and `FAST_AGAIN_DESKTOP`.
It uses the existing `openTestDatabase`/`addLibrary` helpers and real sql.js, with
every current migration and its triggers applied. Exactly size/10 albums and
size/25 artists are present. Two artists own 20 and 300 songs within the total;
the others share the remainder. Histories have 10,000, 54,000 and 200,000 events,
spread over 90 days ending at a fixed 2026-10-01 noon UTC. They contain completed
plays and early skips, with favorites, downloaded songs and missing files in the
Library. Each fixture exposes its database, song ids, two targets (artist, song and
album ids), an album, a genre, a playlist of fifty songs, `now` and `close()`.
Every variant gets a fresh identical fixture. A bench that writes must restore
those writes before the next bench runs; tests close their fixtures in `finally`.

A synchronous read warms once, runs once under `traceQueries` to count SQL work,
then runs independently eleven times for wall and CPU timing. Tracing and EXPLAIN
are outside the timed runs. Median averages the middle pair when even; p90 uses
nearest rank. CPU is mean process user + system time per run. `rowsRead` counts
rows **returned** by statements, including intermediate results, not SQLite VM
visits or rows scanned internally. `longestSyncTaskMs` is the longest timed
synchronous operation, including result decoding and any GC in that operation.
Notifications are a cumulative subscriber counter's delta for one operation;
LibraryStore's read-only service has no subscriber writes and reports zero.
Times are not test assertions. Warm reads deliberately exclude migrations,
seeding, module loading and store initialization; this is a read inventory, not a
screen-opening measurement.

`bench/fastAgain/store.ts` loads each selected worktree's actual `LibraryStore`,
query modules and Core source. Node hooks resolve its extensionless `.ts` and `@/`
imports, while third-party dependencies use the installed harness runtime. Only
the store's platform database bootstrap is adapted: it receives the fixture's
already migrated sql.js Drizzle connection. Read effects and SQL are unchanged;
no source text is rewritten and no read is replayed. All three revisions run the
same current database schema and data. An API absent from an old release is
explicitly `unavailable`, not zero cost. The inventory compares hashes of returned
entity identities (ids, track ids or paths), preserving list order, and scalar
results across variants. It deliberately ignores newer fields on entity rows;
this is not a full cross-version schema equivalence assertion.

To add a bench, export `bench: FastAgainBench` from a new module in the discovery
directory. The context supplies `fixture`, `variant`, `root`, `runs`,
`loadModule<T>(relativeRepoPath)` and `measure(readName, synchronousRead, options)`.
`measure` returns median/p90/CPU time, rows, statements, longest task and
notifications. Options can provide a notification counter, a semantic `resultKey`
and additional `details`. Result keys must match across comparable variants or
the suite fails. Async/stepped benches time their actual synchronous steps and
return the same metrics with their step semantics in `details`; `traceQueries`
must wrap each synchronous step separately. Worktree store bootstraps are
sequential; returned services retain their own database. Use
`loadLibraryStore(root, fixture.db)` for the actual store's Effect reads.

## libraryReads evidence

The saved [JSONL](results/579-libraryReads-desktop.jsonl) contains the complete
inventory, all work and timing metrics, all three variants, rankings and the
comparison table. It was recorded with the full command, eleven runs per read,
after a warm-up. The following tables show each size's twenty slowest current
reads. Rows and statements are the current read's returned SQL work; times are
median milliseconds, with current p90. Historical APIs that did not exist are
marked `—`.

Recorded 2026-10-22T06:21:19.567Z on linux-x64, Intel Core i5-10300H (8 logical CPUs), Node v26.8.2, sql.js 1.14.2.
The exact recorded command (from the repository root) was:

```sh
git worktree add --detach /tmp/wave-583-before v0.19.0-ti
git worktree add --detach /tmp/wave-583-reference v0.7.0-ti
pnpm --silent --filter @wave/mobile bench:fast-again --before /tmp/wave-583-before --reference /tmp/wave-583-reference > docs/performance/results/579-libraryReads-desktop.jsonl
```

The snapshot commits are:

- **after**: `a2a7661410c741c1ec00fd1af579b8ea3c63aa6c` (the #583 harness snapshot; store reads unchanged from main/ti).
- **before**: `460e39ff0cba6f50e7a456a77d6e99813295ebaa` (`v0.19.0-ti`).
- **reference**: `add761ed787061db6a6c2799687d421301b6182b` (`v0.7.0-ti`).

There are 81 read scenarios per size/variant. The reference has 22 unavailable APIs; the JSONL records each reason. All comparable entity identity/scalar checks passed at all three sizes.

### 1,000 songs — desktop Node + sql.js

| Read                          | Rows returned | Statements | Before median ms | Current median ms | Reference median ms | Current p90 ms |
| ----------------------------- | ------------: | ---------: | ---------------: | ----------------: | ------------------: | -------------: |
| `tasteHistory`                |        10,150 |          3 |           18.000 |            17.424 |                   — |         18.803 |
| `playlistRecommendationInput` |         2,343 |         15 |           16.623 |            16.401 |                   — |         16.864 |
| `listSongs`                   |         1,000 |          1 |           13.071 |            14.882 |              14.060 |         16.775 |
| `countedListening`            |         7,200 |          1 |           13.219 |            12.556 |                   — |         13.690 |
| `artistPlays/300`             |           840 |          3 |           14.416 |             7.645 |               7.113 |          8.771 |
| `trackPlayTotals/all`         |           800 |          1 |           15.985 |             7.563 |               7.764 |          8.244 |
| `duplicateCheckFiles`         |           980 |          1 |            7.135 |             7.155 |                   — |          7.970 |
| `listLibraryLookupSongs`      |           980 |          1 |            5.134 |             6.070 |               5.391 |          6.326 |
| `getArtist/300`               |           331 |          3 |            5.240 |             5.142 |               6.410 |          6.035 |
| `playedRecordingKeys`         |         1,000 |          1 |            4.781 |             5.141 |               9.415 |          5.896 |
| `getGenre`                    |           335 |          2 |            4.700 |             4.510 |               4.676 |          5.805 |
| `home`                        |           104 |          6 |            3.653 |             3.893 |               3.466 |          5.439 |
| `creditedPlayTotals/all`      |            80 |          1 |            6.988 |             3.548 |               3.680 |          4.119 |
| `importTracks`                |           980 |          1 |            3.089 |             3.444 |               7.500 |          3.979 |
| `importedPlays`               |             0 |          1 |            2.468 |             2.548 |               4.912 |          3.271 |
| `songFindTexts`               |         1,000 |          1 |            1.977 |             2.289 |                   — |          2.943 |
| `knownFiles`                  |           980 |          1 |            1.644 |             1.894 |               1.723 |          2.417 |
| `listArtistsPage/50`          |            40 |          1 |            2.080 |             1.889 |               2.293 |          2.031 |
| `listFavorites`               |           100 |          1 |            2.397 |             1.885 |               2.981 |          2.465 |
| `listSongOrder/title`         |             1 |          1 |            2.030 |             1.873 |               3.525 |          2.100 |

### 12,000 songs — desktop Node + sql.js

| Read                          | Rows returned | Statements | Before median ms | Current median ms | Reference median ms | Current p90 ms |
| ----------------------------- | ------------: | ---------: | ---------------: | ----------------: | ------------------: | -------------: |
| `listSongs`                   |        12,000 |          1 |          191.556 |           184.512 |             173.839 |        193.565 |
| `playlistRecommendationInput` |        25,883 |         15 |          162.447 |           164.123 |                   — |        170.821 |
| `tasteHistory`                |        55,800 |          3 |          104.946 |           105.340 |                   — |        108.399 |
| `duplicateCheckFiles`         |        11,760 |          1 |           81.895 |            82.785 |                   — |         93.933 |
| `listLibraryLookupSongs`      |        11,760 |          1 |           82.878 |            82.750 |              73.753 |         85.514 |
| `trackPlayTotals/all`         |         9,600 |          1 |           58.973 |            57.380 |              56.515 |         59.526 |
| `getGenre`                    |         4,001 |          2 |           53.443 |            53.571 |              51.882 |         55.750 |
| `creditedPlayTotals/all`      |           960 |          1 |           64.932 |            48.528 |              50.105 |         49.264 |
| `playedRecordingKeys`         |        12,000 |          1 |           42.589 |            43.264 |              43.041 |         45.341 |
| `importTracks`                |        11,760 |          1 |           38.165 |            38.316 |              39.271 |         40.934 |
| `listArtistsPage/50`          |            50 |          1 |           28.521 |            28.559 |              29.200 |         29.448 |
| `countedListening`            |         8,640 |          1 |           27.831 |            27.963 |                   — |         31.515 |
| `songFindTexts`               |        12,000 |          1 |           26.381 |            26.978 |                   — |         29.686 |
| `listSongOrder/title`         |             1 |          1 |           22.864 |            23.334 |              23.002 |         24.442 |
| `listArtists`                 |           480 |          1 |           21.541 |            21.729 |              21.575 |         23.166 |
| `qualityFiles`                |        11,760 |          1 |           21.925 |            21.574 |                   — |         23.599 |
| `listAlbums`                  |         1,200 |          1 |           20.069 |            20.841 |              19.694 |         25.345 |
| `knownFiles`                  |        11,760 |          1 |           20.207 |            19.493 |              19.441 |         20.910 |
| `artistsByIds/2`              |             2 |          1 |           17.459 |            17.956 |              17.489 |         18.211 |
| `importedPlays`               |             0 |          1 |           17.863 |            17.260 |              17.524 |         18.149 |

### 50,000 songs — desktop Node + sql.js

| Read                          | Rows returned | Statements | Before median ms | Current median ms | Reference median ms | Current p90 ms |
| ----------------------------- | ------------: | ---------: | ---------------: | ----------------: | ------------------: | -------------: |
| `listSongs`                   |        50,000 |          1 |          901.764 |           833.966 |             802.093 |        894.805 |
| `playlistRecommendationInput` |       107,203 |         15 |          685.861 |           684.697 |                   — |        724.788 |
| `tasteHistory`                |       207,500 |          3 |          415.821 |           403.685 |                   — |        439.908 |
| `listLibraryLookupSongs`      |        49,000 |          1 |          353.982 |           355.268 |             326.877 |        370.330 |
| `duplicateCheckFiles`         |        49,000 |          1 |          350.245 |           345.392 |                   — |        360.695 |
| `trackPlayTotals/all`         |        40,000 |          1 |          250.121 |           273.397 |             251.025 |        369.317 |
| `getGenre`                    |        16,668 |          2 |          236.507 |           240.383 |             231.139 |        255.827 |
| `creditedPlayTotals/all`      |         4,000 |          1 |          217.422 |           214.255 |             211.314 |        216.168 |
| `playedRecordingKeys`         |        50,000 |          1 |          197.735 |           198.202 |             197.689 |        201.319 |
| `importTracks`                |        49,000 |          1 |          168.567 |           168.226 |             168.206 |        186.575 |
| `songFindTexts`               |        50,000 |          1 |          122.163 |           126.283 |                   — |        140.358 |
| `listArtistsPage/50`          |            50 |          1 |          126.017 |           125.057 |             127.754 |        126.268 |
| `listSongOrder/title`         |             1 |          1 |          104.681 |           105.276 |             107.927 |        116.792 |
| `qualityFiles`                |        49,000 |          1 |          100.066 |           100.570 |                   — |        102.792 |
| `listArtists`                 |         2,000 |          1 |           97.977 |            97.063 |              95.206 |         97.570 |
| `listAlbums`                  |         5,000 |          1 |           88.771 |            87.402 |              85.359 |         89.018 |
| `knownFiles`                  |        49,000 |          1 |           88.251 |            87.354 |              85.794 |         89.528 |
| `countedListening`            |         8,640 |          1 |           87.542 |            87.235 |                   — |         96.381 |
| `artistsByIds/2`              |             2 |          1 |           77.946 |            77.797 |              79.384 |         79.760 |
| `listFavorites`               |         5,000 |          1 |           73.102 |            72.728 |              70.303 |         74.181 |

### Next candidates at 12,000 songs — desktop Node + sql.js

22 current reads exceeded the 16 ms median budget in this run:

- `listSongs`: 184.512 ms, 12,000 returned rows.
- `playlistRecommendationInput`: 164.123 ms, 25,883 returned rows.
- `tasteHistory`: 105.340 ms, 55,800 returned rows.
- `duplicateCheckFiles`: 82.785 ms, 11,760 returned rows.
- `listLibraryLookupSongs`: 82.750 ms, 11,760 returned rows.
- `trackPlayTotals/all`: 57.380 ms, 9,600 returned rows.
- `getGenre`: 53.571 ms, 4,001 returned rows.
- `creditedPlayTotals/all`: 48.528 ms, 960 returned rows.
- `playedRecordingKeys`: 43.264 ms, 12,000 returned rows.
- `importTracks`: 38.316 ms, 11,760 returned rows.
- `listArtistsPage/50`: 28.559 ms, 50 returned rows.
- `countedListening`: 27.963 ms, 8,640 returned rows.
- `songFindTexts`: 26.978 ms, 12,000 returned rows.
- `listSongOrder/title`: 23.334 ms, 1 returned rows.
- `listArtists`: 21.729 ms, 480 returned rows.
- `qualityFiles`: 21.574 ms, 11,760 returned rows.
- `listAlbums`: 20.841 ms, 1,200 returned rows.
- `knownFiles`: 19.493 ms, 11,760 returned rows.
- `artistsByIds/2`: 17.956 ms, 2 returned rows.
- `importedPlays`: 17.260 ms, 0 returned rows.
- `countLibrary`: 16.698 ms, 1 returned rows.
- `listFavorites`: 16.514 ms, 1,200 returned rows.

These are investigation candidates, not evidence that a particular tap currently
starts them. Large returned row counts expose decode work; low counts do not
prove cheap SQL (`listSongOrder` returns a JSON bundle, and an aggregate or
filtered query may visit many rows while returning few or none). Targeted reads
also need measurement: `artistsByIds/2` still delegates to a whole-Library
counting query, and `listArtistsPage/50` returns fifty rows but does more SQL work
than a simple fifty-row page. No query is optimized by this inventory ticket.

### Targeted controls at 12,000 songs — desktop Node + sql.js

| Read               | Rows returned | Statements | Current median ms | Current p90 ms |
| ------------------ | ------------: | ---------: | ----------------: | -------------: |
| `getArtist/20`     |            23 |          3 |             1.488 |          2.167 |
| `getArtist/300`    |           331 |          3 |             5.395 |          6.712 |
| `getAlbum/10`      |            12 |          3 |             0.976 |          1.089 |
| `trackDetails`     |             1 |          1 |             0.262 |          0.521 |
| `songSummaries/50` |            50 |          1 |             0.655 |          1.120 |

## Verification

- `pnpm --filter @wave/mobile test`: 523 tests passed after merging integration #581.
- `pnpm --filter @wave/core test`: 3,358 tests passed after integration.
- `pnpm --filter @wave/mobile typecheck`: passed.
- Scoped oxlint and Prettier checks: passed.
- Full current/ti/reference suite: 743 valid desktop-labelled JSONL records;
  81 scenarios × three sizes × three variants, with matching comparable results.
- Quick current/ti/reference suite: 497 JSONL records, only 1,000 and 12,000 songs;
  repeated successfully after merging #581. The saved full inventory retains
  its explicit pre-merge snapshot commit above.
- The package command was also verified with `--quick --bench libraryReads`.
- No phone measurements are claimed. Other #579 tickets add their benches to
  the registry and append their evidence here.

## nowPlayingLinks evidence (#585)

The saved [JSONL](results/579-nowPlayingLinks-desktop.jsonl) records the actual
selected revision's Core sheet lifecycle, at all three fixture sizes, with eleven
measured synchronous replays per sequence. The current path also loads that
revision's actual `followNowPlayingLink` action. The historical native sheet cannot
run in Node: its adapter faithfully replays the selected sheet's single
`afterClose` slot, callback replacement and spring-end delivery. The bench checks
that the historical source has that rule before using it. The six required
sequences are link, link then Back, link then a drag, link then a card dismissed,
link while closing and two links; an additional chevron sequence exercises the
other close button. Each size therefore attempts eight link taps across seven
sequences. A drag springs back open, interrupting the closing spring; Back,
chevron and the card scenario request another callback-free close. Events are
16 ms apart. Successful pushes retain their tap identities and order, without
repeat delivery. The fixed path must deliver every tap before its handler returns.
Missing historical deliveries are the bug being measured, so the bench prints
that difference explicitly instead of giving unequal results a shared result key.

These are **desktop replay results, not device timings**. The parameters are read
from each selected sheet's actual closing spring: damping 30, stiffness 300,
mass 1. Spring settlement is computed from the analytic damped oscillator's
kinetic plus potential energy, with zero initial velocity and unit displacement,
using Reanimated 4's default relative energy threshold of `6e-9`, sampled at a
modeled 60 Hz. The first frame below that threshold is **650 ms**. This is a model
of the animation wait, independent of sheet height; it is not a stopwatch delay,
a hardcoded spring duration or a measured phone animation. `waitBeforePushMs`
reports this modeled delay separately from the synchronous replay's measured
wall/CPU/longest-task times. Empty wait arrays mean no push happened. No database
reads or store notifications occur on this lifecycle path; fixture setup is
outside the timed replay.

| Library size | ti taps lost / attempted | Fixed taps lost / attempted | ti wait before successful push (modeled ms) | Fixed wait before push (modeled ms) |
| -----------: | -----------------------: | --------------------------: | ------------------------------------------: | ----------------------------------: |
|        1,000 |                    5 / 8 |                       0 / 8 |                                         650 |                                   0 |
|       12,000 |                    5 / 8 |                       0 / 8 |                                         650 |                                   0 |
|       50,000 |                    5 / 8 |                       0 / 8 |                                         650 |                                   0 |

The v0.7.0-ti reference has the same losses and modeled wait as ti. Without the
extra chevron sequence, ti loses four of the seven taps in the six required
sequences. These counts describe adversarial event replays, not a real-world
loss rate. A successful ti link, including a link while closing, waits for the
spring. Back, the interrupted drag and the card close lose their link; two links
keep only the last. After the fix both links dispatch on their own tap, and no
later close, drag or spring callback owns or repeats their navigation.

Recorded 2026-10-22T11:18:44.673Z on linux-x64, Node v26.8.2, sql.js 1.14.2.
Current implementation `80d9e538`, including integration `2b74bac7`; before
`v0.19.0-ti` (`460e39ff`), reference `v0.7.0-ti` (`add761ed`). Exact command:

```sh
pnpm --silent --filter @wave/mobile bench:fast-again --bench nowPlayingLinks --before /tmp/wave-596-before --reference /tmp/wave-596-reference > docs/performance/results/579-nowPlayingLinks-desktop.jsonl
```

The 1,000-song work-count test exercises the same production link action and Core
reducer. Separate public-API Core tests cover links from hidden, opening, open,
drag and closing; native screen hiding and the player-view reset still occur
only on spring completion. Fake-clock monitor tests check the one-second warning
boundary, independent rapid-tap deadlines, all diagnostic reasons and successful
screen/card acknowledgment. Actual Android touch, animation overlap, TalkBack,
reduced motion and exported `WaveTiming` log acceptance remain outstanding: this
environment has no Android SDK or device. No device acceptance or phone speedup
is claimed by these desktop results.

## artistOpening evidence (#589)

The Library artist route reads its own detail and saved artist answer before its
local rows. Saved Popular ranks are derived from those songs alone. Its section
now acquires the shared finder only after the local content and screen settle,
with Online selected and a standing full answer. This includes saved answers and
integrated openings. Pending requests and Library mode need no finder. Online,
Always and integrated section requests, including queued retries, share that
settlement gate and check Android connectivity immediately before execution.
Popular's separate quiet request remains #590's work; the common playing-ids
follower remains #588's, and other online detail routes remain #591's.

The saved [JSONL](results/579-artistOpening-desktop.jsonl) compares the actual
`v0.19.0-ti` store/Core (`460e39ff`) with the implementation using the shared
fixture at 1,000, 12,000 and 50,000 songs, eleven timed runs after warm-up.
These are **desktop Node/sql.js measurements, not Hermes/phone SQLite timings
or phone frame measurements**.

`artistOpeningReplay.ts` faithfully replays the artist-owned opening reads and
Core derivations, because the React Native route cannot run in Node. Every
opening starts with a cold shared query/finder; the database and modules are
warm. The first-row interval ends when the local page data/items are ready,
including saved Popular ranking; it excludes module loading, fixture setup,
React rendering/layout, navigation and common player subscriptions. Before reads
the whole songs query and builds its finder when online rows need it, alongside
the own-songs finder. After reads only the artist detail and saved answer. The
SQL and individual row counts are included in each measurement's `details`.

The fixture also includes an Appears on album, the artist's Library albums,
missing/downloaded songs, a reversed saved Popular list, a song already in the
Library under another artist and one remote-only song/release. Setup writes are
restored before another bench runs. Both the local first-row projection and the
complete settled page (artist, albums, appearances, full song rows/ranks, counts,
Online view/shelves and page items) must match ti: all 24 comparison keys match.
Integrated first-row equality compares the local rows; online additions are
compared after settlement, when the fixed page is allowed to show them.

The table reports before → after for the interval to local first-row data. Total
SQL rows include artist/album/saved-answer rows; song rows count only decoded
song records. Each first-row replay runs five → four statements. The JSONL also
records p90, CPU, longest synchronous task and read-only notification count.
Times are benchmark evidence; the tests assert deterministic work, not time.

| Library songs | Artist songs | Mode       | Song rows before → after | All SQL rows before → after | Median ms before → after |
| ------------: | -----------: | ---------- | -----------------------: | --------------------------: | -----------------------: |
|         1,000 |           20 | library    |               1,020 → 20 |                  1,024 → 24 |           21.477 → 2.677 |
|         1,000 |           20 | integrated |               1,020 → 20 |                  1,024 → 24 |           22.186 → 2.782 |
|         1,000 |          300 | library    |              1,300 → 300 |                 1,332 → 332 |          29.360 → 11.327 |
|         1,000 |          300 | integrated |              1,300 → 300 |                 1,332 → 332 |           31.236 → 9.411 |
|        12,000 |           20 | library    |              12,020 → 20 |                 12,024 → 24 |          224.520 → 2.435 |
|        12,000 |           20 | integrated |              12,020 → 20 |                 12,024 → 24 |          222.290 → 2.171 |
|        12,000 |          300 | library    |             12,300 → 300 |                12,332 → 332 |         230.751 → 10.324 |
|        12,000 |          300 | integrated |             12,300 → 300 |                12,332 → 332 |          235.106 → 9.111 |
|        50,000 |           20 | library    |              50,020 → 20 |                 50,024 → 24 |         1004.735 → 2.356 |
|        50,000 |           20 | integrated |              50,020 → 20 |                 50,024 → 24 |         1004.448 → 2.025 |
|        50,000 |          300 | library    |             50,300 → 300 |                50,332 → 332 |         1005.143 → 9.062 |
|        50,000 |          300 | integrated |             50,300 → 300 |                50,332 → 332 |         1095.813 → 8.537 |

The shared whole-Library read is deferred, not eliminated: in integrated mode its
settled-page measurement still returns the whole Library's song rows. This
change removes that work from the artist-owned first-row path and keeps it out
of Library mode. It does not claim the deferred read fits the background step
budget or that the mounted app has no remaining common followers. Verification
on the owner's ti build, offline/online and with exported WaveTiming logs, remains
outstanding.
