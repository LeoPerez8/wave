# #315 Startup scheduling: first content before background work, slices that yield to touches

Ticket: #315 (parent #301). Branch `feat/315-startup-scheduling`, based on `perf/301-performance`
at 2a52cd7.

**Every device measurement is pending.** No phone was attached while the ticket was built
(`adb devices` listed none on 2026-10-16). The numbers below are **desktop** (Node, sql.js), and
they only size the JavaScript blocks. They say nothing about launch time on the S24+.

## What changed

Before, the root layout started everything in the commit that mounted the first screen: the
scan (a read of every indexed file, then the native scan), the playlists read, resumed imports
(parsing the kept imports, the foreground service, the first searches), sync (its first run
includes the full song step) and the download journal (which can read the whole Library). All
of it went through `appRuntime` from the root's effects, synchronously, while Home's first read
is started a turn later (`setTimeout(0)` in the shared query registry). Reading the code, the
scan's first read and the playlists read were queued ahead of Home's. How long that held Home on
the phone is not measured yet. Each scanner batch of up to 500 files was saved in one synchronous
transaction. Every scan's end linked playlists' streamed entries against the whole Library and
announced a change, even when the rescan found nothing.

Now:

- **Interaction-critical work starts at once:** the store (migrations), the player and the queue
  it restores, crossfade, Auto's responder and lyrics (`startServices`, unchanged, still shared
  with the headless Auto start, so services still start once).
- **Everything else waits for the first content.** Core's `createBackgroundWork`
  (`packages/core/src/backgroundWork.ts`) holds startup work until an app screen in sight shows
  its first Library query result (`useLibraryQuery` reports it, then one frame). There is no
  startup timer. A 3 s cap from the first request covers a launch whose screen reads nothing.
  Then each piece starts on its own free turn, in the order asked: the download journal's resume
  (asked by `startServices`), scan, imports, sync, playlists, the lookup summary.
- **Free turns.** A slice of background work runs when no touch is held and 400 ms have passed
  since the last one (a navigation's motion runs meanwhile), one slice per turn. A slice never
  waits more than 2 s, so a long scroll can't starve it. Returning to the foreground counts as a
  touch: the rescan on return and sync's database steps wait 400 ms for the first tap back. The
  root view feeds touches in every build (`onTouchStart`/`onTouchEnd`/`onTouchCancel`). Leaving
  the foreground clears a touch whose end went unheard.
- **Bounded batches at the JavaScript boundary.** A scanner batch is saved in slices of 100 files
  (`scanSaveSlices`, each move with its file, the batch's artwork with the first), one
  transaction per free turn. Sync waits for a turn before each synchronous step: joining, each
  pulled page, settling, each push read and each push's marks (`SyncCycleInput.turn`). It checks
  the account again after the wait, so a sign-out meanwhile still stops it before anything
  applies. An import gives the playlist its found songs on a free turn and reads the import again
  after it.
- **Quiet rescans stay quiet.** Core's `scanEnd` decides the end: the whole-Library link runs only
  when the scan saved files or playlists' entries changed since the last link
  (`playlist_revisions`, from #308, read in 0.1 ms). Screens are told only when files came or
  went. A rescan on return that found nothing no longer re-reads Home, nudges sync's song step or
  refreshes the download journal.
- **Imports survive interruption.** The kept imports were written 1 s after the _last_ change.
  During a steady stream of answers that never came, so a Wave killed mid-import lost everything
  since the import started. Writes now happen at most 1 s after the _first_ change not yet
  written (Core's `pendingWriteDelay`, `persistMaxDelayMs`), and every pending write goes out when
  Wave leaves the foreground.

Native code is unchanged. The scanner already reads tags on its own threads. Its batches cross to
JavaScript as before, and the slicing happens where the synchronous SQLite work is.

## What was measured

Desktop, Core's and the app's SQL against sql.js, 6,000 indexed files growing to 11,000 and a
2,500-entry streamed playlist, 5 runs, medians:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/scanBatch.ts
```

| Step (**desktop**)                                           |  ms |
| ------------------------------------------------------------ | --: |
| 500 new files, one transaction (before)                      |  79 |
| 500 new files in slices of 100, total                        |  92 |
| … the longest slice (what a tap can wait behind)             |  20 |
| Startup scan's first read, every indexed file                |  15 |
| Scan end: link over the whole Library (every rescan, before) |  69 |
| Scan end: entries' revision (decides the link now)           | 0.1 |

Slicing costs about 15% more in total and cuts the longest block to a quarter. A quick run
(`--quick`, 1,000 files) gave 107 against 96 total, with a 22 ms longest slice. The two runs
disagree on which total is larger, so treat the total cost as noise-level. The first read of
every indexed file stays one block (15 ms here). It runs on a free turn after the first content.

## Device plan (pending: needs the phone)

Before: a perf build of `perf/301-performance` at 2a52cd7. After: a perf build of this branch.
Same phone, the owner's Library, both compiled the same way (`--compile baseline` once #317's
profiles exist, else `--compile speed-profile`). For the "pending imports" and "sync" conditions:
signed in to the Wave account, and an import going on (the `import` variant).

```sh
for label in before after; do
  node scripts/perf/perf.ts run --apk wave-$label.apk --compile baseline --label 315-$label \
    --scenario startup,warm-start,rescan-return,tab-first,push-library,now-playing-first \
    --variant idle,import
done
node scripts/perf/perf.ts compare perf-results/315-before-*.jsonl perf-results/315-after-*.jsonl
```

- Cold launch: `startup/*/cold` (`am start -W`, startup frames, retained memory). In the perf
  build, the `appStartup` of each launch step holds `startup.contentAt` against React Native's
  `startup.endTime`: the gap is what the first content waited for. Before has no `contentAt`;
  compare `tab-first` and `now-playing-first` instead, which tap during startup work.
- Warm return: `warm-start/*/warm`.
- Return after the rescan interval: `rescan-return` (new, by name). 65 s on Home, then Wave
  again, then a tab tap while the rescan, sync and the import start. `backgroundWork` on each
  step reports slices, the longest wait and forced slices.
- Peak and retained memory: the runner's memory record after each scenario. Slicing doesn't hold
  more files. Batches the scanner sends while a slice waits queue in JavaScript, which the device
  run should check with a full scan (a new folder).
- Also check on the first run: the root view's `onTouchEnd` fires for touches gesture handler or
  a scroll view takes (`backgroundWork.forcedSlices` stays near 0 when idle). If it doesn't, work
  still runs, at most 2 s late per slice.

## Behavior kept

- Core: `backgroundWork.test.ts` (12: idle work on the next turn; touch, quiet time, restart;
  no starvation; one slice per turn; return to the foreground; cancel; startup order; content
  cap; stats), `writePacing.test.ts` (3), `scanReconcile.test.ts` (+7: slices, moves with their
  file, empty batch; scan end with and without saves, changed entries, files gone). All 1,895
  Core tests pass.
- App: `syncCycle.test.ts` (+2: database steps wait for turns and the sync finishes; a sign-out
  while a pulled page waits applies none of it), `playlists.test.ts` (+1: the entries' revision
  rises with entries and links, not with the Library alone). All 322 app tests pass.
- Runner: `runner.test.ts` (+1: `rescan-return` on the simulated phone, away past 60 s, HOT
  returns, not in `all`). 197 perf and CI tests pass.
- Typecheck: app, Core, `scripts/perf`.
- Kept as before: services start once, whichever of the Activity and the headless Auto task comes
  first. The incremental scan on launch and on return after 60 s. Sync on launch, on return and
  after edits. Resumed imports and downloads. The first scan of a process links as before. A scan
  that saved files or found files gone tells screens as before.

## Not measured, and negative results

- Everything on the phone. **Pending.**
- Not done: a native change to the scanner's thread priority or batch size. Tags are read on
  4 threads at normal priority and could compete with the UI thread during a full scan. Whether
  they do is a question for a Perfetto trace of a full scan (`--perfetto`), not a guess.
- The first read of every indexed file and the native `startScan` call (which builds its map of
  known files on the JavaScript thread) stay one block per scan. On desktop the read is 15 ms at
  11,000 files.
- `startup.contentAt` assumes `performance.now()` and React Native's `rnStartupTiming` share a
  clock. Check it on the first device run.
