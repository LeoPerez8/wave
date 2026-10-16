# #307 Import planner: work per arriving answer

Ticket: #307 (parent #301). Branch `feat/307-import-planner`, based on `perf/301-performance` at
66f0290.

## What was measured

`packages/core/bench/playlistImport.ts` runs a large Spotify playlist import through Core's public
API the way `apps/mobile/src/library/playlistImports.ts` runs it:

- `nextImportStep` until four searches are in flight;
- answers arrive out of order (150 to 1,350 ms, one in 50 after 30 s), and one search in 150 is
  refused once and asked again;
- the playlist is given what's settled at most once a simulated second (`importAdditions`,
  `importAdded`);
- after every change, `updatePlaylistImport`, the notification's `playlistImportProgress` and the
  open playlist page's `playlistImportView`, as `setImports` and `PlaylistImportLine` do.

The source has one song in ten in the Library, one in 25 listed again on another album (one search
settles both), one in 40 that YouTube Music doesn't have, and one in 60 that another search also
finds (given once). Time is simulated and the generator is seeded, so every run makes the same
calls in the same order.

Run it from `packages/core` with plain Node (no dependencies):

```sh
node bench/playlistImport.ts          # or: pnpm --filter @wave/core bench:import
node bench/playlistImport.ts --quick
```

Each `timed` line has the CPU time spent in Core per call. Each `counted` line comes from a second
pass that wraps the import's `songs` and `finds` arrays in counting proxies. `visited` counts every
entry Core read one at a time. `copied` counts every entry it copied in bulk with `slice`. The
`outcome` fingerprint hashes what the playlist was given, in order, plus every song's final
settlement, `added` and the state. It must not change when the planner changes.

**These are desktop numbers** (Node v24.19.0, win32-x64), not phone frame timings. Device
measurement is still pending (see the end of this doc).

## Before (66f0290)

Every answer and every progress line read the whole import again:

- `importSearchAnswered` mapped every song, rebuilding the search query of each unsettled one to
  find the songs the answer settles.
- `importAdditions` rebuilt the set of songs already given from all of `finds[0, added)` on each
  call, and the app calls it on every loop wake, so once per answer.
- `playlistImportProgress` and `playlistImportView` counted settled songs with a full `filter`.
  The view also rebuilt every unsettled song's query (`searchesLeft`), then simulated the pacing of
  every remaining search, one at a time (`spotifySearchesDoneAt`).
- `nextImportStep` walked from `added` across every settled song to find the next one to search.

|  Songs | Answers | Core CPU (ms) | Per answer (µs) | Entries visited | Visited per answer | Entries copied |
| -----: | ------: | ------------: | --------------: | --------------: | -----------------: | -------------: |
|    500 |     434 |          78.8 |             182 |       1,999,772 |              4,608 |         96,363 |
|  1,000 |     867 |         277.8 |             320 |       7,715,210 |              8,899 |        412,683 |
|  2,000 |   1,727 |         954.5 |             553 |      31,106,123 |             18,012 |      2,215,716 |
|  4,000 |   3,466 |             — |               — |     123,624,261 |             35,668 |      8,874,050 |
|  5,000 |   4,330 |       5,482.4 |           1,266 |               — |                  — |              — |
| 10,000 |   8,657 |      23,088.4 |           2,667 |               — |                  — |              — |

Visited entries per answer grow linearly with the import, so the whole import costs time
proportional to its size squared. At 10,000 songs the time split was: `playlistImportView`
13,717 ms, `importAdditions` 4,987 ms, `importSearchAnswered` 3,646 ms, `playlistImportProgress`
609 ms and `nextImportStep` 125 ms.

## After

`playlistImport.ts` keeps a tally for each import's `finds` array. The tally holds:

- how many songs are open (still to be found) and how many weren't found;
- for each search, how many of its songs are open;
- for each playlist song key, the first song found as it;
- a path-compressed "next open song" index.

It also keeps, once per `songs` array, each song's query and each query's songs. An answer reads
only the songs its search finds. It copies `finds`, settles those songs, and moves the tally to the
new array. Then:

- `importAdditions` reads only the songs since the last give, and skips a song when an earlier song
  was found as it.
- Counts come from the tally.
- `nextImportStep` jumps straight to open songs.

`spotifySearchesDoneAt` stops simulating once more than one allowance in a row each waited exactly
one window. From that point the rest repeat the last allowance's times one window later, which can
be proven by induction. So its work is bounded by a few allowances (about 1,000 searches each),
whatever the import's size.

|  Songs | Answers | Core CPU (ms) | Per answer (µs) | Entries visited | Visited per answer | Entries copied | Outcome         |
| -----: | ------: | ------------: | --------------: | --------------: | -----------------: | -------------: | --------------- |
|    500 |     434 |          32.4 |              75 |           6,850 |                 16 |        215,000 | 157e6d89 (same) |
|  1,000 |     867 |          92.3 |             106 |          13,804 |                 16 |        860,000 | 418122d8 (same) |
|  2,000 |   1,727 |         205.6 |             119 |          29,579 |                 17 |      3,440,000 | e8e5991b (same) |
|  4,000 |   3,466 |             — |               — |          59,310 |                 17 |     13,760,000 | 82cb5b1b (same) |
|  5,000 |   4,330 |         478.3 |             110 |               — |                  — |              — | e330ae5c (same) |
| 10,000 |   8,657 |         884.6 |             102 |               — |                  — |              — | 0a8d3b26 (same) |

Entries visited per answer are now constant (about 16), and CPU per answer stays flat from 500 to
10,000 songs. At 10,000 songs Core spends 0.88 s in total instead of 23.1 s, 26 times less. The
split at 10,000 is: `playlistImportView` 535 ms, `importSearchAnswered` 208 ms, `nextImportStep`
115 ms, `playlistImportProgress` 21 ms and `importAdditions` 3.6 ms. The `outcome` fingerprints
match before and after at every size.

### Linear work that remains

- **One copy of `finds` per answer that settles a song.** This keeps imports immutable values, as
  the public `PlaylistImport.finds` array is. It's a native bulk copy with no per-entry logic, so
  `copied` per answer equals the import's size. At 10,000 songs it adds a few µs per answer:
  `importSearchAnswered` takes 24 µs per answer at 10,000 songs and 20 µs at 500. Removing it would
  mean changing `finds` to a persistent structure in the public type, which this ticket doesn't
  need.
- **A finds array with no tally is counted once, O(n).** This happens at the start, after
  `readPlaylistImports` on restart, and when an older state of an import is asked about after a
  later one took its tally (the app never does this).
- **`nextImportStep` filters the search history on every call, and `spotifySearchAsked` copies
  it.** The history holds at most `SPOTIFY_SEARCH_BUDGET` (1,000) entries, so this cost doesn't
  depend on the import's size.
- **Some O(n) work happens outside the import itself.** `writePlaylistImports` serializes the
  whole import on each persisted write. The not-found notice is built when a finished import's
  page renders.

## Behavior kept

The Core tests in `packages/core/src/playlistImport.test.ts` were written against the old planner
and pass unchanged on the new one. They cover:

- answers arriving last first, with nothing given until the first song settles, then everything in
  source order;
- a song listed again on another album, searched once;
- a song another search finds again, before or after the first was given, given once;
- an earlier import state left unchanged by later answers, and two imports of one plan kept apart;
- a resumed import that asks its unanswered searches again in order and gives nothing twice;
- cancellation;
- the time-left line behind an unevenly spent search window, worked out by hand.

The full Core suite passes (1,741 tests).

Two checks were run outside the repo against copies of the old modules. Their scripts are kept in
the effort's shared notes, under `307/`.

- A differential fuzz of the old and new planners: 8 seeds, about 1.25 million comparisons of
  steps, additions, views, progress and job state. It covered random answers, refusals, stops,
  write/read round trips, branching from older states, and `importAdded` past unsettled songs. It
  found no difference. Changing one `<` to `<=` in `importAdditions` made it fail, which shows it
  can catch a real bug.
- `spotifySearchesDoneAt`, old against new, on 3,000 random pacing histories and counts up to
  12,000. Every result was identical.

## Not measured: Android

**Pending.** No phone was attached, and the #302 release runner isn't on the integration branch
yet. The desktop numbers above show the work removed, not its share of the stalls reported on the
phone. Run the release runner during a large Spotify import (for example 5,000 songs, with the
playlist page open) before and after this change, and record the results here.

What the app still does once per answer, unchanged by this ticket:

- the `setImports` path's `WavePlaylistImport.progress` bridge call;
- a React re-render of the open playlist page.

`persistedSetting`'s `persistDelayMs` is a debounce, not a throttle. While answers keep arriving
less than a second apart, the import isn't written until the stream pauses. That's existing
behavior and outside this ticket, but it affects how much progress a crash mid-import loses.
