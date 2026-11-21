# #1350 Background JS in 8 ms slices that yield to taps

## What changed

- **One scheduler.** Core's `createBackgroundWork` (`lib/backgroundWork.ts` in the app) is the
  only maker of background turns and slices. Every stepped slice in the app (`lib/stepped.ts`'s
  `runSteps` and `pacedSteps`, which 78 call sites use) runs through its `runSlice`, and every
  free turn (`whenFree`, `freeTurn`, `freeTurnEffect`, `startupTurn`, `settledTurnEffect`) comes
  from it. The frame-paced recommendation turns (`lib/recommendationWork.ts`: Home's mixes, the
  recommendation snapshot, the taste profile, playlist suggestions) keep their frame budget and
  share the scheduler's transition gate.
- **8 ms slices.** `runStepSlice` runs at least one step, then more while the longest step so far
  still fits. The scheduler caps a slice at 8 ms. The app's pace plans 6 ms of it and leaves 2 ms
  for what no step foresees: on the desktop runs a GC pause inside one step took a slice planned
  at 8 ms to 9.8 ms. A perf build's `backgroundWork` meta gives `longestSliceMs` and
  `overBudget`, the slices past 8 ms by work name.
- **Taps and transitions hold it.** A tap's transition (the timing session's `start` to its
  `settled` or `cancelled`) holds every slice and free turn, `maxWaitMs` or not. A transition
  that never reports its end holds work for 5 s at most (`transitionCapMs`). The quiet time after
  a touch (400 ms) stays as it was. Recommendation turns wait out the transition but not the quiet
  time, as before. Work someone waits for (an awaited ranking) isn't held.
- **The block line.** A JS block over 50 ms while Wave is in the foreground writes one
  `WaveTiming` warning, for example `JS blocked 312 ms on /search by Magic Queue batch`. Core's
  `createJsBlockLog` takes the scheduler's slices (timed, named) and the runtime's `longtask`
  entries, which an observer reads for as long as the app runs. A slice over 50 ms writes its own
  line, and the long task the runtime reports for it adds none. A long task inside a slice or
  starting on a turn the scheduler gave (an awaited turn's continuation, such as a sync database
  step) gets that work's name. Any other block reads `by no background work`.
- **Names.** A fiber's work is named by `namedWork` (an Effect `Context.Reference`), and
  `withNetworkLog` runs name their own. Named: Magic Queue batch, DJ batch, scan, sync, Home mix
  builds (by row), Home mix inputs and catalog, Home Magic Queue seeds, taste profile,
  recommendation favorites, new-release check, new-release play, update check, community playlists
  read, Search index, lyrics search index, streamed genres, medium covers, playlist imports, YT
  Music library import, replacement duplicates, rescan, candidate catalog and each startup piece.

## Callers

| Work                                       | Before                                                      | Now                                                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Magic Queue batch, DJ batch                | Ranking (`rankRadioSongs`) and Library mapping in one block | `rankRadioSongsSteps` and the Library mapping in slices; the radios' answer and the batch's completion on free turns                                               |
| Scan                                       | Slices of 4 ms + one step                                   | The scheduler's slices; named                                                                                                                                      |
| Sync                                       | A free turn before each database step                       | The same, named, so a long step is put down to sync                                                                                                                |
| Home mixes, snapshot, taste                | Frame-paced turns, blind to taps                            | Frame-paced turns that wait out a tap's transition                                                                                                                 |
| Home Magic Queue carousel picks            | Free turns and slices                                       | The same through the one scheduler; named                                                                                                                          |
| New-release check (`followReleases`)       | A settled turn before each request; answers parsed at once  | Each answer (Deezer, YT Music) handled on a free turn (`answered` port in `@wave/client`)                                                                          |
| New-release play (`playNewReleases`)       | Every release after the first added as its answer came      | Each release after the first on a free turn                                                                                                                        |
| Update check (`updateRunner`)              | Each step's answer handled at once                          | On a free turn (`answered` option)                                                                                                                                 |
| Community playlists refresh                | A settled turn, then the answer handled at once             | The answer handled on a free turn                                                                                                                                  |
| Search index preparation                   | `setTimeout(…, 0)` slices of its own                        | The scheduler's free turns                                                                                                                                         |
| In your orbit, From your library           | Library queries; the ranking sorts the played totals        | Unchanged: screen reads, not background work. Their reads move with #1348/#1349                                                                                    |
| Download bookkeeping (`followDownloadRun`) | Per journal change, O(jobs)                                 | Unchanged: it must see each journal snapshot, or a song that finishes and leaves the journal between two is lost to the run. #1360 measures it with 100+ downloads |
| Invite join, shared-row sync (#1299)       | Not on `main`                                               | Joins when #1299 lands                                                                                                                                             |

A network wait is not a slice: only the JS that handles its answer takes a turn.

## The guard

`apps/mobile/src/perf/backgroundWorkGuard.test.ts` fails when:

- a module defers work with a zero timer, `setImmediate`, `queueMicrotask`,
  `requestIdleCallback` or `InteractionManager` and isn't in `OWN_DEFERRALS`
  (`perf/performancePolicy.ts`, each with its reason: foreground reads, UI clocks, and the
  recording-title backfill the Library store starts, which moves with #1348);
- anything but `lib/backgroundWork.ts` makes background work, or anything but `lib/stepped.ts`
  runs slices;
- a job in `BACKGROUND_JOBS` stops importing its turns from the scheduler.

## Desktop runs

Run on the development PC (Windows, AMD Ryzen 7 5700X, Node 24.19.0), not the emulator or a
phone. Core's functions on synthetic inputs: one block is the function run whole (before); sliced
runs it through `createBackgroundWork`'s `runSlice` on `performance.now()`. Three runs each.

| Work                                               | One block (before) | Sliced at 6 ms, longest slice (after) |
| -------------------------------------------------- | ------------------ | ------------------------------------- |
| Rank 6 radios × 100 songs, 10,000 Library songs    | 39–48 ms           | 6.0, 6.1 and 8.2 ms (a 2 ms GC pause) |
| Rank 6 radios × 100 songs, 727 Library songs       | 3.4–7.2 ms         | under 2 ms (512-step cap)             |
| Scan reconciliation, 10,000 read and 1,000 missing | 6.0–13.8 ms        | 5.9–6.0 ms                            |

The reference phone is several times slower than this PC, so its one-block numbers are larger
and the slices' 6 ms time check, not the step cap, ends them there. Tests through the scheduler's
public API (`packages/core/src/backgroundSlices.test.ts`) show a 600-song Magic Queue ranking and
a 2,000-file scan never take a slice past 8 ms at the costs they give each step.

## Phone run: pending

On the reference phone (Xiaomi 25118PC98G, Android 15), with YouTube Music on. **Before:** the
`ti` release without #1350. **After:** the `ti` release with it.

```sh
# Taps while a Magic Queue batch runs: reference-taps starts one from a Home tile.
node scripts/perf/perf.ts run --scenario reference-taps --label 1350-<before|after> \
  --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
  --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on that artist's Similar artists row>"
# Taps while a rescan, sync and imports start.
node scripts/perf/perf.ts run --scenario rescan-return --label 1350-<before|after>-scan
node scripts/perf/perf.ts summary perf-results/1350-<before|after>-<time>.jsonl
```

Record here, for both runs: each step's first-frame median and p90, the `backgroundWork` meta
(`longestSliceMs`, `overBudget`, `forcedSlices`), the slow-tap lines whose "meanwhile" names a
Magic Queue batch or a scan, and every `JS blocked … by …` line in the app log. The after run
meets the ticket when no tap's first frame is past budget with a batch or scan named meanwhile,
and no `JS blocked` line names background work.
