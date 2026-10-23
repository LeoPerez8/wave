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
Every size/variant/bench combination gets a fresh identical fixture. The runner
closes it in `finally`, including when a bench fails. Writes stay within that
benchmark; fixture creation and cleanup remain outside its measurements.

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
comparison table. It was recorded with the full command when `libraryReads` was
the only registered benchmark, eleven runs per read, after a warm-up. The following
tables show each size's twenty slowest current
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
the whole songs query; its shared finder index stays lazy and builds only when
online rows need a lookup. The own-songs finder is built in either mode. After
reads only the artist detail and saved answer. The SQL and individual row counts
are included in each measurement's `details`.

The historical `v0.7.0-ti` artist route (`add761ed`) already followed this finder
from both the route and its online section. This removes inherited opening work;
it does not attribute that follower to the later Popular feature. Popular's new
quiet request remains separately assigned to #590.

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
|         1,000 |           20 | library    |               1,020 → 20 |                  1,024 → 24 |           15.011 → 2.438 |
|         1,000 |           20 | integrated |               1,020 → 20 |                  1,024 → 24 |           20.214 → 2.233 |
|         1,000 |          300 | library    |              1,300 → 300 |                 1,332 → 332 |           22.707 → 9.259 |
|         1,000 |          300 | integrated |              1,300 → 300 |                 1,332 → 332 |           28.150 → 8.595 |
|        12,000 |           20 | library    |              12,020 → 20 |                 12,024 → 24 |          182.369 → 2.003 |
|        12,000 |           20 | integrated |              12,020 → 20 |                 12,024 → 24 |          230.271 → 1.904 |
|        12,000 |          300 | library    |             12,300 → 300 |                12,332 → 332 |          189.536 → 9.314 |
|        12,000 |          300 | integrated |             12,300 → 300 |                12,332 → 332 |          241.692 → 9.102 |
|        50,000 |           20 | library    |              50,020 → 20 |                 50,024 → 24 |          809.880 → 1.818 |
|        50,000 |           20 | integrated |              50,020 → 20 |                 50,024 → 24 |         1028.847 → 2.000 |
|        50,000 |          300 | library    |             50,300 → 300 |                50,332 → 332 |          832.658 → 9.307 |
|        50,000 |          300 | integrated |             50,300 → 300 |                50,332 → 332 |         1052.574 → 8.899 |

The shared whole-Library read is deferred, not eliminated: in integrated mode its
settled-page measurement still returns the whole Library's song rows. This
change removes that work from the artist-owned first-row path and keeps it out
of Library mode. It does not claim the deferred read fits the background step
budget or that the mounted app has no remaining common followers. Verification
on the owner's ti build, offline/online and with exported WaveTiming logs, remains
outstanding.

## Regression sweep: v0.7.0-ti to ti (#596)

This sweep compares the reference above with `origin/ti` / `v0.19.0-ti`
(`460e39ff0cba6f50e7a456a77d6e99813295ebaa`) and the local integration
snapshot `ee9610b633ea1f963d06ec39b95c7dbdfd521b4e` containing #580, #581 and
#583. Here **current/after means the research harness, with unchanged production
reads**, not an optimized application. Differences between ti and current are
run variability and instrumentation, not claimed speedups. Historical source is
loaded from the read-only `/tmp/wave-596-before` and `/tmp/wave-596-reference`
worktrees. The five preserved partial files and their quick-run logs were
inspected before recovery; the evidence below comes from fresh full runs.

The research harness and characterization are committed in `c28955b4`.
The raw metadata records the pre-research base because the harness files were
uncommitted during capture. Before handoff this branch also merged local
integration `d1bb8feb9385a7d6c8bac1e0dc471e3b8d8f9ff7` (#584 guards and #585
immediate Now Playing links). Those changes do not alter the measured LibraryStore,
Stats, playlist ranking or graph algorithms; the tables retain their recorded
snapshot. #585 has its own measured section above.

These remain **desktop Node + sql.js numbers, not Hermes, Android SQLite, or
measured tap-to-first-frame times**. Each scenario warms once, traces separately,
and times eleven runs at 1,000, 12,000 and 50,000 songs, using #583's identical
fixtures. The replay and stepped probes record their semantics in each JSONL
`details` field. Process CPU, p90, SQL work, notifications, and longest task are
retained in the raw files. An unavailable reference feature is not a zero-time
implementation. No exported phone log was supplied for this sweep.

### What happens on the tab and push paths

A tab tap goes through `chrome/TabBar.tsx`, `tabSwitches.ts`, expo-router, the
retained `TabSlot`, and the screen's render/effects. A detail tap goes through
`library/routes.ts` (or the Now Playing/menu link), router dispatch, the detail
screen and its read subscriptions. The shared query registry starts its SQLite
read in a later timer task. That avoids running it inside the handler, but it
can still overlap transition frames: a single synchronous query cannot yield.
A resolved Promise around synchronous SQLite does not move that query off JS.
These are source-established scheduling paths; the desktop benches cannot
establish whether an effect/task preceded a particular Android first frame.

The tab layout's only change between the release tags is a TypeScript type for
`Object.entries`. `chrome/tabScreens.tsx`, `library/sharedQueries.ts` and
`lib/useFocusedVersion.ts` are unchanged. Both versions retain visited tabs and
have shared queries that pause hidden screens. The evidence supports additional
readers bypassing that lifecycle, rather than a new tab retention policy.

| Surface / trigger                                            | v0.7.0-ti                                                                                               | ti / integration                                                                                                                                                               | Disposition                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Home first visit and every focus                             | Shared Home shelves and focused totals; no Recap card                                                   | Adds `useRecapToAnnounce → useStatsRead → Stats.recaps → countedListening`; every focus runs it even with an unchanged play version                                            | New Recap-availability ticket draft                                              |
| Editable playlist push / mount                               | Own playlist data; no recommendation section                                                            | `PlaylistItems` mounts recommendations below its rows without viewport gating; input read, cold shared graph if needed, then synchronous Core ranking                          | New playlist-recommendation ticket draft                                         |
| Download / scan / favorite with playlist screen retained     | Shared queries suppress hidden work                                                                     | Recommendations directly follow `onLibraryChange`, with `tracks: true`, `favorites: true`; no visibility check or burst coalescing; each retained session renews independently | Same playlist ticket; replay measures one and two sessions                       |
| First shared Artist graph consumer after launch/invalidation | Graph absent                                                                                            | Two free-turn boundaries, but history, all artists, all songs and their conversion occupy one middle segment; final graph derivation occupies another                          | Covered by #594 (explicit #584 guard ownership); extend its measured graph scope |
| Home/Stats winning artists; paged artist consumers           | Global credited-song UNION, even for two requested artists or a 50-row page                             | Same global aggregation; a small returned row count conceals whole-Library SQL work                                                                                            | New bounded artist-count ticket draft; inherited cost                            |
| Genre push                                                   | Whole genre decoded, then sorted in JS despite virtualized rows                                         | Same full genre hydration                                                                                                                                                      | New genre-first-page ticket draft; inherited cost                                |
| Now Playing / Queue / streamed playing-row subscriptions     | Existing bounded warm player/Queue; no new streamed identity follower                                   | Sheet song buttons/download lookup and list playing ids follow full songs/finder                                                                                               | Already #587/#588; no duplicate ticket                                           |
| Artist / integrated album push                               | Artist route and online section already follow the whole-Library finder; no later quiet Popular request | Whole-Library finder is inherited; Popular background read and integrated online opening behavior need their own boundaries                                                    | Already #589–#591; link sequencing/readiness #585/#586                           |
| Home picks, taste, daily mixes, known videos, startup        | Earlier Home/startup implementations                                                                    | Additional full-Library/history work and focus/startup scheduling                                                                                                              | Already #592–#595; graph and Recap are separate call paths                       |

The always-mounted/retained inventory also includes floating chrome (mini player,
tab bar, selection), root overlay/toast hosts, Now Playing's shell and visited
Queue content. Playback selectors and shared Library queries are already scoped;
retention alone is not evidence of new database work. `Activity` tears down
hidden Queue effects. In contrast the playlist recommendation component has a
raw change-bus subscription and no screen-sight API. The replay uses actual Core
sessions, LibraryStore inputs and the selected worktree's change bus, with a
faithful replay of that component subscription. It does **not** mount React,
measure native retained views or claim a total render notification count.

### Measurements and saved runs

Run from this checkout, with the baseline worktrees already present:

```sh
pnpm --silent --filter @wave/mobile bench:fast-again --bench regressionSweep --before /tmp/wave-596-before --reference /tmp/wave-596-reference
pnpm --silent --filter @wave/mobile bench:fast-again --bench playlistRenewal --before /tmp/wave-596-before --reference /tmp/wave-596-reference
pnpm --silent --filter @wave/mobile bench:fast-again --bench graphSlices --before /tmp/wave-596-before --reference /tmp/wave-596-reference
pnpm --silent --filter @wave/mobile bench:fast-again --bench boundedReads --before /tmp/wave-596-before --reference /tmp/wave-596-reference
pnpm --silent --filter @wave/mobile bench:fast-again --bench songReadSlices --before /tmp/wave-596-before --reference /tmp/wave-596-reference
```

The existing [libraryReads inventory](results/579-libraryReads-desktop.jsonl)
provides the complete read ranking and twenty slowest reads per size; the new
sweep tests the additional callers and controls, rather than reinterpreting
warm read times as screen-opening latency. Its over-budget rows reproduce the
inventory's main costs. The shared graph's unsliced probe reports total
synchronous CPU work; `graphSlices` separately measures the actual three
segments around its production yield hooks, using real Node task yields in
place of the app scheduler's waits. Only the latter is a segment measurement.

<!-- #596 measured tables follow -->

The full sweep was recorded on 2026-10-22T11:08:07.494Z with v26.8.2 on linux-x64. This is a shared desktop host: independent integration checks overlapped portions of the bounded-read, graph and renewal passes. The first bounded-read pass remains in the handoff directory as a contention diagnostic and was replaced by a repeat below. Use repeated work counts and query plans for attribution; p90/max include host scheduling and GC. No cross-run timing delta is treated as an application improvement.

#### Newly added work on Home and playlist paths

Raw evidence: [regressionSweep](results/596-regressionSweep-desktop.jsonl). All values are **desktop Node + sql.js milliseconds**; SQL rows include intermediate results.

| Songs  | Operation                     | Rows    | SQL | ti median | Current median | v0.7 median | Current p90 |
| ------ | ----------------------------- | ------- | --- | --------- | -------------- | ----------- | ----------- |
| 1,000  | `homeRecapAvailability`       | 7,200   | 1   | 14.223    | 15.039         | —           | 17.102      |
| 1,000  | `playlistRecommendationInput` | 2,343   | 15  | 15.586    | 16.717         | —           | 18.911      |
| 1,000  | `playlistRankWarmInput`       | 0       | 0   | 58.355    | 59.997         | —           | 60.795      |
| 1,000  | `playlistGraphCold`           | 11,190  | 8   | 48.745    | 48.839         | —           | 51.714      |
| 12,000 | `homeRecapAvailability`       | 8,640   | 1   | 29.609    | 29.260         | —           | 31.219      |
| 12,000 | `playlistRecommendationInput` | 25,883  | 15  | 155.205   | 156.357        | —           | 166.832     |
| 12,000 | `playlistRankWarmInput`       | 0       | 0   | 376.794   | 402.509        | —           | 578.008     |
| 12,000 | `playlistGraphCold`           | 68,280  | 8   | 401.400   | 414.273        | —           | 548.112     |
| 50,000 | `homeRecapAvailability`       | 8,640   | 1   | 93.727    | 91.603         | —           | 97.229      |
| 50,000 | `playlistRecommendationInput` | 107,203 | 15  | 655.794   | 664.397        | —           | 755.429     |
| 50,000 | `playlistRankWarmInput`       | 0       | 0   | 4,072.051 | 3,833.316      | —           | 3,976.528   |
| 50,000 | `playlistGraphCold`           | 259,500 | 8   | 1,708.757 | 1,686.146      | —           | 1,730.473   |

Recap reads return quarter-hour aggregates, not one row per play. At 12,000 and 50,000 songs both return 8,640 time buckets, but aggregating the underlying 54,000 versus 200,000 play events still grows. Five recommendation slots do not bound the input or ranking work. `playlistGraphCold` is the explicitly unsliced graph CPU probe; its longest task must not be confused with the production segments below.

The preserved three-run quick sweep independently reported 12,000-song medians of 31.061 ms for Recap, 159.417 ms for input, 390.219 ms for ranking and 413.211 ms for unsliced graph work, with the same SQL work counts. The full-run medians above reproduce the causes; this is repeatability evidence, not an application before/after improvement. The quick logs remain in the research handoff directory.

#### Repeated retained playlist sessions

Raw evidence: [playlistRenewal](results/596-playlistRenewal-desktop.jsonl). One unrelated burst track change is sent through the real change bus after the sessions are warm. Graph is null/warm, YT Music disabled and no network is used. The shared fixture has no saved candidate catalog or similar-artist pages; these costs are already present for local recommendations, not a worst-case online catalog. Times cover input + Core renewal/ranking and the resolved-Promise microtask batch; there is no intervening task yield. React rendering, graph derivation, and the component's Library-row-map publication are excluded. Notifications count the Core session subscriber only. The replay validates offered track identities across ti/current; v0.7 has no sessions.

| Songs  | Retained sessions | Input reads | Rows    | SQL | Notifications | ti median ms | Current median ms | Current p90 ms |
| ------ | ----------------- | ----------- | ------- | --- | ------------- | ------------ | ----------------- | -------------- |
| 1,000  | 1                 | 1           | 2,343   | 15  | 3             | 206.078      | 211.319           | 421.020        |
| 1,000  | 2                 | 2           | 4,686   | 30  | 6             | 439.755      | 425.448           | 554.945        |
| 12,000 | 1                 | 1           | 25,883  | 15  | 3             | 2,078.528    | 629.400           | 948.375        |
| 12,000 | 2                 | 2           | 51,766  | 30  | 6             | 1,304.255    | 1,108.180         | 1,132.428      |
| 50,000 | 1                 | 1           | 107,203 | 15  | 3             | 4,392.071    | 4,446.388         | 4,581.121      |
| 50,000 | 2                 | 2           | 214,406 | 30  | 6             | 8,826.617    | 8,727.665         | 9,746.985      |

The second session represents another retained playlist component, not a claim that five playlist pages are always mounted. The behavior test proves the work grows from one read/15 statements/3 session notifications to two reads/30 statements/6 notifications for one unchanged result, and stops after unsubscribe. It characterizes current wiring; the follow-up must replace these bad-work counts with visibility/coalescing bounds.

#### Shared Artist graph: actual yield boundaries

Raw evidence: [graphSlices](results/596-graphSlices-desktop.jsonl). `readArtistGraph` runs unchanged with a real `setImmediate` at each of its two `between` hooks. These substitute for free-turn waits; waiting on the app scheduler is excluded. The fixture has empty candidate-catalog/similar-page inputs, so the first segment returns zero rows and is not a bound for a populated online cache. Segments are (1) catalog + saved pages, (2) history + all artists + all songs + conversion, (3) play-to-artist mapping + Core graph derivation.

| Songs  | Segment | Rows    | SQL | Segment median ms | Segment p90 ms |
| ------ | ------- | ------- | --- | ----------------- | -------------- |
| 1,000  | 1       | 0       | 3   | 1.064             | 1.652          |
| 1,000  | 2       | 11,190  | 5   | 118.664           | 175.658        |
| 1,000  | 3       | 0       | 0   | 49.527            | 88.401         |
| 12,000 | 1       | 0       | 3   | 0.589             | 0.903          |
| 12,000 | 2       | 68,280  | 5   | 355.510           | 433.239        |
| 12,000 | 3       | 0       | 0   | 110.993           | 135.216        |
| 50,000 | 1       | 0       | 3   | 0.652             | 0.878          |
| 50,000 | 2       | 259,500 | 5   | 1,614.370         | 1,847.922      |
| 50,000 | 3       | 0       | 0   | 471.784           | 544.774        |

Caching prevents repeat warm builds, but does not bound either of the two expensive cold segments. This graph has independent inputs and construction from TasteProfile; splitting the taste profile in #593 or sequencing mix builds in #594 does not by itself slice `readArtistGraph`.

#### Controls: own rows versus broad inherited work

Raw evidence is in [regressionSweep](results/596-regressionSweep-desktop.jsonl). The first two controls show the artist/album's own SQL remains small. Artist rows and genre hydration were expensive in the reference too; they are residual scaling costs, not evidence of a newly introduced regression.

| Songs  | Control           | SQL rows | ti median ms | Current median ms | v0.7 median ms |
| ------ | ----------------- | -------- | ------------ | ----------------- | -------------- |
| 1,000  | `artistOwnRows20` | 23       | 1.493        | 2.006             | 1.505          |
| 1,000  | `albumOwnRows10`  | 12       | 1.065        | 1.165             | 1.067          |
| 1,000  | `artistRows2`     | 2        | 1.184        | 1.254             | 1.206          |
| 1,000  | `artistPage50`    | 40       | 1.946        | 2.074             | 2.056          |
| 1,000  | `genreOwnRows`    | 335      | 4.510        | 4.702             | 4.288          |
| 1,000  | `fullSongs`       | 1,000    | 12.364       | 12.806            | 12.552         |
| 1,000  | `songRows50`      | 50       | 0.984        | 1.093             | 1.069          |
| 12,000 | `artistOwnRows20` | 23       | 1.573        | 1.564             | 1.577          |
| 12,000 | `albumOwnRows10`  | 12       | 1.234        | 1.143             | 1.113          |
| 12,000 | `artistRows2`     | 2        | 17.922       | 18.158            | 17.461         |
| 12,000 | `artistPage50`    | 50       | 28.786       | 28.585            | 28.311         |
| 12,000 | `genreOwnRows`    | 4,001    | 52.825       | 52.924            | 48.917         |
| 12,000 | `fullSongs`       | 12,000   | 173.215      | 170.577           | 173.586        |
| 12,000 | `songRows50`      | 50       | 1.027        | 1.031             | 1.162          |
| 50,000 | `artistOwnRows20` | 23       | 1.426        | 1.432             | 1.619          |
| 50,000 | `albumOwnRows10`  | 12       | 1.025        | 1.074             | 1.143          |
| 50,000 | `artistRows2`     | 2        | 79.167       | 80.384            | 78.596         |
| 50,000 | `artistPage50`    | 50       | 125.786      | 129.373           | 125.877        |
| 50,000 | `genreOwnRows`    | 16,668   | 225.986      | 227.305           | 217.788        |
| 50,000 | `fullSongs`       | 50,000   | 778.568      | 779.325           | 749.678        |
| 50,000 | `songRows50`      | 50       | 0.997        | 1.003             | 1.045          |

#### Bounded SQL probes, without changing production

Raw evidence: [boundedReads](results/596-boundedReads-desktop.jsonl), including artist query plans. The scoped artist experiment places the requested IDs inside both credited-song UNION branches and checks complete artist rows/counts against the actual store. The genre experiment uses the selected worktree's actual `trackQuery` and `BY_TITLE` with its genre predicate and `LIMIT 50`; it checks the complete first 50 rows against the full result. It is only a prefix experiment: sort/selection/Play/Shuffle and invalidation are not implemented here. A genre page can still scan/sort matching data internally even when just 50 rows cross to JS.

| Songs  | Probe                            | SQL rows | SQL | Current median ms | Current p90 ms | Longest ms |
| ------ | -------------------------------- | -------- | --- | ----------------- | -------------- | ---------- |
| 1,000  | `artistRows2/globalCredits`      | 2        | 1   | 1.340             | 1.562          | 2.921      |
| 1,000  | `artistRows2/scopedCreditsProbe` | 2        | 1   | 0.547             | 0.566          | 0.573      |
| 1,000  | `genre/allRows`                  | 335      | 2   | 5.260             | 7.424          | 7.946      |
| 1,000  | `genre/first50Probe`             | 50       | 1   | 1.887             | 2.385          | 2.478      |
| 12,000 | `artistRows2/globalCredits`      | 2        | 1   | 21.244            | 23.583         | 24.522     |
| 12,000 | `artistRows2/scopedCreditsProbe` | 2        | 1   | 0.505             | 0.560          | 0.562      |
| 12,000 | `genre/allRows`                  | 4,001    | 2   | 65.003            | 97.087         | 98.892     |
| 12,000 | `genre/first50Probe`             | 50       | 1   | 7.392             | 8.140          | 8.209      |
| 50,000 | `artistRows2/globalCredits`      | 2        | 1   | 87.638            | 92.436         | 101.150    |
| 50,000 | `artistRows2/scopedCreditsProbe` | 2        | 1   | 0.494             | 0.676          | 0.690      |
| 50,000 | `genre/allRows`                  | 16,668   | 2   | 263.960           | 271.017        | 284.113    |
| 50,000 | `genre/first50Probe`             | 50       | 1   | 26.552            | 26.935         | 27.362     |

The global artist plan scans `track_artists` and materializes the credit UNION before the outer artist filter. The scoped probe searches the artist index instead. Returning only two rows is therefore insufficient as a performance guard: the follow-up needs access-plan and unrelated-Library-growth evidence too. Existing #311 already scoped artist _play history_; this is the separate artist _metadata/count_ query.

#### Complete song reads in task-sized slices

Raw evidence: [songReadSlices](results/596-songReadSlices-desktop.jsonl). A real task yield separates keyset pages (`id > cursor`, `ORDER BY id`, `LIMIT`). All SongRow fields are decoded using each worktree's actual projection. Every run checks the complete identity set against `listSongs`, without claiming title-order or snapshot-under-write equivalence. The final empty read accounts for the extra statement at these exact-multiple sizes.

| Songs  | Traversal            | SQL  | Total median ms | Total p90 ms | Step p90 ms | Longest task ms |
| ------ | -------------------- | ---- | --------------- | ------------ | ----------- | --------------- |
| 1,000  | `fullSongRows`       | 1    | 16.379          | 18.935       | —           | 19.712          |
| 1,000  | `keysetSongRows/50`  | 21   | 27.889          | 29.910       | 1.625       | 3.356           |
| 1,000  | `keysetSongRows/100` | 11   | 19.270          | 20.450       | 2.226       | 3.296           |
| 1,000  | `keysetSongRows/250` | 5    | 15.235          | 16.711       | 3.901       | 4.980           |
| 12,000 | `fullSongRows`       | 1    | 185.144         | 187.723      | —           | 204.858         |
| 12,000 | `keysetSongRows/50`  | 241  | 260.026         | 262.964      | 1.226       | 2.795           |
| 12,000 | `keysetSongRows/100` | 121  | 200.681         | 201.892      | 1.826       | 3.207           |
| 12,000 | `keysetSongRows/250` | 49   | 165.245         | 167.710      | 3.872       | 4.942           |
| 50,000 | `fullSongRows`       | 1    | 856.911         | 1,309.574    | —           | 1,572.758       |
| 50,000 | `keysetSongRows/50`  | 1001 | 1,068.625       | 1,088.379    | 1.184       | 3.050           |
| 50,000 | `keysetSongRows/100` | 501  | 829.031         | 885.191      | 1.918       | 3.774           |
| 50,000 | `keysetSongRows/250` | 201  | 681.665         | 686.315      | 3.819       | 5.171           |

### Async SQLite decision

**Keep the synchronous driver and remove/target/slice the measured work first. No production read is selected for an async-driver conversion by #596.** This is a decision about the next implementation, not proof that synchronous SQLite meets phone budgets.

At 12,000 songs the whole-song traversal takes 185.144 ms in one task; 50-row slices take 260.026 ms total with 1.226 ms step p90 and 2.795 ms maximum observed task. The targeted 50-song read is 1.031 ms, and the scoped two-artist metadata probe is 0.505 ms. These support bounded reads rather than returning an entire Library to JS on a tap. A larger page is a measured throughput/responsiveness tradeoff, not a fixed 6 ms guarantee. GC and host scheduling can exceed the step budget even for small pages; use adaptive sizing/cancellation and validate on Hermes.

An async database call also leaves Core playlist ranking (402.509 ms at 12,000 songs, zero SQL) and graph derivation on JavaScript. Those require stepped computation and fewer invocations. Recap availability should cache by history version/calendar boundary, and compute its small answer after settled, rather than repeatedly scanning history on every unchanged focus. Likewise, hidden playlist subscriptions need pausing/coalescing, independent of the SQLite API.

The installed expo-sqlite 58.0.11 source exposes `SQLiteDatabase.getAllAsync`, asynchronous statement execution and native off-thread database work. This sweep does **not** benchmark that Android API: sql.js plus a Promise or `setImmediate` is not an emulator of native SQLite, and a Promise wrapper around `.all()` remains synchronous. Migrating the current synchronous Drizzle store would change transaction/read contracts and would still require bounded result decoding and Core transforms. A whole-store rewrite is unsupported by these numbers.

The largest unavoidable history/catalog reads remain candidates for a **separate measured native experiment** only if targeting and smaller indexed slices still exceed the 6 ms step / 16 ms read budgets on the owner's phone. Compare the exact same projection and data on sync pages versus native async pages, including marshal/decode time, JS transform steps, transaction visibility, cancellation and frame gaps. Preserve local calendar Recap semantics and cross-version results. The current genre LIMIT probe and global artist-page query show why a small output alone cannot establish a bounded query; fix or measure the SQL plan before treating async as the remedy. Pending #546/#318 hardware work is not marked passed by this decision.

### Findings, ticket handoff, and log correlation

Four measured follow-ups are published under #579: #598 (Recap availability), #599 (playlist recommendation work and retained renewals), #600 (bounded artist credit counts), and #601 (genre first rows). Exact ticket bodies, a blocker manifest and the publication audit are preserved under `/tmp/wave-open-tickets-83613fc6/596-new-tickets/` and `596-published-tickets.json`. Shared Artist graph measurements are handed to existing #594, which the latest #584 guard explicitly names as owner of `home/artistGraph.ts#readArtistGraph`. Live open/closed issue bodies were searched before drafting. #592–#595 do not cover the Recap reader or recommendation session; #558/#559 specify recommendation behavior without visibility/step bounds. Closed #309/#310/#311/#312 are prior implementations with different seams, documented in the deduplication evidence. The two inherited findings are explicitly labeled. The published bodies, labels and native #579 parent/blocker links were verified. Existing #594 received the shared Artist graph scope and measurements while retaining its original #592 blocker; no duplicate graph ticket was created. These tickets track implementation; the research does not claim their fixes are complete.

The #580 every-build read timing boundary is now present in this integration. Expected `WaveTiming` operation names are `sum up counted listening` (Home), `read playlist recommendations` (playlist or a hidden session), `read the taste history`, `list songs`, `list artists` (graph segment), `read ranked artists` (targeted metadata) and `open the genre`. The log's operation row count describes the public result, while benchmark `rowsRead` includes intermediate SQL rows: for example playlist logging counts its 50 membership rows plus Library rows, not all 15 statements' returned rows. Hidden work is logged with the _currently visible_ route, which may differ from the owning playlist. CPU-only ranking/graph work has no slow-SQL line; use the transition/hitch evidence from #582. These are expected correlations from code, not fabricated phone log lines.

The five public-seam characterization tests in `src/library/db/regressionSweep.test.ts` use the shared 1,000-song fixture: repeat Recap work for an unchanged result; one/two retained recommendation sessions and unsubscribe; global-versus-scoped artist plan/count equivalence; full genre hydration versus its exact first page; and all graph history/Library rows occupying the same middle segment. They assert work/results, never elapsed time. They document the current failure modes; each implementation ticket must replace them with improved work bounds and add its own behavioral cases. No production behavior changed in this research commit.

## Streamed artist links (#586)

[Recorded JSONL](results/579-streamedArtistLink-desktop.jsonl) contains eleven timed
runs after a warm-up plus a separate traced work-count run, at exactly 500, 5,000
and 20,000 active artists (one song and album per artist). Credits and album-artist
links are complete before store startup; the bench asserts that startup preserves
the artist count and checks exact fixture artist ids for complete lookups.

These are desktop Node v26.8.2 + sql.js numbers. The measured implementation is
`fe09d574ad48d7b1fcb679e7065c994a3143f335`, before is v0.19.0-ti
`460e39ff0cba6f50e7a456a77d6e99813295ebaa`, and reference is v0.7.0-ti
`add761ed787061db6a6c2799687d421301b6182b`. The two baselines load their
actual versioned cache, LibraryStore, finder and Core decision. The native/React
hook is replayed because it cannot mount in Node; its source gate is checked
before replay. Both historical revisions already had the unread-artist gate.
This fixes that inherited wait; it does not attribute its introduction to the
post-v0.7.0 changes.

Cold and offline availability time is work until a link can exist, excluding DB
opening and React/native frame scheduling. Before, that means the whole artist
read and finder build. After, the immediate target is `unread`, with zero SQL and
zero cache notifications. Warm availability uses a standing requested-name cache.
Historical tap costs use the already-built finder: a tap was possible only after
the historical availability wait. After, a cold tap resolves its names using
128-row keyset pages with real task yields and a 500 ms deadline. Thus this moves
lookup work to the gesture and bounds it; it does not remove all lookup work.

| Artists | v0.7.0 cold line ms | ti cold line ms | After cold line ms (p90) | After warm line ms | After offline line ms | Artist rows before → after |
| ------: | ------------------: | --------------: | -----------------------: | -----------------: | --------------------: | -------------------------: |
|     500 |               4.134 |           3.733 |            0.023 (0.030) |              0.008 |                 0.006 |                    500 → 0 |
|   5,000 |              35.172 |          35.730 |            0.005 (0.006) |              0.006 |                 0.005 |                  5,000 → 0 |
|  20,000 |             142.448 |         146.343 |            0.004 (0.005) |              0.006 |                 0.005 |                 20,000 → 0 |

After tap costs below include real yields. “Offline miss” resolves an absent
artist to an offline YT target; the separate app opening policy test asserts the
note is immediately drawable and starts no request. Warm taps read nothing.
Complete lookup has no deadline and is a semantic comparison measurement, not
the app's tap behavior.

| Artists | Tap case      | Median ms |  p90 ms | Returned rows | SQL statements | Notifications | Timed deadline outcomes / 11 |
| ------: | ------------- | --------: | ------: | ------------: | -------------: | ------------: | ---------------------------: |
|     500 | First         |     1.009 |   1.146 |           129 |              2 |             1 |                            0 |
|     500 | Middle        |     3.104 |   3.208 |           257 |              3 |             1 |                            0 |
|     500 | Last          |     6.830 |   7.639 |           501 |              5 |             1 |                            0 |
|     500 | Missing       |     6.717 |   6.802 |           500 |              4 |             1 |                            0 |
|     500 | Warm          |     0.006 |   0.007 |             0 |              0 |             0 |                            0 |
|     500 | Offline miss  |     6.783 |   7.069 |           500 |              4 |             1 |                            0 |
|     500 | Complete last |     6.891 |   7.076 |           501 |              5 |             1 |                            0 |
|     500 | Complete miss |     5.983 |   6.118 |           500 |              4 |             1 |                            0 |
|   5,000 | First         |     0.773 |   0.795 |           129 |              2 |             1 |                            0 |
|   5,000 | Middle        |    36.846 |  38.374 |         2,561 |             21 |             1 |                            0 |
|   5,000 | Last          |    71.332 |  79.479 |         5,001 |             41 |             1 |                            0 |
|   5,000 | Missing       |    71.441 |  72.582 |         5,000 |             40 |             1 |                            0 |
|   5,000 | Warm          |     0.006 |   0.006 |             0 |              0 |             0 |                            0 |
|   5,000 | Offline miss  |    72.628 |  73.676 |         5,000 |             40 |             1 |                            0 |
|   5,000 | Complete last |    72.295 |  74.681 |         5,001 |             41 |             1 |                            0 |
|   5,000 | Complete miss |    72.576 |  74.283 |         5,000 |             40 |             1 |                            0 |
|  20,000 | First         |     0.703 |   0.737 |           129 |              2 |             1 |                            0 |
|  20,000 | Middle        |   145.085 | 147.625 |        10,113 |             80 |             1 |                            0 |
|  20,000 | Last          |   287.210 | 292.441 |        20,001 |            158 |             1 |                            0 |
|  20,000 | Missing       |   286.654 | 288.936 |        20,000 |            157 |             1 |                            0 |
|  20,000 | Warm          |     0.006 |   0.006 |             0 |              0 |             0 |                            0 |
|  20,000 | Offline miss  |   287.158 | 289.698 |        20,000 |            157 |             1 |                            0 |
|  20,000 | Complete last |   285.113 | 287.089 |        20,001 |            158 |             1 |                            0 |
|  20,000 | Complete miss |   286.008 | 288.305 |        20,000 |            157 |             1 |                            0 |

All eleven timed cold samples for every first/middle/last/missing/offline case
completed in this recording; each had zero destination mismatches. Warm samples
needed no lookup. The 20,000-artist last-page median was 287.210 ms, p90 292.441 ms.
The recovery brief reports a prior busy-host last-page lookup reaching 500 ms;
its raw evidence was lost, so it is not substituted for this recording. A busier
host may still hit the bound and open YT even when the Library has that artist.

The JSONL reports `timedOutcomes`, `completedLookups`, `deadlineFallbacks`, actual
`timedDestinations` and `destinationMismatches` independently. In particular, a
missing artist can time out to the expected YT page: destination equality alone
would not prove lookup completion. A mismatched bounded tap is accepted only
when its outcome is explicitly `deadline` and its destination is YT. The separate
`completeLookup/last` and `/missing` keys must match exact destinations across all
three revisions or the command fails. Availability compares link existence,
not a still-unread destination. No destination-equivalence assertion is made
for a bounded sample that falls back.

Rows/statements/notifications come from the separate traced run. Tracing adds
EXPLAIN overhead and may itself hit the deadline sooner; its actual target and
outcome are retained separately. CPU and maximum timed synchronous read/Core
segments are in the JSONL. That maximum excludes page-normalization and microtask
bookkeeping; it is not a complete event-loop stall measurement. Yield wall time,
GC and host load remain desktop effects, not phone latency.

Focused tests use Core's public exports and the actual app gesture/LibraryStore
seams with sql.js: an unread menu entry dispatches a Library destination, local
Now Playing reads credits on its tap, cold first/middle/last/missing lookups have
fixed SQL work, warm taps read nothing, and cancellation/version changes do not
publish stale cache entries. Core's mock-clock test exercises the deadline,
abort and late completion deterministically. Existing #584 guard/route, #585
immediate-link and #589 scoped opening/deferred finder tests remain passing.
React/native navigation, Android first-frame rendering, S24+ latency and TalkBack
have not been exercised.

```sh
pnpm --silent --filter @wave/mobile bench:fast-again --bench streamedArtistLink \
  --before /path/to/v0.19.0-ti --reference /path/to/v0.7.0-ti
```

## Detail opening evidence (#591)

The production album data boundary now leaves its local rows independent of
YouTube, defers the integrated artist/release requests and shared finder until
local content and screen settlement, and checks validated Android connectivity
when a request executes. Artist, Library album, named/browse-id YT artist and
remote album/playlist openings can render offline immediately. A late album
answer appends additions after the local rows; downloads replace their streamed
row, and the original multi-disc headers remain in place. #586's offline route
hint and retry, #585's dispatch/watchdog and #584's route observer restriction
are preserved. Popular's full policy remains #590's work; its existing path
cannot ask with Online off, before local content/settlement, or while offline.

The [album JSONL](results/579-albumFromArtist-desktop.jsonl) and
[offline JSONL](results/579-offlineOpening-desktop.jsonl) use 11 measured runs at
1,000, 12,000 and 50,000 songs on Node v26.8.2/linux-x64 with sql.js. The measured
after revision is `0ad5d2ef5e375cc334bad4aaa40c827531857d35`, ti is
`460e39ff0cba6f50e7a456a77d6e99813295ebaa` (v0.19.0-ti), and reference is
`add761ed787061db6a6c2799687d421301b6182b` (v0.7.0-ti). Baseline worktrees are
under the stable #591 scratch directory, without source edits. Each result
records the selected root/commit and source hashes; modules use the actual
selected-worktree LibraryStore and Core. No native or RN source is rewritten
for these replays.

### Album: local tracklist and companion opening work

Reading the historical `app/library/album/[id].tsx` disproves a stronger latency
claim: **both historical screens already fall back to local tracks while
YouTube is pending** (`entries === null ? albumItems(tracks) : ...`). What is
eager is the whole-Library finder subscription in `albumSection.ts` and the
empty album download helper in `YtSongList.tsx`; they share one cold songs query.
The finder is lazy and is not built while an empty/unanswered section makes no
lookup. The joined online list waits for the answer. This was already present
in v0.7.0-ti, rather than introduced between these two historical tags.

`detailOpeningReplay.ts` faithfully replays those source-owned reads and the
selected Core view. The fixed replay calls the same app `albumOpening` used by
the hook, with the real album/link/saved-answer reads. Native transport, React
commit/effect order and layout are not measured. `localTracklist` times only the
actual album query. `openingWithColdFollowers` includes synchronous companion
opening work and must not be presented as a measured RN paint time or as a wait
for a YouTube answer. Its request field is the replayed opening policy, not a
wire counter. `joinedTracklist` measures matching after a controlled answer,
including a cold finder; it excludes network latency. Each opens the target
artist's ten-track album; the integrated saved artist answer is seeded outside
timing.

Desktop median / p90 milliseconds:

| Library songs | Work                     |          v0.7.0-ti |           ti before |              after |
| ------------: | ------------------------ | -----------------: | ------------------: | -----------------: |
|         1,000 | Local tracklist query    |      1.119 / 1.160 |       1.167 / 1.244 |      1.335 / 1.368 |
|         1,000 | Opening + cold followers |    13.650 / 14.145 |     14.260 / 15.088 |      1.845 / 2.038 |
|         1,000 | Later joined tracklist   |    16.378 / 16.925 |     18.064 / 18.587 |    17.905 / 21.350 |
|        12,000 | Local tracklist query    |      1.096 / 1.142 |       1.057 / 1.133 |      1.155 / 1.203 |
|        12,000 | Opening + cold followers |  167.594 / 173.933 |   170.920 / 176.228 |      1.533 / 1.673 |
|        12,000 | Later joined tracklist   |  216.338 / 231.094 |   321.052 / 480.152 |  221.829 / 236.757 |
|        50,000 | Local tracklist query    |      1.146 / 1.978 |       1.046 / 1.134 |      1.173 / 1.208 |
|        50,000 | Opening + cold followers | 767.987 / 1091.076 |   791.101 / 867.112 |      1.469 / 1.619 |
|        50,000 | Later joined tracklist   |  980.285 / 998.386 | 1001.309 / 1062.174 | 982.893 / 1013.490 |

The local query returns 12 SQL rows in three statements (ten song rows plus
album/genre metadata) in every variant. With the seeded answer, companion
opening work falls from N + 14 returned SQL rows / six statements to 14 rows /
five statements: **ten song rows, not the Library's N + ten**. Both old routes
schedule the integrated request while opening; the fixed policy schedules none
until local content and settlement. Complete local and joined entry payloads
are checked for equality between revisions; the reference's absent explicit
flag is normalized to the current `unknown`, with other fields preserved.
The independent row-placement test deliberately puts an online song ahead of
local songs in the response and verifies that the fixed page keeps its already
drawn local prefix, including disc furniture.

The cold joined phase still returns all N songs in one deferred statement;
#591 moves that work off the opening boundary and does not claim to page or
speed up the shared finder. Its 50,000-song cost remains visible above.

### Offline: no transport response needed

The offline fixture models `NET_CAPABILITY_INTERNET` without
`NET_CAPABILITY_VALIDATED` (for example a captive portal or an unvalidated
handover). Historical native `YtClient.request` checks `hasNetwork()` and may
therefore attempt a request; current page openings use validated `online()`.
This distinction matters: on airplane mode, old native code can already reject
immediately. These numbers must not be described as an observed airplane-mode
network timeout.

The fake API never answers. A fixture transport deadline reports offline after
20 ms for the before/reference replay; the native request timeout is 20,000 ms
in `YtClient.kt`, **not the measured fixture delay**. After uses the production
execution guard and receives offline without invoking that API. The artist
and album replay includes their local opening reads; the named YT artist's
note requires no Library finder, artist list or saved-answer restoration. This
is a desktop data/effect experiment, not Android connectivity or frame timing.

Desktop median / p90 milliseconds to offline note:

| Library songs | Page            |         v0.7.0-ti |          ti before |         after |
| ------------: | --------------- | ----------------: | -----------------: | ------------: |
|         1,000 | Artist          |   34.092 / 34.830 |    36.107 / 37.468 | 2.932 / 4.116 |
|         1,000 | Album           |   33.909 / 34.256 |    35.238 / 35.965 | 2.349 / 2.464 |
|         1,000 | Named YT artist |   35.516 / 35.949 |    36.243 / 36.736 | 0.009 / 0.018 |
|        12,000 | Artist          | 193.562 / 216.736 |  201.473 / 206.334 | 2.301 / 2.398 |
|        12,000 | Album           | 198.403 / 205.165 |  201.960 / 204.811 | 2.026 / 2.068 |
|        12,000 | Named YT artist | 232.681 / 239.187 |  244.799 / 250.120 | 0.005 / 0.006 |
|        50,000 | Artist          | 796.726 / 822.135 |  819.481 / 843.857 | 2.227 / 2.291 |
|        50,000 | Album           | 794.380 / 812.452 |  819.450 / 854.193 | 1.930 / 1.989 |
|        50,000 | Named YT artist | 960.715 / 996.185 | 984.990 / 1046.377 | 0.005 / 0.006 |

The fake transport is invoked once in each historical replay and zero times
after. The fixed named YT artist note reads zero Library rows/statements; the
artist case returns 23 local SQL rows/four statements and the album returns
13/five at every size (including their own metadata/restoration reads, not
whole-Library rows). JSONL records CPU, SQL counts, longest synchronous phase,
zero read-only subscriber notifications, source hashes and the injected
connectivity/deadline conditions. All variants reach the same `offline` note.
Neither the injected 20 ms deadline nor these Node/sql.js numbers promise
Android/Hermes latency or a measured phone improvement.

### Behavioral checks and reproduction

`albumOpening.test.ts` traces the actual store and calls the production app
album boundary: a 1,000-song Library returns ten song rows for its ten-track
album, with no request due before settlement. The historical-store replay
fails that assertion at 1,010 song rows. A controlled pending release leaves
the local list usable; resolving it appends the missing online track without
moving local rows. Separate cases preserve row positions across download and
keep the initial multi-disc furniture. `detailOpening.test.ts` gives the
production execution guard an API that never resolves, changes connectivity
after scheduling, and observes an immediate offline result with zero calls.
Core public tests cover initial restoration, Settings off, Library/Online,
readiness, settlement, offline and retries. The existing #586 offline helper,
link dispatch and #585 independent watchdog tests remain passing.

```sh
pnpm --filter @wave/mobile bench:fast-again --bench albumFromArtist \
  --before /home/servidor-azul/.t3/scratch/wave-implement-spec-3781dabb/591-before \
  --reference /home/servidor-azul/.t3/scratch/wave-implement-spec-3781dabb/591-reference
pnpm --filter @wave/mobile bench:fast-again --bench offlineOpening \
  --before /home/servidor-azul/.t3/scratch/wave-implement-spec-3781dabb/591-before \
  --reference /home/servidor-azul/.t3/scratch/wave-implement-spec-3781dabb/591-reference
```

These are desktop app-data/store and effect-boundary tests, not mounted React
Native interaction or accessibility tests. Device, animation/frame and TalkBack
behavior remains unverified. No Android performance percentage is inferred.

## homeOpening cold-launch evidence (#592)

Home now mounts a section-shaped shell before mounting any read-backed child, including
Recap and Discover focus effects. Recently added, plays and Favorites publish independently;
their loading state is distinct from an answered empty array. Rankings and Listening overview
keep their own queries. Nonempty placeholders/content share bounded body reservations;
Discover uses song/playlist shapes and the existing adaptive grid. Recap availability also
reserves its card's place until its answer. Empty sections/absent Recaps still disappear,
an empty Library keeps its empty state, and the first-play hint waits for plays.

The Home content timing marker follows the first answered slice. Discover's saved mix rows
can draw with plays unread, but its focus due checks wait for that input rather than running
first with a fictitious false and again with true. No #584 policy exception or route observer
was added; #589 and the merged #586 behavior are preserved.

### Baseline and replay scope

This is **desktop Node + sql.js evidence, not Hermes, native SQLite or measured phone paint**.
The command was run sequentially, with eleven measured repetitions per size:

```sh
pnpm --silent --filter @wave/mobile bench:fast-again --bench homeOpening --before /home/servidor-azul/.t3/scratch/wave-implement-spec-3781dabb/592-before > docs/performance/results/579-homeOpening-desktop.jsonl
```

- Before: `460e39ff0cba6f50e7a456a77d6e99813295ebaa` (`v0.19.0-ti`).
- After: `959f628290878be622b31167719655b46df29d23`, including integration
  `74a50f50dfa5cef60e0d13e958a2606f5f21662b`.
- Reference source check: `add761ed787061db6a6c2799687d421301b6182b` (`v0.7.0-ti`)
  already had the same all-three-slices `useHome` barrier and conditional section mount.
  This ticket removes that inherited barrier; it claims no new regression attribution or
  reference timing result.

The replay loads each selected revision's actual LibraryStore, Stats and Core. It includes
all three local slices, Recap availability, the shared album/artist ranking, counts and
listening sums, the Magic Queue's whole-Library map/due check, and both mixes' known-video
reads, due checks, saved blends and captions. Hash equality covers every local payload,
Recap periods, ranking, overview inputs, nine pick ids, both known-video answers and all
eight blended mixes/captions. All three before/after hashes match; the JSONL runner fails
on a mismatch. The recorded file has sixteen valid desktop-labelled JSONL records,
including six measurements and the three-row comparison.

Cold means a fresh screen query cache with today's picks and both mix sets already saved,
YT Music on, the default arrangement and offline harvest. The selected modules and SQLite
are warmed; migrations, fixture seeding and saving choices are outside measurement. Actual
due checks confirm no taste derivation or mix build is due in this case. These costs are
omitted because the app does not start them, rather than being silently excluded from a
due build. First-of-day, targeted picks, versioned known videos, stepped taste/mix work and
return-to-Home belong to #593/#594.

“First frame” in this comparison means the first frame bearing section bodies. ti can draw
a title-only frame earlier, but its section tree waits for all three slices. The new shell
has no Library-read dependency: the first rAF callback still starts no read; only the second
allows read-backed children to mount. This is a dependency/work count, not a claim about
native display timing. Cached preferences still use the existing KV-setting adapter.

### Cold-launch work

All numbers are before → after. SQL rows count results returned to JavaScript, not SQLite
VM visits. All listed cold-Home readers are included through the replay's conservative
settlement horizon, even readers that may finish after the first local content is visible.
That horizon is not a replay of the WaveTiming settlement timer. With standing choices and
offline harvest, this scenario schedules no further reads after that horizon.

| Library songs | Play events | First-frame statements | First-frame SQL rows | All replay SQL rows | All replay statements |
| ------------: | ----------: | ---------------------: | -------------------: | ------------------: | --------------------: |
|         1,000 |      10,000 |                  6 → 0 |              104 → 0 |       8,541 → 8,541 |               16 → 16 |
|        12,000 |      54,000 |                  6 → 0 |              104 → 0 |     23,401 → 23,401 |               16 → 16 |
|        50,000 |     200,000 |                  6 → 0 |              104 → 0 |     69,761 → 69,761 |               16 → 16 |

At 1,000 songs, Recently added answers with 24 SQL rows/two statements, plays with 70/three,
and Favorites with 10/one. The production query descriptors, real store and shared query
registry are exercised in the work-count test with Favorites and plays answering while
Recently added remains pending. A Favorites change schedules no new plays/added read.
Independent content does not wait for the unrelated slices. Cancellation, answered-empty
versus unread state, first-play hint, Recap availability and bounded dimensions are covered too.

### Cold-launch synchronous work (desktop ms)

The median/p90 below are the sum of each run's timed synchronous operations. CPU is mean
process CPU per run; the maximum is the longest observed individual operation across the
eleven runs. Elapsed replay time and every step's work/timing are in the JSONL. Scheduled
steps yield between operations as the app's query timer adapter does; this is not an
async-SQLite simulation. React/render/layout, native paint, KV-setting reads, network,
startup jobs and animation/scheduler waits are outside these times.

| Library songs |  Sum sync median ms |     Sum sync p90 ms |         Mean CPU ms | Maximum sync task ms |
| ------------: | ------------------: | ------------------: | ------------------: | -------------------: |
|         1,000 |     41.592 → 43.674 |     42.750 → 49.816 |     46.136 → 53.759 |      16.717 → 18.932 |
|        12,000 |   352.504 → 353.989 |   361.954 → 376.745 |   402.730 → 412.063 |    231.150 → 241.331 |
|        50,000 | 1653.809 → 1580.776 | 1741.588 → 2454.886 | 1874.536 → 1966.439 |  1194.339 → 1897.877 |

This change removes the drawing barrier; it does not reduce aggregate reads or claim a
CPU/longest-task speed-up. The whole-Library Magic Queue read/map remains the longest step
and is retained in both paths. Timing tails, especially 50,000 songs, vary substantially on
this shared desktop; another checkout's benchmark was detected around the end of capture.
No own test/typecheck was run alongside the timing command, and capture started after
waiting for the earlier CPU-heavy validation to finish. Keep the raw tail samples instead
of inferring a timing win from this run. Phone performance and TalkBack remain unverified.

## Standing Home picks and stepped taste (#593)

Measured code: `0582d00945f1e1ef9194ab5e1a7d70f2c1b06426` (#593 on local
integration `f7a77992`). Before is the actual `v0.19.0-ti` source,
`460e39ff0cba6f50e7a456a77d6e99813295ebaa`, from a detached worktree. Captured
on Linux x64 (8 cores, shared with other sessions), Node v26.8.2 and sql.js,
eleven runs at each size. These are warmed **desktop replays** of the data and
effect work, not phone/Hermes latency or native frame measurements. No
v0.7.0-ti timing is claimed: the Magic Queue row and profile came after it.

The row's read resolves only its saved ids, at most nine, in saved order, and
follows only those songs' track and favorite changes. Native scan batches now
carry the ids they saved, so an unrelated scan save doesn't reread the row;
unknown global edits stay conservative (the bounded nine-song read). A short
list alone follows a one-id growth probe. A removed song drops out in place and
its replacement waits for settlement. Pull, Undo and the shared live profile
are kept; a pull isn't cancelled by leaving Home, a due pick is.

A due pick waits for Home's settled signal, then the existing free-turn
scheduler. Cancelled, it releases its pending turn and iterator and saves
nothing; the previous picks show meanwhile. One song/artist read feeds both the
shared live taste profile and the pick. Artist-key and song mapping, scoring,
weighted sums and draws and shown-today accumulation are generator steps; the
consumer (`src/lib/stepped.ts#runSteps`) stops a task after four ms of work or
512 steps, two ms short of the six-ms target. Signal order, IEEE additions and
random draw order are ti's. A deferred derivation drops only the signals that
came meanwhile and that its history snapshot holds, so each counts once.

### Taste derivation

Run `pnpm --silent --filter @wave/mobile bench:fast-again --bench tasteProfile
--before <v0.19.0-ti worktree>`. Raw evidence:
[593-tasteProfile-desktop.jsonl](results/593-tasteProfile-desktop.jsonl).
`firstDerivation` is the first live profile: all source SQL, mapping and
scoring. Both variants read songs and artists once each: five statements
(three history projections, one song query, one artist query). `scoreCpuOnly`
holds identical inputs outside the timing and isolates the Core scorer (ti's
`tasteProfile`; after, `tasteProfileSteps` through `runSteps`).

| Songs / plays    | Scope           | SQL rows before → after | Total median / p90 ms before → after      | Mean CPU ms before → after | Longest task ms before → after |
| ---------------- | --------------- | ----------------------- | ----------------------------------------- | -------------------------- | ------------------------------ |
| 1,000 / 10,000   | firstDerivation | 11,190 → 11,190         | 36.145 / 36.718 → 39.110 / 42.628         | 40.998 → 55.728            | 37.298 → 20.890                |
| 1,000 / 10,000   | scoreCpuOnly    | 0 → 0                   | 2.465 / 3.026 → 3.745 / 3.860             | 4.300 → 5.093              | 3.520 → 0.254                  |
| 12,000 / 54,000  | firstDerivation | 68,280 → 68,280         | 350.217 / 380.999 → 356.332 / 362.122     | 470.442 → 472.054          | 381.764 → 186.158              |
| 12,000 / 54,000  | scoreCpuOnly    | 0 → 0                   | 22.296 / 23.888 → 25.973 / 27.317         | 26.425 → 28.882            | 29.667 → 0.557                 |
| 50,000 / 200,000 | firstDerivation | 259,500 → 259,500       | 1551.041 / 1599.158 → 1502.189 / 1555.741 | 2009.678 → 1932.586        | 1646.834 → 870.524             |
| 50,000 / 200,000 | scoreCpuOnly    | 0 → 0                   | 117.507 / 132.431 → 155.546 / 310.188     | 164.150 → 203.388          | 139.983 → 6.438                |

Every before/after pair has the same result key: the complete profile, every
song, artist and genre score, exact numbers and map insertion order. The
scoring steps' longest task is 0.2 to 1.6 ms in all runs but the last two at
50,000, which reached 5.2 and 6.4 ms while the run's total time doubled: the
target is cooperative, and a GC pause or the OS taking the core can't be cut
short from JavaScript. An earlier capture under heavier load from other
sessions (kept in the notes, not here) had one 9.7 ms scoring task at 12,000.
Stepping costs total time; it buys scheduling points, not a cheaper scorer.
The full derivation still has indivisible synchronous SQLite reads (with row
decoding), so its longest task is **not** six ms: 870 ms at 50,000 songs, down
from ti's single 1,647 ms task. Those reads run only in the explicit
background work, after settlement; paging them is #594's shared source-paging
work, not done here.

### First Home of a day

Run `pnpm --silent --filter @wave/mobile bench:fast-again --bench homeOpening
--before <v0.19.0-ti worktree>`. Raw evidence:
[593-homeOpening-desktop.jsonl](results/593-homeOpening-desktop.jsonl).
`coldLaunch` is the existing cold Home with standing picks; its Magic Queue
step is the row's read. `firstHomeOfDay` is new: yesterday's nine picks show
through every opening read, then the due work runs on free turns (the first
live profile, the pick, the new row's read). ti's replay is its focus update:
the row's whole-Library map, then `TasteProfile.live` reading history, songs
and artists again, in one task.

| Songs  | Scope                | SQL rows before → after | Statements before → after | Total median / p90 ms before → after      | Longest task ms before → after |
| ------ | -------------------- | ----------------------- | ------------------------- | ----------------------------------------- | ------------------------------ |
| 1,000  | Magic Queue row read | 1,040 → 9               | 2 → 1                     | 16.656 → 0.766 (median)                   | 17.265 → 1.123                 |
| 12,000 | Magic Queue row read | 12,480 → 9              | 2 → 1                     | 225.029 → 0.776 (median)                  | 230.068 → 0.851                |
| 50,000 | Magic Queue row read | 52,000 → 9              | 2 → 1                     | 1005.993 → 0.787 (median)                 | 1070.939 → 0.974               |
| 1,000  | coldLaunch           | 8,541 → 7,510           | 16 → 15                   | 42.936 / 43.123 → 28.132 / 31.663         | 17.265 → 18.065                |
| 12,000 | coldLaunch           | 23,401 → 10,930         | 16 → 15                   | 361.386 / 368.718 → 135.671 / 144.507     | 230.068 → 77.183               |
| 50,000 | coldLaunch           | 69,761 → 17,770         | 16 → 15                   | 1552.403 / 1607.660 → 540.615 / 550.481   | 1070.939 → 326.909             |
| 1,000  | firstHomeOfDay       | 19,731 → 18,709         | 21 → 21                   | 78.994 / 81.035 → 68.392 / 71.607         | 55.704 → 20.053                |
| 12,000 | firstHomeOfDay       | 91,681 → 79,219         | 21 → 21                   | 723.146 / 743.365 → 517.227 / 533.082     | 415.133 → 207.725              |
| 50,000 | firstHomeOfDay       | 329,261 → 277,279       | 21 → 21                   | 3913.976 / 8736.542 → 2175.493 / 2248.536 | 4863.051 → 829.010             |

Each pair has the same result key: every cold-Home payload and, for the first
Home of a day, the complete profile, all pick fields and the new row's ordered
songs. The first Home of a day reads songs once (ti twice: the row's map and
the profile's). The remaining longest tasks are other Home readers and the
whole-source SQL reads named above. ti's 50,000 p90 and longest task were taken
while another session's work shared the machine; treat that row's tail as
noise. Phone performance and TalkBack are unverified.

## Playing row identities after a download (#588)

Desktop: Node v26.8.2 and sql.js on Linux x64, **not Hermes or the phone's
SQLite**. The full harness uses 11 measured runs at each of 1,000, 12,000 and
50,000 songs, with both the 20-song and 300-song target artists. Machine-readable
results: [579-playingIdsFanout-desktop.jsonl](results/579-playingIdsFanout-desktop.jsonl).

Before is `v0.19.0-ti`, `460e39ff0cba6f50e7a456a77d6e99813295ebaa`. Its
native hook is faithfully replayed through that revision's actual Core query
registry, finder cache, recording finder and LibraryStore songs read. After is
`38f748dcaa4ed6b97f0714330812323573a832c4`, running production `createPlayingIds`,
Core registry, download bus and `LibraryStore.matchingSong`. Both produce exactly
the same streamed and local row identities for every case; the harness rejects
a mismatch. The original #538 transition is `yt:<video>` alone, then that same
stream id plus the matched Library id after download, without changing playback.

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/fastAgain.ts \
  --bench playingIdsFanout --before /path/to/v0.19.0-ti-worktree
```

Ti already shares its broad query and lazy finder, so this bench does not invent
eight broad reads. Five warmed tabs and three pushed screens give eight mounted
consumers, with one visible. A completion refreshes one source subscription in
both paths. Ti reads the whole Library once, rebuilds its finder once and notifies
the visible consumer; hidden ones catch up on show. After reads one matching row
once and builds no finder. Its changed identity snapshot notifies all eight
consumers immediately. The work-count test separately proves unchanged snapshots
notify zero consumers and unrelated downloads start zero reads. These are actual
callbacks and SQL rows returned, not React render counts or SQLite VM visits.

| Library songs | Target artist songs | Rows before → after | Re-reads before → after | Whole-Library finder builds before → after | Source refreshes before → after | Consumer notifications before → after |
| ------------: | ------------------: | ------------------: | ----------------------: | -----------------------------------------: | ------------------------------: | ------------------------------------: |
|         1,000 |                  20 |           1,000 → 1 |                   1 → 1 |                                      1 → 0 |                           1 → 1 |                                 1 → 8 |
|         1,000 |                 300 |           1,000 → 1 |                   1 → 1 |                                      1 → 0 |                           1 → 1 |                                 1 → 8 |
|        12,000 |                  20 |          12,000 → 1 |                   1 → 1 |                                      1 → 0 |                           1 → 1 |                                 1 → 8 |
|        12,000 |                 300 |          12,000 → 1 |                   1 → 1 |                                      1 → 0 |                           1 → 1 |                                 1 → 8 |
|        50,000 |                  20 |          50,000 → 1 |                   1 → 1 |                                      1 → 0 |                           1 → 1 |                                 1 → 8 |
|        50,000 |                 300 |          50,000 → 1 |                   1 → 1 |                                      1 → 0 |                           1 → 1 |                                 1 → 8 |

| Library songs | Target artist songs | Median ms before → after | p90 ms before → after | CPU ms before → after | Longest measured task ms before → after |
| ------------: | ------------------: | -----------------------: | --------------------: | --------------------: | --------------------------------------: |
|         1,000 |                  20 |           21.115 → 2.140 |        24.257 → 2.351 |        27.680 → 1.675 |                          27.384 → 1.179 |
|         1,000 |                 300 |           18.484 → 2.082 |        19.928 → 2.569 |        21.874 → 1.235 |                          19.337 → 1.185 |
|        12,000 |                  20 |          277.886 → 2.525 |       437.383 → 2.777 |       364.240 → 1.591 |                         437.661 → 1.340 |
|        12,000 |                 300 |          223.638 → 2.439 |       246.513 → 2.522 |       281.576 → 1.528 |                         254.276 → 1.323 |
|        50,000 |                  20 |         1005.994 → 1.976 |      1036.367 → 2.096 |      1239.095 → 0.941 |                        1055.720 → 0.922 |
|        50,000 |                 300 |         1037.580 → 1.901 |      1239.215 → 2.019 |      1382.495 → 0.949 |                        1949.373 → 0.919 |

The timed scope is completion subscriber work. Database opening, initial reads,
fixture changes and the SQL write representing completion are outside it. Ti's
1.5-second query burst throttle is matured with a virtual clock, so it does not
inflate wall time. Longest task is the maximum source-event or synchronous
read-through-last-notification segment, including registry settlement and identity
processing; SQL tracing runs separately from timed samples. These are desktop
work/latency measurements, with no native scheduling, React commit, frame or
TalkBack verification. The one-time upgrade backfill of the persisted title index
is also outside completion measurements: it reads/writes at most 128 rows per
transaction and yields between pages before exposing LibraryStore.

## #587 — Now Playing song followers

Desktop: Node 26.8.2 + sql.js, Linux x64; **not Hermes or phone SQLite**.
The full shared harness ran 11 samples per measure at 1,000, 12,000 and
50,000 songs (the shared 20/300-song target artists and 10,000/54,000/200,000
play events). Run:

```sh
pnpm --filter @wave/mobile bench:fast-again --bench nowPlayingOpen \
  --before <v0.19.0-ti worktree> --reference <v0.7.0-ti worktree>
```

Evidence: [579-nowPlayingOpen-desktop.jsonl](results/579-nowPlayingOpen-desktop.jsonl).
Before is `460e39ff0cba6f50e7a456a77d6e99813295ebaa` (`v0.19.0-ti`);
after is `6ac48b40eb45204dedd25fd043d26303a3d419f4`, based on integration
`1ec7108ef9daf9339196cdceb60feb60c63bff9a`. The selected worktrees' actual
LibraryStore and Core run on the same shared fixture shape; the JSONL includes
source hashes and SQL/query plans. This is a faithful read/lifecycle replay,
not mounted React or native animation. The `v0.7.0-ti` reference
`add761ed787061db6a6c2799687d421301b6182b` predates these streamed controls:
its measures explicitly report unavailable.

The cold ti replay reads songs, favorite ids and pending favorites, then builds
the lazy finder on its first song lookup. Its star may also start this work
while the sheet is hidden; the cold scenario resets all three shared queries
and the finder at opening to expose that cost. The fixed controls select a
target while opening, then share one statement for its identity, file and
library/pending stars after settlement or their own early gesture.

| Songs  | Cold opening rows / statements before → after | Opening median / p90 ms before → after | Targeted lookup after settlement median / p90 ms | Longest opening task ms before → after |
| ------ | --------------------------------------------- | -------------------------------------- | ------------------------------------------------ | -------------------------------------- |
| 1,000  | 1,100 / 3 → 0 / 0                             | 17.589 / 18.662 → 0.002 / 0.003        | 0.670 / 0.712                                    | 19.002 → 0.005                         |
| 12,000 | 13,200 / 3 → 0 / 0                            | 209.242 / 211.769 → 0.000 / 0.000      | 0.755 / 1.143                                    | 224.530 → 0.000                        |
| 50,000 | 55,000 / 3 → 0 / 0                            | 1752.574 / 3022.081 → 0.000 / 0.000    | 0.594 / 0.615                                    | 3684.358 → 0.000                       |

After settlement the fixed path reads **one candidate row in one statement**
at every size; ti's already acquired answer reads nothing at that stage.
Rows mean SQL rows returned to JS, including the stars' rows; they do not count
SQLite VM visits. The 50,000-song tail varies on this shared host: it is
desktop scheduling/GC noise as well as the synchronous read, not a phone budget.

Warm means the shared songs query, finder, favorite ids and pending stars were
already acquired before opening; the fixed sheet's independent targeted answer
is initially unread. Both warm openings read **zero rows/statements**; the
fixed sheet still acquires its single targeted statement after settlement.

| Songs  | Warm opening median / p90 ms before → after | Targeted lookup after settlement median / p90 ms |
| ------ | ------------------------------------------- | ------------------------------------------------ |
| 1,000  | 0.000 / 0.000 → 0.000 / 0.000               | 0.614 / 0.706                                    |
| 12,000 | 0.000 / 0.000 → 0.001 / 0.001               | 1.188 / 1.318                                    |
| 50,000 | 0.001 / 0.001 → 0.000 / 0.000               | 0.594 / 0.606                                    |

`springStartCold` and `springStartWarm` separately time the actual Core opening
decision at the spring-handoff boundary. **Both revisions hand off the spring
before notifying followers**: these measures read nothing and round to
0.000–0.001 ms median. Zero is rounding to three decimals, not zero CPU work.
No removed read is falsely charged before the spring starts. The first visible
state compares title/artist/album and the rising spring; ti's internal `open`
phase and #585's newer `opening` phase both mean shown here. The gain is removing
cold follower work during the spring, not changing the ordering of that handoff.

Every comparable before/after result key is equal, including the **complete**
matched SongRow (identity/path, all metadata; legacy absent explicit means
unknown) and saved library/pending star flags. CPU, p90, longest task, statement
and notification counts remain in the raw JSONL. Metadata/artwork come from the
playing item; native paint, Reanimated scheduling and animation waits are omitted.

Deterministic app/store tests assert zero reads before settlement and one indexed
statement after, shared across consumers; early playlist/download/star actions
retain their captured song, resolve missing-file and pending-star state, and
ignore canceled or superseded lookup results. Four exact #587 guard exceptions
were retired without changing the scanner or route guard. Device behavior,
phone latency and TalkBack remain unverified.

## Startup after settlement and quiet frames (#595)

Final integrated capture: [`results/595-homeOpening-desktop.jsonl`](results/595-homeOpening-desktop.jsonl).
Real ti `460e39ff0cba6f50e7a456a77d6e99813295ebaa` is compared with
`ae990c2c2dd341a658f0f7763099c2848cdb3cb9`, including #592/#593/#588/#587/#594.
All three sizes have eleven samples. See [`595-startup-work.md`](595-startup-work.md)
for production boundaries, exact startup scenario and native exclusions. This is
Node/sql.js, not phone/Hermes latency or an owner-exported tap log. Earlier #595
captures from before #594 and the interrupted/smoke runs are excluded here.

At 1,000 / 12,000 / 50,000 songs, complete cold replay maximum synchronous tasks
are **17.813 → 17.312 / 282.011 → 83.652 / 1451.040 → 421.332 ms**. Median total
synchronous JS is 58.039 → 55.779 / 568.683 → 251.161 / 2545.397 → 1118.638 ms.
These whole-Home differences include earlier integrated work, especially #592,
#593 and #594, and must not be attributed entirely to #595.

Startup maximum tasks are **7.767 → 8.072 / 116.736 → 83.652 / 536.397 → 421.332 ms**.
Median startup synchronous JS is 17.354 → 30.140 / 164.535 → 130.150 /
786.069 → 593.216 ms. Startup uses nine timed tasks before, versus 43 / 127 / 419
after. The smaller case pays extra transaction/scheduling overhead; neither a
universal speedup nor a six-ms complete-task maximum is claimed.

Complete cold SQL returns 10,772 / 49,172 / 176,852 rows before and
9,548 / 33,978 / 113,398 after, in 57 versus 178 statements. Startup returns
2,231 / 25,771 / 107,091 rows before and 2,088 / 23,648 / 98,128 after, in 41
versus 164 statements. Extra statements come from the retained 20-song import's
one-song append transactions and their atomic held-entry reads. Rows are returned
rows, not SQLite VM visits. All nine cross-variant result keys agree: complete
cold payloads/scanner inputs/startup outcomes, first-of-day and unchanged return.
The return case delivers startup's playlist invalidation and refreshes that source
outside its independent warm-return measurement; after that unchanged returns
perform zero known-video SQL, preserving #594's contract.

The source SQL/row decoding, linking/pruning and one-record atomic writes remain
visible in task totals. No per-source cost is invented or subtracted, and the
individual cause of each maximum is not isolated. CPU iterators target four ms
with headroom, while named indivisible source/native operations, metadata, GC
and OS pauses can exceed six ms. The final **421.332-ms** startup maximum stays
visible. The owner's exported cold-launch first-tap log and native/device
acceptance remain **unverified**.

## #594: versioned Home mixes and bounded shared graph

Measured production/harness commit: `ae61f2b2e4a4f994ca088696bb8eed4c53d2d478`;
before: actual v0.19.0-ti `460e39ff0cba6f50e7a456a77d6e99813295ebaa`.
Node v26.8.2 + sql.js, Linux x64, shared eight-core host, 11 timed runs after
warmup at 1,000 / 12,000 / 50,000 songs (10,000 / 54,000 / 200,000 plays).
These are desktop task boundaries, not Hermes, native paint or phone frame times.
R6 evidence was recaptured because its graph tracing emitted null maxima and
integrated source/CPU boundaries changed. Exact source/tree and evidence hashes,
loader fidelity, and scope are recorded in
[`594-source-audit.json`](results/594-source-audit.json).

The graph reader uses indexed keyset projection pages, including cursor advance
through unreadable catalog/pages and deleted events. Core derives names, session
pairs and weighted edges in cancellable generator steps. Every cold graph consumer
enters the shared settlement/free-turn gate; warm and concurrent readers reuse the
same source version. Invalidation and last-consumer cancellation abort old work.
A waiter of an invalidated read waits on the read after it, never the old answer,
for at most four reads in all; disposal releases all waiters. The actual store, explicit schedulers and shared
fixture are tested, including a cold playlist and mix/Magic Queue graph request.
The playlist input/ranking/session lifecycle remains #599's work.

Home's automatic mix jobs run serially after settlement and keep saved mixes
visible. A source change restarts an overtaken build. Known videos share a version
until a track/download, play, playlist or streamed-song change; favorites/folders
preserve it. An unchanged Home mix return executes zero SQL. Mix input/catalog
reads and Core ranking/seeding/indexing/sorting yield. The final audit additionally
fixed familiar-share artist lookup and the empty-credit profile walk, with public
Core work-count tests that first failed at 1,400 visits in one operation.

The historical loader remains lazy and loads the selected revision's Core and SQL
modules without rewriting source. The graph fixture populates 1,200 catalog songs,
2,400 radios and 80 saved similar pages alongside the Library/history. Complete
ordered graph names and edge maps/weights match ti at all three sizes. Mix keys
include complete saved Artist/Genre sections, familiar shares, seeds, metadata,
variety and every seed/variety random draw. Home keys include complete visible
payloads, not counts alone. Every run and cross-revision comparison passes.

### Graph task work

Raw evidence: [`594-graphSlices-desktop.jsonl`](results/594-graphSlices-desktop.jsonl).
SQL rows are returned rows, not SQLite VM visits. Columns show before → after;
longest is the maximum task across all 11 timed runs. Total is median elapsed replay.

| Songs  | SQL rows        | Statements | Mean CPU ms         | Total ms            | Longest task ms  | Max SQL rows in one task |
| ------ | --------------- | ---------- | ------------------- | ------------------- | ---------------- | ------------------------ |
| 1,000  | 14870 → 13680   | 8 → 193    | 120.508 → 159.009   | 101.399 → 141.751   | 66.823 → 1.494   | 11190 → 128              |
| 12,000 | 71960 → 57680   | 8 → 879    | 649.782 → 819.364   | 483.728 → 712.794   | 765.511 → 5.378  | 68280 → 128              |
| 50,000 | 263180 → 203680 | 8 → 3161   | 2374.084 → 2375.836 | 1793.533 → 2155.249 | 1641.948 → 5.338 | 259500 → 128             |

### Daily Artist then Genre builds

Raw evidence: [`594-mixBuild-desktop.jsonl`](results/594-mixBuild-desktop.jsonl).
This replay uses the actual store/Core and production stepped adapters. It isolates
#594 with identical null taste, offline saved catalog inputs and enough played seeds
that neither revision needs similar-page fallback. React/KV writes, network/harvest
and scheduler wait time are excluded. Increased returned rows/statement count reflect
paged sources and genre/credit projections; no reduction in total work is claimed.

| Songs  | SQL rows        | Statements | Mean CPU ms         | Total ms            | Longest task ms   |
| ------ | --------------- | ---------- | ------------------- | ------------------- | ----------------- |
| 1,000  | 18930 → 27840   | 19 → 315   | 182.143 → 348.133   | 150.313 → 309.478   | 43.243 → 4.69     |
| 12,000 | 108140 → 149280 | 19 → 1605  | 2362.654 → 2072.394 | 3027.94 → 1561.411  | 1489.436 → 25.773 |
| 50,000 | 410320 → 556800 | 19 → 5931  | 7395.217 → 7136.573 | 6602.192 → 6377.353 | 4256.614 → 6.51   |

### Unchanged Home mix return

Raw evidence: [`594-homeOpening-desktop.jsonl`](results/594-homeOpening-desktop.jsonl).
Both saved mix sections run their due checks and complete blends/captions with the
shared known-video answer. Mounted local/pick payloads are retained; ancillary
feature-owned focus work is outside this return case.

| Songs  | SQL rows | Statements | Mean CPU ms   | Total ms      | Longest task ms |
| ------ | -------- | ---------- | ------------- | ------------- | --------------- |
| 1,000  | 100 → 0  | 2 → 0      | 0.792 → 0.234 | 0.729 → 0.228 | 0.786 → 0.248   |
| 12,000 | 1200 → 0 | 2 → 0      | 5.221 → 0.525 | 4.305 → 0.34  | 6.861 → 0.519   |
| 50,000 | 5000 → 0 | 2 → 0      | 17.937 → 0.47 | 17.48 → 0.451 | 18.853 → 0.565  |

All replays above are read-only and report **zero notifications**; this is not a
React commit counter. Raw files also retain synchronous-total and longest-task
percentiles, task counts, page work and complete semantic keys.

### Cooperative target and remaining acceptance

`stepped.ts` is byte-identical to integrated #593: a 4 ms budget, 512-operation cap,
fresh task before each CPU stage, and iterator closure on cancellation. The graph's
longest tasks in this capture were 1.494 / 5.378 / 5.338 ms. Mix tasks reached
4.690 / **25.773** / **6.510** ms. At 12k the per-run longest-task median/p90 was
4.013 / 13.377 ms; at 50k it was 4.545 / 6.100 ms. These overshoots are retained.
The capture does not identify their individual SQL/GC/OS cause, and the cooperative
adapter cannot preempt an individual operation or promise a hardware 6 ms maximum.
Paging and extra yields also have measurable total/CPU overhead.

Home's separate `firstHomeOfDay` scenario still includes #593's unpaged songs,
artists and history, as well as other feature-owned readers. Its after longest
tasks were **20.075 / 186.368 / 867.441 ms**; cold-Home longest tasks were
**17.890 / 88.293 / 309.581 ms**. These are not claimed fixed by #594.
**#593 source paging and source/6 ms acceptance remain open.** #594 provides tested
`tastePlaysPage` (including endReason), `tasteFavoritesPage`, `tasteDownloadsPage`
and `mixSongsPage(..., { genres: false })` for that follow-up; its consumers were
not migrated here. #598 still owns ancillary Recap reads.

Android/Hermes, native frame behavior and TalkBack have not been exercised for this
change. No device responsiveness or strict 6 ms guarantee is inferred from this
shared-host desktop capture. The implementation and source/work-count checks are
reviewable independently of that remaining device evidence.

### #594 integration audit: bounded mix diagnostics

The integration merge preserves the original eleven-run JSONL files byte for byte,
including the **25.773 ms at 12k** and **6.510 ms at 50k** mix maxima. Source hashes
and every comparison cell, complete semantic key and size/read grid were validated
against the committed files. Measured runtime/harness files remain unchanged.

A separate, bounded diagnostic ran one warmup, one traced and three timed builds
sequentially at 12k and 50k. It adds task labels, process CPU, generator-operation
wall times, GC intervals and a 500-us inspector profile. This instrumentation adds
overhead; its timings do not replace the original capture. The full saved-mix and
random-draw keys still match the original evidence at both sizes. See
[`594-merge-mix-diagnostic.jsonl`](results/594-merge-mix-diagnostic.jsonl), which
records per-run limits, every task over 6 ms and hashes of the stable scratch
scripts, complete task records and CPU profiles.

Timed maxima were **4.720 ms at 12k** and **6.299 ms at 50k**. The 50k overshoot
was labeled `mixArtistsPage`, used 6.665 ms of process CPU and had no overlapping
observed GC. Approximately aligned CPU samples were in sql.js/SQLite beneath that
read; profiler-start RPC overhead was not measured. A separate 50k warmup task of
15.372 ms overlapped an 11.236 ms major-GC interval. These observations establish
neither the cause of the original overshoots nor a hardware deadline. No repeatable
divisible generator operation over 6 ms was observed; production code was unchanged.
**Strict 6 ms acceptance remains open.**

The added real-store regression checks all mix/graph/taste page APIs at nonzero
cursors: actual driving rowid/key seeks, equal-time history's second seek key,
combined history-page row bounds, the genres query's upper bound, and indexed
artist-count/credit lookups. Actual plans are retained in
[`594-merge-query-plans.json`](results/594-merge-query-plans.json). Aggregate
co-routines still scan one artist's indexed track/album matches, and stored JSON
processing scales with one payload; a 128-row output bound does not bound every
SQLite VM visit or make a native call preemptible. #593 whole-source paging,
#595 startup and #598 Recap retain their existing ownership. Device, Hermes,
native frames and TalkBack remain unverified.

## Home Recap availability (#598)

Raw capture: [`598-recapAvailability-desktop.jsonl`](results/598-recapAvailability-desktop.jsonl).
Measured source/harness: `33d6a2303b6c3f8d766bc964d884f7ff5c010918`, including
integration `494e26dbb15d9bf427a5e42c79ec5e730342af99` and #595's startup gate.
Before is actual ti `460e39ff0cba6f50e7a456a77d6e99813295ebaa`;
reference is `add761ed787061db6a6c2799687d421301b6182b`. The reference predates
Home Recaps, so all four cases explicitly remain unavailable. The original
#596 research JSONL is unchanged; this fix-specific successor measures the shared
availability lifecycle. Node v26.8.2 + sql.js 1.14.2, Linux x64, eleven timed runs
after warmup at 1,000 / 12,000 / 50,000 songs and 10,000 / 54,000 / 200,000 plays.
This completed recovery capture supersedes the inherited WIP capture. The full
Core/mobile suites completed before measurement. Other worktrees were active on
the shared host; these are observed wall/task times, including host scheduling
and GC variation, rather than an isolated hardware limit. The final recovery
commit changes only this evidence and documentation; measured runtime code is unchanged.

Reproduce from the repository root with source-only historical checkouts:

```sh
pnpm --silent --filter @wave/mobile bench:fast-again --bench recapAvailability \
  --before <v0.19.0-ti worktree> --reference <v0.7.0-ti worktree>
```

The selected revision's actual Stats, LibraryStore and Core execute on identical
fixtures. The current path uses the production retained cache; ti replays its
focus-triggered eager Effect. Visibility, clock and free turns are controlled.
Each measured cold run uses a fresh cache. The other cases first acquire and hide
the answer outside measurement, then return unchanged, persist one progress
update, or advance to the next local month. The write is restored outside timing
before the next run/scenario/registered bench. Every ordered available period and
its announcements for no, each individual, and all opened ids match ti at every
size, including the boundary and changed-history cases.

Values below are milliseconds, before → after, in the size order above. Total is
median elapsed replay; synchronous total excludes scheduler waits, while longest
is the maximum task over all eleven samples. Task boundaries include activation,
actual SQL/derivation segments and final cache publication, split by injected
`setImmediate` free turns. Ti's synchronous read inside activation is counted
once. Fixture setup, database/store initialization, warmup and the change write
are outside measurement. CPU, p90, synchronous totals and per-run maxima/task
counts are retained in the JSONL.

- **Cold:** total 15.199 → 29.375 / 29.538 → 67.156 / 87.311 → 180.037;
  longest 16.249 → 2.390 / 30.925 → 1.032 / 93.029 → 0.923.
- **Unchanged return:** total 14.577 → 0.070 / 30.778 → 0.071 / 88.810 → 0.071;
  longest 16.470 → 0.071 / 36.047 → 0.071 / 92.296 → 0.070.
- **Changed history:** total 14.294 → 28.186 / 29.681 → 65.882 / 96.092 → 175.367;
  longest 15.253 → 2.313 / 30.275 → 0.750 / 127.736 → 0.819.
- **Calendar boundary:** total 14.597 → 27.474 / 29.692 → 65.704 / 90.693 → 171.444;
  longest 24.374 → 1.986 / 31.036 → 0.908 / 101.396 → 0.962.

Every ti case returns 7,200 / 8,640 / 8,640 SQL rows in one statement and notifies
one consumer. Current **unchanged returns execute zero reads, rows, statements
and notifications**. Cold, changed-history and boundary refreshes each return
7,222 / 8,831 / 9,399 rows in 20 / 106 / 391 statements. Current notifications
are 1/1/1 cold, 0/0/0 after the progress update (same periods), and 0/1/1 at the
calendar boundary (only changed periods publish). Counts cover one availability
subscriber, not React commits. Rows count SQL results, not SQLite VM visits.

Each current statement seeks by event id and materializes at most **512 raw
events**, returning at most 513 rows including its cursor. Observed statement
maxima are 371 / 84 / 25 rows. Quarter sums crossing page boundaries and the
cursor rows explain the slightly larger aggregate row totals. Calendar policy
stays in Core; local month/year/December/January thresholds retain the existing
rules. SQL/CPU paging adds total work; this capture claims smaller blocking tasks
and no repeated unchanged read, not lower cold CPU or a hardware deadline.

Public store/cache tests replace #596's repeated 7,200-row characterization with
zero unchanged-return work and one shared refresh after invalidation. They cover
actual timing settlement, immediate sheet coverage, hidden coalescing, bounded
page cancellation, stale/error recovery, threshold crossings, imports/progress/
replays/sync pages, opened ids, local month/year boundaries and timezone/clock
changes. Two recovery regressions additionally cover hiding between deferred
scheduling and reader entry, and crossing a month boundary before reader entry.
#595's quiet-frame/startup job/import-resume tests still pass; its implementation
and source invalidation are preserved. Exact #584 declarations protect the
legacy history reader, paged source and Stats capability, permitting only the
bounded deferred seam in production.

Expected every-build log correlation: unchanged Home/Now Playing returns no
longer invoke `sum up counted listening`; cold/stale refreshes use `read counted
listening page` after settlement. The whole-history operation remains only as an
inventoried compatibility/control driver, with no production Stats consumer.
The existing broad `homeOpening` replay still includes its historical whole-history
Recap control and is not the production #598 lifecycle; its saved measurements
are not revised or attributed to this fix. **Actual phone evidence that the
`sum up counted listening` lines disappear remains unverified**, as do Android/
Hermes latency, native frames and TalkBack. These desktop results do not establish
phone frame times or a strict six-ms maximum.

## #600: scope artist metadata counts before deduplication

Raw evidence: [boundedReads](results/600-boundedReads-desktop.jsonl), with source hashes and methodology in [source audit](results/600-source-audit.json). Measured production/harness commit: `cd3beb1a2324cb263e64d59ca512b1f25946143f`. Baseline: integration tip `2aae3bb887effdc56b8cec9ffb05091fde29a4f0`; regression reference: v0.7.0-ti `add761ed787061db6a6c2799687d421301b6182b`. Each variant runs its actual `LibraryStore.artistsByIds` / `listArtistsPage`, on an identical migrated synthetic database. Complete artist rows also match faithful pre-#600 SQL frozen from `2aae3bb8`; the runner compares full semantic keys across all three revisions.

```sh
pnpm --silent --filter @wave/mobile bench:fast-again --bench boundedReads \
  --before /home/servidor-azul/.t3/scratch/wave-implement-spec-3781dabb/600-before \
  --reference /home/servidor-azul/.t3/scratch/wave-implement-spec-3781dabb/586-reference
```

Desktop Node/sql.js only, eleven timed runs after warm-up. CPU is mean process CPU per run; longest is the maximum complete synchronous read. Plans, credit observation, setup and result hashing stay outside timings. This is a shared-host capture: other ticket benchmarks/tests and a focused artist test overlapped it. Results are retained without rerunning to select faster numbers. They do not establish isolated-host latency, Android/Hermes latency or phone frame gains.

`artistsByIds` now applies requested IDs in both credit branches, before UNION deduplication. Page reads first materialize eligible artists in `(sort, id)` order with LIMIT/OFFSET and scope-correct EXISTS membership; both count branches seek only those selected IDs. Artwork and albumCount lookup stay on the resulting artists. UNION keeps each collaboration once per artist; album-only credits, compilation/Appears on, file/missing membership and the existing primary-album count (including empty retained albums) are unchanged. No migration or cache was added. Unpaged whole-list reads still count the whole list.

The uninstrumented plans use `track_artists_artist_idx`, `album_artists_artist_idx`, `tracks_album_idx` and `albums_album_artist_idx`. Pages walk `artists_sort_idx` before counting. UNION, GROUP BY and final ORDER BY can still use temporary B-trees, scoped to selected credits/rows. Tests assert intended index access rather than an exact plan dump.

The real store diagnostic operations remain **`read ranked artists`** and **`list artists`**, included as `readTimingName` in the raw evidence. A controlled-clock public store test verifies those labels and row counts; that test makes no latency assertion. Physical-device exported read timing remains unexercised.

|  Songs | Read                           | Rows | Statements | Before median ms | After median ms | After p90 ms | After CPU ms | After longest ms |
| -----: | ------------------------------ | ---: | ---------: | ---------------: | --------------: | -----------: | -----------: | ---------------: |
|  1,000 | `artistsByIds/2`               |    2 |          1 |            1.377 |           0.750 |        1.135 |        1.604 |            1.140 |
|  1,000 | `listArtistsPage/50`           |   40 |          1 |            2.176 |           3.211 |        3.468 |        4.009 |            3.486 |
|  1,000 | `listArtistsPage/10`           |   10 |          1 |            2.039 |           1.557 |        1.641 |        1.911 |            1.789 |
|  1,000 | `listArtistsPage/deep10`       |   10 |          1 |            2.054 |           1.085 |        1.289 |        1.399 |            1.321 |
|  1,000 | `artistsByIds/2+unrelated`     |    2 |          1 |            2.212 |           0.553 |        0.578 |        0.711 |            0.650 |
|  1,000 | `listArtistsPage/10+unrelated` |   10 |          1 |            3.251 |           1.520 |        1.739 |        1.953 |            2.504 |
| 12,000 | `artistsByIds/2`               |    2 |          1 |           18.967 |           0.492 |        0.504 |        0.492 |            0.508 |
| 12,000 | `listArtistsPage/50`           |   50 |          1 |           29.786 |           5.072 |        5.322 |        5.380 |            5.428 |
| 12,000 | `listArtistsPage/10`           |   10 |          1 |           29.803 |           1.201 |        1.257 |        1.382 |            1.280 |
| 12,000 | `listArtistsPage/deep10`       |   10 |          1 |           30.433 |           1.711 |        1.871 |        1.737 |            1.965 |
| 12,000 | `artistsByIds/2+unrelated`     |    2 |          1 |           31.183 |           0.493 |        0.516 |        0.511 |            0.563 |
| 12,000 | `listArtistsPage/10+unrelated` |   10 |          1 |           45.211 |           1.266 |        1.609 |        1.469 |            1.641 |
| 50,000 | `artistsByIds/2`               |    2 |          1 |           99.178 |           0.744 |        0.960 |        0.768 |            0.992 |
| 50,000 | `listArtistsPage/50`           |   50 |          1 |          153.895 |          11.054 |       13.010 |       11.298 |           13.240 |
| 50,000 | `listArtistsPage/10`           |   10 |          1 |          159.817 |           1.858 |        2.595 |        2.016 |            2.602 |
| 50,000 | `listArtistsPage/deep10`       |    0 |          1 |          166.983 |           9.757 |       10.222 |        8.435 |           10.694 |
| 50,000 | `artistsByIds/2+unrelated`     |    2 |          1 |          202.725 |           0.499 |        0.518 |        0.506 |            0.533 |
| 50,000 | `listArtistsPage/10+unrelated` |   10 |          1 |          249.030 |           1.299 |        1.337 |        1.331 |            1.357 |

The growth case adds another 1k/12k/50k unrelated tracks and their credits to each corresponding base Library, with a new artist sorting after the fixed ten-row page (`offset: 3`). Complete target/page results remain identical. The two IDs evaluate 320 track-credit keys and 32 album-credit keys at every size, before and after growth. The fixed page evaluates respectively 903/45, 553/27 and 613/30 track/album keys, also unchanged by growth. Baseline/reference credit work grows. These are identity-function observations via temporary views, not VM instruction counts; functions can affect join planning, so tests also check raw plans and uninstrumented result equality. All observed values and raw plans are published.

Paging is not a constant-work guarantee. OFFSET must check preceding eligible artists; nonmembers must also be rejected. In file scope, an artist with only missing tracks may require visiting every relevant missing credit before exclusion. The deep probe uses `offset = floor(size / 25) - 10`: at 50k it returns zero rows after examining memberships, and still takes 9.757 ms median (10.694 ms longest). It observes 2,960 track-key and 100 album-key evaluations despite returning no rows. Count work for an empty selected page is empty, but membership/order work remains with this API and current indexes. For a page covering all 40 artists at 1k, there is no count reduction and membership adds overhead: 2.176 ms baseline versus 3.211 ms after. Both negative results are retained.

Public real-SQLite tests cover full legacy equivalence over IDs/pages in both scopes, duplicate track/album credits, album-only artists, compilations/Appears on, missing-only and removed artists, retained empty albums, null/present artwork and tied sort keys. A deterministic growth guard adds 1k, then 12k, then 50k unrelated tracks and asserts unchanged full results and credit evaluations; the same observer detects the old global traversal. #596's global-UNION characterization is replaced with indexed bounded-read acceptance.

`mixArtistsPage` from #594 has separate correlated SQL in `db/mixInputs.ts`; this change does not touch it or improve its SQL budget, including the previously reported 6.299 ms diagnostic. #593's narrow IDs/names projection is independent. No claim is made that #600 resolves those timing limits.

## #601: open a genre on an indexed first page

Raw evidence: [genreOpening](results/601-genreOpening-desktop.jsonl), with source revisions and hashes in the [source audit](results/601-source-audit.json). Measured read implementation: `1701ced2620414464da25c325b0083a7ae40463d`. Baseline: v0.19.0-ti `460e39ff0cba6f50e7a456a77d6e99813295ebaa`; regression reference: v0.7.0-ti `add761ed787061db6a6c2799687d421301b6182b`. All variants use the same current migrated synthetic schema/data. The selected revision's actual `LibraryStore` and Core are loaded without source rewriting. The historical replay is `getGenre` followed by that revision's `sortSongs` and the visible summary projection; v0.7's absent explicit field is projected as the migration default, `unknown`.

```sh
pnpm --silent --filter @wave/mobile bench:fast-again --bench genreOpening \
  --before /home/servidor-azul/.t3/scratch/wave-implement-spec-3781dabb/586-before \
  --reference /home/servidor-azul/.t3/scratch/wave-implement-spec-3781dabb/586-reference
```

Desktop Node/sql.js only, eleven timed runs after warm-up. These are data-ready replays, excluding React, navigation, native paint and scheduler quiet waits. Cold/known describe whether the header came from the opening query or an already known list row; SQLite and modules are warm in both cases. A known header alone performs zero SQL work. First content runs the same bounded query in both cases. All eight sort choices compare the complete summaries, counts and order to each historical module, for the first page and a traversal of every page. A mutation case retitles a song, makes it missing and removes another from the genre; write setup is outside read timings.

The production screen uses `openGenre`: one narrow header/count/revision row and at most fifty `SongSummary` rows, without full SongRow hydration or a JS sort. The known header draws before that read. `genreOrderSlice` reads up to 500 ordered IDs/missing flags/spine letters per free turn after settlement (or on demand for an action). Browsing reuses #310's bounded summary cache; the opening seeds its first page and notifies it without rereading those rows. Play, Shuffle and taps await the whole genre order, and selection starts only once that order exists, so Select All sees the complete genre. Full selection action rows read fifty per free turn and are released/cancelled when selection ends. A genre change remounts its local state; disposed loads and aborted row reads cannot publish late results.

Migration 0038 backfills a genre sort table and eight complete indexes (title, artist, album and date added, both directions). Index terms end in file path and ID, preserving Core's stable ties even for a genre of identical names. The derived table uses `WITHOUT ROWID` so SQLite includes ID in composite seeks, including an entirely missing identical-name genre; a rowid alias would leave the final ID comparison as a filter. Triggers maintain the keys and per-genre revisions across inserts, deletes, genre moves, file changes and artist/album sort changes; unchanged scan keys do not invalidate cursors. A stale cursor is rejected and the cooperative reader restarts, rather than stitching revisions together. These indexes add storage and write maintenance; they are not a free cache. No async SQLite driver conversion is made.

First and later page plans seek `genre_order_<sort>_<direction>`, with a composite range after a cursor, and primary-key track/artwork lookups. The header count uses `tracks_genre_idx`. There is no OFFSET or temporary ORDER BY B-tree, including for all-identical-name fixtures. Descending reverses only the primary key, retaining ascending ties: the reader finishes that run, then seeks lower primary values. Plans at all three sizes are retained in the raw evidence; public work tests assert index/range access and reject any temporary sort.

This is a shared-host capture: another ticket's `playlistRenewal` benchmark and other mobile tests overlapped it. Wall times and maximum tasks include contention, GC and scheduling pauses; results are retained without choosing faster reruns. Earlier captures were stopped when stronger regressions exposed prefix-only tie sorting and a final rowid comparison applied as a filter; both are retained in scratch as intermediate evidence, not published as the final implementation. The final capture is not an isolated-host latency claim. Cooperative all-page traversal deliberately returns more SQL rows and uses more total work than one historical full read: it reads narrow IDs and later summaries while bounding each request. Its median/p90 describe total synchronous work across turns, not one opening task. A strict 6 ms maximum, Android/Hermes latency, frames, TalkBack and physical-phone `open the genre` log evidence remain unverified.

The #596 full-genre-hydration characterization is replaced with the public 1,000-song opening bound (51 returned SQL rows, replacing 335). Behavioral tests also cover all pages and sorts, missing files and duplicate-name runs, cursor rejection/restarts after edits, complete playback/selection context beyond page one, stale-loader cancellation, seeded-row notifications, and upgrades from a populated 0037 database. The screen keeps #500's Find-disabled behavior by using an unconditional genre list, and preserves existing row components for missing downloads, stars, current-playing state, long-press actions and accessibility. Device behavior is not claimed from these desktop tests.

|  Songs | Read                            | SQL rows before → after | Statements before → after | Before median ms | After median ms | After p90 ms | After CPU ms | After longest ms | v0.7 median ms |
| -----: | ------------------------------- | ----------------------: | ------------------------: | ---------------: | --------------: | -----------: | -----------: | ---------------: | -------------: |
|  1,000 | `header/known`                  |                   0 → 0 |                     0 → 0 |            0.000 |           0.001 |        0.002 |        0.005 |            0.002 |          0.000 |
|  1,000 | `title/asc/first50/coldHeader`  |                335 → 51 |                     2 → 2 |           12.054 |           3.062 |        4.961 |        3.422 |            5.728 |         10.240 |
|  1,000 | `title/asc/first50/knownHeader` |                335 → 51 |                     2 → 2 |           25.362 |           3.457 |        8.133 |        3.945 |            9.748 |         10.360 |
|  1,000 | `title/asc/allPages`            |               335 → 620 |                    2 → 10 |           13.678 |          25.155 |       29.803 |       25.896 |           13.294 |         11.980 |
|  1,000 | `title/asc/first50/afterScan`   |                334 → 51 |                     2 → 2 |           10.601 |           2.357 |        2.485 |        2.437 |            3.499 |         10.915 |
| 12,000 | `header/known`                  |                   0 → 0 |                     0 → 0 |            0.000 |           0.000 |        0.000 |        0.002 |            0.001 |          0.000 |
| 12,000 | `title/asc/first50/coldHeader`  |              4,001 → 51 |                     2 → 2 |          184.380 |           2.974 |        6.542 |        3.574 |            7.068 |        150.655 |
| 12,000 | `title/asc/first50/knownHeader` |              4,001 → 51 |                     2 → 2 |          132.428 |           5.815 |        9.028 |        2.950 |           12.668 |        140.801 |
| 12,000 | `title/asc/allPages`            |           4,001 → 7,959 |                    2 → 97 |          247.499 |         508.237 |      663.075 |      255.085 |           74.384 |        133.536 |
| 12,000 | `title/asc/first50/afterScan`   |              4,000 → 51 |                     2 → 2 |          148.575 |           4.420 |        9.011 |        2.891 |           11.807 |        188.760 |
| 50,000 | `header/known`                  |                   0 → 0 |                     0 → 0 |            0.000 |           0.000 |        0.000 |        0.001 |            0.001 |          0.000 |
| 50,000 | `title/asc/first50/coldHeader`  |             16,668 → 51 |                     2 → 2 |         1209.895 |           8.203 |       10.579 |        4.496 |           13.548 |        597.092 |
| 50,000 | `title/asc/first50/knownHeader` |             16,668 → 51 |                     2 → 2 |         1131.191 |           7.499 |       12.322 |        4.415 |           12.547 |        618.727 |
| 50,000 | `title/asc/allPages`            |         16,668 → 33,319 |                   2 → 403 |         1227.431 |        1633.666 |     3135.095 |      923.994 |          103.886 |        447.946 |
| 50,000 | `title/asc/first50/afterScan`   |             16,667 → 51 |                     2 → 2 |          800.482 |          15.524 |       36.067 |        5.378 |           36.098 |        533.920 |

All eight first-page sort choices keep the same 51-row/two-statement bound. Their cold-header median ranges are 1,000: 2.625–5.777 ms, 12,000: 2.895–3.541 ms, 50,000: 4.347–24.653 ms. All per-sort p90, CPU, longest tasks, plans and comparison keys remain in the raw JSONL.

## Deferred playlist recommendations (#599)

Raw captures: [playlistInputs](results/599-playlistInputs-desktop.jsonl) and
[playlistRenewal](results/599-playlistRenewal-desktop.jsonl). Measured runtime and
harness: `5c87f2c3023ee68124cd9f681446e8048efb3b06`; before is actual ti
`460e39ff0cba6f50e7a456a77d6e99813295ebaa`. Exact source and result hashes, capture history and
limits are in [599-source-audit.json](results/599-source-audit.json).
The first complete R4 capture was followed by integration changes for #549/#601.
#601 adds genre projections/indexes and changes the store/schema files. Current
cells were therefore recaptured at the final merged code/schema; the complete
actual-ti control cells from the first capture are retained verbatim. The raw meta
records each cohort and the composition method. The synthetic Library/history
and every result hash match, but these are different physical schema/host-time
cohorts, not a simultaneous controlled latency comparison. Final composition and
control-cell immutability are checked by the evidence validator.
A later #550 integration adds an erased Core type export; all other captured file
hashes match. Normalized emitted index JavaScript and the playlist matcher/budgets
are unchanged, as recorded in the source audit; focused/full checks include #550.
The original complete R4 grid remains in scratch, including the **141.316 ms**
cold-input and **193.204 ms** cold-graph renewal observations. The integration-driven
recapture does not erase those negative observations. Earlier discarded R1
observations of **7.143 ms** warm-graph ranking and **6.426 ms** cold input also remain.

These are **desktop Node + sql.js replays**, not Hermes, phone SQLite or measured
first frames. All three sizes use the identical synthetic Library/history fixture,
one warmup, one separately traced pass and eleven timed runs per case. This is a
shared Linux host: our focused acceptance suites finished before each capture and the current-only
recaptures ran sequentially; independent worktrees remained active. No replay was repeated to improve its maximum; the final recapture was
required by the integration store/schema change.

Reproduce from the repository root with a clean source checkout of v0.19.0-ti:

```sh
pnpm --silent --filter @wave/mobile bench:fast-again --bench playlistInputs --before <ti-worktree>
pnpm --silent --filter @wave/mobile bench:fast-again --bench playlistRenewal --before <ti-worktree>
WAVE_BENCH_BEFORE=<ti-worktree> pnpm --filter @wave/mobile exec node --test bench/fastAgain/playlistReplay.test.ts
```

The loader executes the selected revision's actual Core, session, store and graph
modules. Current visits use the production scheduler/source adapters; ti faithfully
replays its eager component subscription. Free turns use `setImmediate`; settlement
and burst-throttle waits are driven explicitly. Graph cold work uses the existing
#594 paged/stepped implementation; #599 adds visit cancellation around that reader.
Warm graph setup is outside measurement. Before-settled opening includes the
playlist's actual own content query while recommendations are deferred.

Elapsed time and process CPU stop before canonicalization/hashing. Setup, module
loading, fixture creation, warmup and per-case preparation are excluded. Task
boundaries include synchronous read/projection/ranking and session publication,
split by actual injected free turns. Synchronous totals, task counts, longest-task
samples, CPU, p90 and SQL step maxima are retained in each raw cell. SQL rows count
returned rows, not SQLite VM visits; notifications count Core session subscribers,
not React commits.

Complete historical source payloads, five offered track objects/order and rank
scores match across revisions at every size. Ephemeral slot keys are excluded.
Opening compares own playlist content because recommendations intentionally wait.
The fixture has no saved catalog/similar pages and ranking is offline/YT-off;
separate real-store tests cover catalog/stream deduplication, multi-genres, malformed
entries, missing files, priority and playlist-scoped feedback. This does not measure
a full online catalog or React/map publication. v0.7 predates recommendations and
is not a comparable timing baseline.

Values are before → after; milliseconds. Total is median elapsed replay, longest
is the maximum synchronous task across all eleven timed samples. Full mean CPU
and p90 values for every cell remain in the JSONL.

### Input and ranking replay

| Songs | Case                       | SQL rows        | Statements | Total ms          | Longest task ms  | Notifications |
| ----- | -------------------------- | --------------- | ---------- | ----------------- | ---------------- | ------------- |
| 1000  | `input/cold`               | 2343 → 3092     | 15 → 36    | 16.829 → 26.552   | 19.197 → 3.057   | 0 → 0         |
| 1000  | `input/warm`               | 2343 → 52       | 15 → 5     | 16.291 → 0.754    | 16.978 → 0.359   | 0 → 0         |
| 1000  | `rank/warmInput/nullGraph` | 0 → 0           | 0 → 0      | 57.906 → 29.043   | 58.95 → 4.009    | 0 → 0         |
| 1000  | `rank/warmInput/warmGraph` | 0 → 0           | 0 → 0      | 57.968 → 26.349   | 68.789 → 3.865   | 0 → 0         |
| 12000 | `input/cold`               | 25883 → 36532   | 15 → 297   | 155.73 → 261.203  | 170.25 → 5.245   | 0 → 0         |
| 12000 | `input/warm`               | 25883 → 52      | 15 → 5     | 155.421 → 2.19    | 189.19 → 0.804   | 0 → 0         |
| 12000 | `rank/warmInput/nullGraph` | 0 → 0           | 0 → 0      | 361.585 → 459.417 | 385.734 → 26.303 | 0 → 0         |
| 12000 | `rank/warmInput/warmGraph` | 0 → 0           | 0 → 0      | 362.598 → 342.982 | 390.319 → 7.598  | 0 → 0         |
| 50000 | `input/cold`               | 107203 → 152052 | 15 → 1200  | 663.237 → 1085.9  | 1163.14 → 5.601  | 0 → 0         |
| 50000 | `input/warm`               | 107203 → 52     | 15 → 5     | 710.63 → 0.75     | 734.118 → 1.866  | 0 → 0         |
| 50000 | `rank/warmInput/nullGraph` | 0 → 0           | 0 → 0      | 3837.36 → 1489.33 | 5083.28 → 13.584 | 0 → 0         |
| 50000 | `rank/warmInput/warmGraph` | 0 → 0           | 0 → 0      | 3961.07 → 1864.72 | 9456.11 → 7.582  | 0 → 0         |

### Opening and retained visit replay

| Songs | Case                             | SQL rows        | Statements | Total ms          | Longest task ms  | Notifications |
| ----- | -------------------------------- | --------------- | ---------- | ----------------- | ---------------- | ------------- |
| 1000  | `opening/beforeSettled/1Mounted` | 2446 → 103      | 19 → 4     | 79.655 → 2.663    | 87.75 → 3.716    | 3 → 0         |
| 1000  | `hiddenBurst/1Mounted`           | 4686 → 0        | 30 → 0     | 153.022 → 0.057   | 179.171 → 0.037  | 6 → 0         |
| 1000  | `visibleCatchUp/1Mounted`        | 0 → 3092        | 0 → 36     | 0.024 → 85.441    | 0.032 → 11.875   | 0 → 3         |
| 1000  | `visibleBurst/1Mounted`          | 4686 → 3092     | 30 → 36    | 150.585 → 66.012  | 164.472 → 11.231 | 6 → 3         |
| 1000  | `opening/beforeSettled/2Mounted` | 4892 → 206      | 38 → 8     | 197.582 → 4.234   | 224.766 → 3.671  | 6 → 0         |
| 1000  | `hiddenBurst/2Mounted`           | 9372 → 0        | 60 → 0     | 334.787 → 0.035   | 600.531 → 0.031  | 12 → 0        |
| 1000  | `visibleCatchUp/2Mounted`        | 0 → 3144        | 0 → 41     | 0.025 → 126.021   | 0.024 → 5.42     | 0 → 6         |
| 1000  | `visibleBurst/2Mounted`          | 9372 → 3144     | 60 → 41    | 311.656 → 122.17  | 343.968 → 4.85   | 12 → 6        |
| 1000  | `opening/settled/warmGraph`      | 2343 → 3092     | 15 → 36    | 81.632 → 90.118   | 100.374 → 10.842 | 3 → 3         |
| 1000  | `opening/settled/coldGraph`      | 13533 → 13092   | 23 → 199   | 125.414 → 265.609 | 88.823 → 12.246  | 3 → 3         |
| 12000 | `opening/beforeSettled/1Mounted` | 25986 → 103     | 19 → 4     | 605.868 → 3.407   | 646.594 → 3.699  | 3 → 0         |
| 12000 | `hiddenBurst/1Mounted`           | 51766 → 0       | 30 → 0     | 1223.82 → 0.047   | 1440.31 → 0.061  | 6 → 0         |
| 12000 | `visibleCatchUp/1Mounted`        | 0 → 36532       | 0 → 297    | 0.274 → 608.044   | 0.016 → 13.009   | 0 → 3         |
| 12000 | `visibleBurst/1Mounted`          | 51766 → 36532   | 30 → 297   | 1247.53 → 547.925 | 1626.39 → 4.576  | 6 → 3         |
| 12000 | `opening/beforeSettled/2Mounted` | 51972 → 206     | 38 → 8     | 1345.79 → 3.144   | 900.549 → 1.638  | 6 → 0         |
| 12000 | `hiddenBurst/2Mounted`           | 103532 → 0      | 60 → 0     | 2139.02 → 0.031   | 2322.8 → 0.018   | 12 → 0        |
| 12000 | `visibleCatchUp/2Mounted`        | 0 → 36584       | 0 → 302    | 0.027 → 969.02    | 0.022 → 15.843   | 0 → 6         |
| 12000 | `visibleBurst/2Mounted`          | 103532 → 36584  | 60 → 302   | 2143.63 → 1347.51 | 3235.47 → 25.684 | 12 → 6        |
| 12000 | `opening/settled/warmGraph`      | 25883 → 36532   | 15 → 297   | 625.495 → 629.413 | 1594.4 → 7.525   | 3 → 3         |
| 12000 | `opening/settled/coldGraph`      | 94163 → 90532   | 23 → 1146  | 2926.51 → 1196.55 | 1951.28 → 7.903  | 3 → 3         |
| 50000 | `opening/beforeSettled/1Mounted` | 107306 → 103    | 19 → 4     | 10640.6 → 1.8     | 19436.7 → 3.887  | 3 → 0         |
| 50000 | `hiddenBurst/1Mounted`           | 214406 → 0      | 30 → 0     | 15492.6 → 0.022   | 28156.8 → 0.011  | 6 → 0         |
| 50000 | `visibleCatchUp/1Mounted`        | 0 → 152052      | 0 → 1200   | 0.042 → 3747.93   | 0.019 → 17.04    | 0 → 3         |
| 50000 | `visibleBurst/1Mounted`          | 214406 → 152052 | 30 → 1200  | 11660.1 → 3249.44 | 13086.7 → 18.303 | 6 → 3         |
| 50000 | `opening/beforeSettled/2Mounted` | 214612 → 206    | 38 → 8     | 9606.71 → 3.64    | 5282.15 → 3.799  | 6 → 0         |
| 50000 | `hiddenBurst/2Mounted`           | 428812 → 0      | 60 → 0     | 23021.2 → 0.028   | 28852.6 → 0.027  | 12 → 0        |
| 50000 | `visibleCatchUp/2Mounted`        | 0 → 152104      | 0 → 1205   | 0.043 → 6755.1    | 0.038 → 29.461   | 0 → 6         |
| 50000 | `visibleBurst/2Mounted`          | 428812 → 152104 | 60 → 1205  | 19377.3 → 4184.2  | 19680.4 → 9.276  | 12 → 6        |
| 50000 | `opening/settled/warmGraph`      | 107203 → 152052 | 15 → 1200  | 4269.54 → 3533.09 | 4419.65 → 54.902 | 3 → 3         |
| 50000 | `opening/settled/coldGraph`      | 366703 → 352052 | 23 → 4331  | 5858.28 → 6429.19 | 4068.02 → 17.864 | 3 → 3         |

Cold input total elapsed time increases in this capture: 1,000 songs: 16.829 → 26.552 ms; 12,000 songs: 155.73 → 261.203 ms; 50,000 songs: 663.237 → 1085.9 ms. Paging, bounded projection and extra returned fields add work; warm reuse avoids rereading that source. This does not establish lower cold total latency.

### Acceptance and evidence limits

Hidden track/favorite bursts do **zero input reads, ranks, SQL rows, statements and notifications**, for one and two retained visits at every size. Opening before settlement also does no recommendation work. Visible catch-up and visible bursts perform one input/rank per visit and share one source snapshot. A warm input reads only 52 membership/existence rows, and rank probes issue zero SQL. The shared source retains one completed/in-flight version with explicit track/favorite/catalog invalidation, lazy 60-second eviction and disposal; membership and feedback are read afresh per playlist.

Public Core/session/scheduler and actual sql.js tests cover in-flight changes, cancellation/disposal, visible coalescing, unrelated playlists, Add/Dismiss exactly once, held offers and refill/retry behavior. Exact #584 capabilities protect legacy/deferred inputs and source factories; only the deferred component chain is allowed.

The six-ms target was exceeded in this capture: `playlistInputs/12000/rank/warmInput/nullGraph`: **26.303 ms**; `playlistInputs/12000/rank/warmInput/warmGraph`: **7.598 ms**; `playlistInputs/50000/rank/warmInput/nullGraph`: **13.584 ms**; `playlistInputs/50000/rank/warmInput/warmGraph`: **7.582 ms**; `playlistRenewal/1000/visibleCatchUp/1Mounted`: **11.875 ms**; `playlistRenewal/1000/visibleBurst/1Mounted`: **11.231 ms**; `playlistRenewal/1000/opening/settled/warmGraph`: **10.842 ms**; `playlistRenewal/1000/opening/settled/coldGraph`: **12.246 ms**; `playlistRenewal/12000/visibleCatchUp/1Mounted`: **13.009 ms**; `playlistRenewal/12000/visibleCatchUp/2Mounted`: **15.843 ms**; `playlistRenewal/12000/visibleBurst/2Mounted`: **25.684 ms**; `playlistRenewal/12000/opening/settled/warmGraph`: **7.525 ms**; `playlistRenewal/12000/opening/settled/coldGraph`: **7.903 ms**; `playlistRenewal/50000/visibleCatchUp/1Mounted`: **17.04 ms**; `playlistRenewal/50000/visibleBurst/1Mounted`: **18.303 ms**; `playlistRenewal/50000/visibleCatchUp/2Mounted`: **29.461 ms**; `playlistRenewal/50000/visibleBurst/2Mounted`: **9.276 ms**; `playlistRenewal/50000/opening/settled/warmGraph`: **54.902 ms**; `playlistRenewal/50000/opening/settled/coldGraph`: **17.864 ms**. These negative observations are retained.

The unchanged shared adapter budgets 4 ms or 512 generator operations before yielding. SQL pages cap 128 raw rows per statement (a song-page turn can return 256 rows in two statements). This bounds returned work, not every SQLite VM visit or a long stored field. An individual operation, SQL call, GC or OS pause is not preemptible. Smaller blocking tasks can add CPU/elapsed overhead; no lower total-cost claim or universal six-ms guarantee follows. **Strict six-ms acceptance remains OPEN.** The capture does not attribute individual overshoots to SQL, GC or OS scheduling.

Android/Hermes, physical-device first rows/transitions, exported phone-log confirmation and TalkBack were not exercised. Desktop scheduling and source wiring support the implemented behavior; they do not establish native frame or accessibility evidence.
