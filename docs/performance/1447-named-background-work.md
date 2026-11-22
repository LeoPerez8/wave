# #1447 Name every stepped background work in the block log

Ticket: #1447 (parent #1432). Branch `feat/1447-name-background-work`, based on the
`feat/1432-reference-phone` integration branch.

## Why blocks logged as "unnamed background work"

`BackgroundWorkName` was a `Context.Reference` whose default was `"unnamed background work"`.
Stepped work (`pacedSteps`, `runSteps`) read it for each slice, and the scheduler's free turns
(`freeTurn`, `startupTurn`, `whenFree`) defaulted their name the same way. Any run that nobody
named still typechecked, and its slices and turns reached the block log under the default.
#1437, #1446, #1448 and #1453 named the runs they touched, but the default kept every other
call site quiet.

## What changed

- `BackgroundWorkName` is a `Context.Service` with no default. A stepped run, a turn between its
  slices (`Turn`) and anything built on them need it, so stepped work that no caller names
  doesn't typecheck, and it throws if run untyped. `namedWork(name)` gives the name.
- The scheduler's helpers (`inSlice`, `namedAsyncWork`, `whenFree`, `freeTurn`, `startupTurn`)
  take the name as a required argument.
- Every call site the compiler then flagged got a name: Home's mix builds and their inputs,
  Discover's taste profile and artist graph, the follows checks, the genre list and its order,
  Find in list, playlist imports and suggestions, replacement duplicates, the YT Music library
  import, the download decision and replacements, the library scan start, the Magic Queue start
  and pages, and Stats' recaps. The network log (`withNetworkLog`) names its run through
  `namedWork` too.
- Frame-paced recommendation turns now mark the block log (`turnTaken`) under the work that took
  them, as the scheduler's free turns already did. See below.
- Tests and benches run stepped work through `lib/steppedTesting.ts`, which names it "test".
  App code never imports it.

The guard is in `apps/mobile/src/perf/backgroundWorkGuard.test.ts`. It fails when:

- `BackgroundWorkName` gets a default again;
- any source holds the "unnamed background work" fallback;
- code other than `namedWork` and the test runners provides the name;
- one of the helpers' names becomes optional or defaulted;
- `freeTurn()` or `startupTurn()` is called with no name;
- the names of #1448's and #1453's sliced work (`backgroundFill`, `downloads resume`,
  `Magic Queue batch`) go missing.

On the old `stepped.ts` it fails two of its six tests. With a bare `freeTurn()` put back into
the downloads resume, it fails two.

## The "no background work" blocks after Home's first content

#1434's emulator launches showed blocks of 52 to 173 ms after the first settle with nothing
named. A block gets a name only from:

- a slice that ran inside it;
- a render span (`useRenderCost`);
- a work span: a free turn's 1 s window, or `workBegan`;
- before the first settle, the latest startup step.

Reading the code for what runs on the JS thread after Home's first content, outside all four:

1. **Work after a frame-paced recommendation turn.** Home's mix builds, Discover, similar
   artists, the Magic Queue section, the taste profile and playlist recommendations pace their
   paged reads with `recommendationTurnEffect`. It waits for an animation frame, not for the
   scheduler, so it never called `turnTaken`. The reads and the bookkeeping after each resume
   run outside any slice: a long page there had no work span to fall in, unless another work's
   turn happened to be open. This is the most likely source. Those turns now mark the block log
   under their work's name (`createRecommendationWork`'s `turnTaken` port, wired to
   `workTurnTaken` in `backgroundWork.ts`). A test in `lib/recommendationTurn.test.ts` covers
   it.
2. **Renders no render span covers.** `useRenderCost` times Home's screen and sections. A
   component re-rendered by a store notification (the library, playback or download stores),
   such as a row or a sheet, and React's passive effects after a commit, have no span. A long
   one logs as no background work.
3. **Effect continuations outside stepped work.** A plain `appRuntime.runPromise` read that isn't
   stepped work has no name. Its continuation after a native answer (a SQLite read, the YT Music
   client) only gets one if a turn's window is still open.
4. **Garbage collection and the runtime's own work** (Hermes GC, bridge or JSI callbacks). These
   aren't JS work Wave can name.

Item 1 now gets a name. Items 2 to 4 still log as no background work. Only a device or emulator
run can show how the 52 to 173 ms blocks split between them: this ticket ran without an emulator.

## Before and after

- Before: stepped work with no name typechecked and logged its blocks as unnamed.
  Recommendation turns left their pages unnamed.
- After: `tsc` on `apps/mobile` reports 0 errors with the name required everywhere. The app's
  tests pass (1375 passed, 1 skipped). The guard passes 6 of 6 and fails on the old code.

## Not measured

- No emulator or phone run. Whether "unnamed background work" is gone from the block log, and how
  many of the "no background work" blocks now carry a recommendation work's name, needs a cold
  launch with the 3,000-song seed (`docs/agents/emulator-checks.md`).
