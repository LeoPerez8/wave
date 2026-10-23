# #593: paged taste sources and shared due-Home snapshot

Source paging is implemented; **strict six-ms acceptance remains open**. These are desktop Node v26.8.2 + sql.js measurements on a shared Linux x64 host. They establish no Android/Hermes, native-frame, physical-device or TalkBack result.

## Implementation and regression evidence

`readTasteLibrary` seeks `mixSongsPage(after, { genres: false })` and the new identity-only `tasteArtistsPage`. Each page returns at most 128 raw rows. The mapper needs artist IDs/names only: unique IDs make artist insertion order unobservable, so broad artist counts and artist sorting are unnecessary. Song order is restored with stepped SQLite BINARY title/artist/path comparison, including Unicode and null paths. `readTasteHistory` seeks chronological startedAt/id plays, raw favorite rowids and download track IDs; empty decoded pages advance until the raw cursor ends.

One due Library snapshot supplies mapping, the single live profile and picks. Before/after stamps discard a source walk overtaken by a write, without holding a transaction across scheduler turns. The stamp counts, through TEMP triggers on this connection, only writes to what the taste reads (songs, credits, artists, albums, genres, plays, stars) plus `data_version` for other connections; the position and queue saves, an unfinished play's progress and sync's pushed flags don't move it (review F-1: a 5 s position save used to restart a 50k derivation forever while music played). After three discarded walks the last runs in one task, as ti's synchronous read always did. A supplied Library that's no longer current is read again with the history, and Home discards its attempt before drawing picks. The live semaphore is preserved. History membership and pending-map copies now yield; cancellation/failure retain pending signals, streamed signals survive metadata invalidation, and a sequence number merges Library/streamed signals in arrival order. The recovered WIP reordered them; a public regression failed before that correction.

Automatic due work retains the existing actual-screen-settlement/free-turn boundary and previous picks. Standing rows still read at most nine songs, with picked track/favorite subscriptions and no broad source reads. The canonical `stepped.ts` remains byte-identical: four-ms work budget, 512-operation cap, iterator closure on cancellation. No Promise wrapper represents SQL as interruptible work. The exact bounded-source guard inventory replaces only the two retired whole-source debts; route and other source protections remain. #595 startup, graph/mix APIs and #598/#599 ownership are preserved.

Real-store tests cover keyset query plans, narrow artist projections, empty deleted pages, tied history, sparse favorites/downloads, missing/deleted songs, collaborations, primary vs multi-genres, BINARY order, one due songs read, a warm shared profile with zero extra SQL, writes between pages and before scoring, and cancellation while paging with pending signals. Core tests verify resumable map copying and full ordered scores. The independent source proof additionally executes actual `460e39ff` store/Core for populated 1k/12k/50k, sparse/deleted/tied/collaborative/multi-genre and empty fixtures, comparing all input fields, complete ordered profiles and normal/refreshed pick metadata.

## Capture provenance and hash correction

Before is untouched `v0.19.0-ti`, `460e39ff0cba6f50e7a456a77d6e99813295ebaa`. Taste timing source is `5877b8c9daba42da2f1f5efa70ef6c58998f75e3`; Home timing source is `5055528f305ebac313661ad4b2da30fe0dcbe6f1`, after merging integration's #598 at `2aae3bb8`. Each size/variant/read has eleven timed runs after its untimed synchronous trace. Benches ran sequentially, with no simultaneous full suite in this worktree. Other host activity was observed; this capture does not attribute individual outliers to scheduling, GC or a particular generator operation.

The initial taste run completed every timed sample but exited 1 at comparison: the new `inputSnapshot` key hashed JSON object property insertion order, which differs between the historical and paged play projections. Full profile keys already matched at every size. A regression reproduced the hash bug; the corrected helper hashes explicit ordered field tuples outside timing. A separate untimed actual-store replay proved complete input equality and canonical keys at all sizes. **No timing was rerun or removed.** The committed summary replaces only those input keys, retains `originalResultKey`, and records the original failure. Original stdout/stderr and proof scripts remain in the stable handoff directory with hashes. Repeated SQL traces are compacted into complete SQL/row histograms; all timing samples, work counts, SQL metrics and profile/pick semantic keys remain.

- [Taste measurements](results/593-paging-tasteProfile-desktop.jsonl)
- [Home measurements](results/593-paging-homeOpening-desktop.jsonl)
- [Full public-input/profile/pick equivalence proof](results/593-paging-equivalence.jsonl)
- [Source and raw-artifact hashes](results/593-paging-source-audit.json)

## Taste results

Each cell is before → after. Total is median synchronous JS; longest is the maximum task across all eleven samples. SQL time is a subset of each task, measured from prepare through free including raw row delivery, excluding Drizzle mapping after free. The independent input and scoring cases are not additive component medians of firstDerivation.

| Songs  | Read            | SQL rows          | Statements | Total JS median ms  | Longest task ms   | Longest SQL statement ms |
| ------ | --------------- | ----------------- | ---------- | ------------------- | ----------------- | ------------------------ |
| 1,000  | firstDerivation | 11,190 → 12,144   | 5 → 186    | 48.333 → 112.665    | 55.994 → 5.153    | 14.509 → 2.779           |
| 1,000  | inputSnapshot   | 11,190 → 12,142   | 5 → 184    | 49.404 → 98.770     | 66.879 → 4.353    | 16.770 → 2.324           |
| 1,000  | scoreCpuOnly    | 0 → 0             | 0 → 0      | 3.145 → 8.075       | 5.061 → 0.593     | 0.000 → 0.000            |
| 12,000 | firstDerivation | 68,280 → 79,684   | 5 → 1,056  | 1303.789 → 861.197  | 1518.154 → 6.425  | 680.822 → 4.415          |
| 12,000 | inputSnapshot   | 68,280 → 79,682   | 5 → 1,054  | 1555.269 → 1924.927 | 1965.666 → 40.707 | 779.944 → 19.849         |
| 12,000 | scoreCpuOnly    | 0 → 0             | 0 → 0      | 159.296 → 105.723   | 279.480 → 11.614  | 0.000 → 0.000            |
| 50,000 | firstDerivation | 259,500 → 307,004 | 5 → 3,974  | 2522.836 → 3546.399 | 8460.123 → 8.921  | 2850.935 → 5.604         |
| 50,000 | inputSnapshot   | 259,500 → 307,002 | 5 → 3,972  | 1772.692 → 2565.388 | 2680.281 → 17.970 | 1110.275 → 13.091        |
| 50,000 | scoreCpuOnly    | 0 → 0             | 0 → 0      | 111.588 → 366.615   | 136.698 → 24.756  | 0.000 → 0.000            |

Paging increases narrow raw rows/statement count: downloads walk raw track IDs, including pages that decode to no download, and plays use equal-time then later-time seeks. Full song metadata is still read once. Returned rows are not SQLite VM visits. More turns can increase total JS/elapsed time; the intended improvement is shorter indivisible tasks, not a throughput guarantee.

The profile's firstDerivation maxima are 5.153/6.425/8.921 ms at 1k/12k/50k. Input-only maxima are 4.353/40.707/17.970 ms; score-only maxima are 0.593/11.614/24.756 ms. These overshoots are retained. History membership and map copying were predictable whole-input operations and are now explicitly stepped, with work-count tests. The measurements do not establish that a remaining divisible operation alone caused an overshoot. SQL delivery/decoding, individual operations, allocations, GC and scheduling remain indivisible to the cooperative adapter; a hard wall-time guarantee is not claimed.

## First Home of the day

This case includes Home's other opening readers, yesterday's standing picks, the first live profile derivation, exact replacement picks and targeted replacement rows. It excludes startup job execution (which the separate coldLaunch case includes) and due mix builds. Full Home/profile/pick keys agree at every size. These whole-case times must not be attributed solely to taste.

| Songs  | SQL rows before → after | Statements before → after | Total JS median ms before → after | Longest task ms before → after | Longest SQL statement ms before → after |
| ------ | ----------------------- | ------------------------- | --------------------------------- | ------------------------------ | --------------------------------------- |
| 1,000  | 19,733 → 19,565         | 21 → 202                  | 82.139 → 118.306                  | 39.693 → 20.105                | 9.859 → 6.105                           |
| 12,000 | 91,683 → 89,425         | 21 → 1,072                | 779.193 → 802.444                 | 464.454 → 69.517               | 177.292 → 51.814                        |
| 50,000 | 329,263 → 319,785       | 21 → 3,990                | 3357.489 → 3266.192               | 2086.470 → 330.557             | 734.167 → 246.747                       |

## Remaining acceptance and validation

Strict six-ms acceptance remains **OPEN** for taste input/scoring and whole Home work. #594's original 25.773/6.510 ms mix overshoots and labelled 6.299 ms `mixArtistsPage` diagnostic remain unchanged evidence. Taste no longer invokes that count query. The recovered WIP's 128 → 32 mix artist page modification was removed: #600 still owns the broad artist/count SQL budget, and reducing a page alone would not bound per-artist count work. No new mix budget claim is made here.

Full recovered Core suite: 3,422/3,422 with `--test-concurrency=1`. Updated full mobile suite: 686/686; the subsequent hash regression passes and is included in the 35/35 post-merge focused mobile checks. Post-merge public Core taste checks: 3/3. Both Core/mobile typechecks pass after the integration merge. Source/route guards, real-store plan/work-count checks and cancellation/settlement regressions pass. Final changed-file formatting/lint and artifact validation are recorded in the handoff. No version/lockfile, orchestration, PR, push or GitHub write was made. Android/Hermes/device interaction and TalkBack remain unverified.
