# #305 Now Playing and its Queue: sheet trace, warm views and coalesced covers

Ticket: #305 (parent #301). Branch `feat/305-now-playing-warm`, based on `perf/301-performance` at
886dde8.

## What was measured

**On the phone (all pending, see the end).** The runner gained what the ticket asks to compare:

- `now-playing` (warm open and close) and the new `now-playing-first` (the first open after a
  launch). Both trace the sheet from the touch (`traceMs`): `nowPlaying.step` (JavaScript took the
  tap), `nowPlaying.spring` (the spring handed to the UI thread), `nowPlaying.notified` (the
  phase listeners done) and `nowPlaying.motion` (the sheet's first move on the UI thread, marked
  when JavaScript hears of it, with the delay as its detail).
- `queue` (switching once the Queue is warm) and the new `queue-first` (the first Queue after a
  launch). Their response is `visible` "queue"; their renders `UpNextList`, `UpNextRow`,
  `PlayerView`.
- Both under `--variant import` for switching during an import.
- Retained memory: the runner's `dumpsys meminfo` after each scenario, and `js.heapUsed` in each
  flush. Listener counts: each step's `listeners` (`playback`, `queue`, `queueTracks`,
  `nowPlaying`).

```sh
node scripts/perf/perf.ts run --scenario now-playing,now-playing-first,queue,queue-first --variant idle,import --label 305-before
node scripts/perf/perf.ts run --scenario now-playing,now-playing-first,queue,queue-first --variant idle,import --label 305-after
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

Builds:

- **Before**: 0ca3fd5. It has the trace marks, listener counts and new scenarios, and the cover
  coalescing (f6f23ec), but the old spring order and the old view mounting.
- **After**: 5e2fd10 (spring first, warm views, Queue scroll reset).

**On the desktop:** a replay of YT Music covers landing in the queue, the audit's replay
(`notes/audit-20261016/measure.mjs`) turned into `apps/mobile/bench/queueCovers.ts`:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/queueCovers.ts [path/to/old/queueTracks.ts]
```

`burst` lands every cover at once (all cached already). `paced` lands a pair per 16 ms tick (500
songs only, the timers make it slow). It counts the changes subscribers hear, the entries copied
into new maps, the replay's time and the longest the event loop went without running a timer, and
checks that every song ends with its cached artwork, thumbnail and palette.

## Desktop: queue covers (Node 24.19, Windows; no React, no I/O)

Before is `queueTracks.ts` at 886dde8; after is f6f23ec. Times are the median of three runs.

| Replay       | Changes before → after | Entries copied before → after | Time ms before → after | Longest hold ms before → after |
| ------------ | ---------------------: | ----------------------------: | ---------------------: | -----------------------------: |
| burst, 500   |                500 → 1 |                 250,000 → 500 |             17.9 → 4.3 |                     18.1 → 5.6 |
| burst, 2,000 |              2,000 → 1 |             4,000,000 → 2,000 |              241 → 5.9 |                      241 → 8.0 |
| burst, 5,000 |              5,000 → 1 |            25,000,000 → 5,000 |           2,095 → 12.2 |                   2,096 → 13.7 |
| paced, 500   |               500 → 12 |               250,000 → 6,000 |          5,676 → 5,790 |                    16.6 → 16.6 |

- Every replay ended with all artwork, thumbnails and palettes in place.
- `paced` takes as long as its ticks either way. Its longest hold is Windows' timer granularity
  (about 16 ms) on both sides, so it says nothing about responsiveness. What changes is that Up
  Next would re-render 12 times instead of 500.
- These numbers compare the store's work. They don't predict frames on the phone: each change
  there also re-renders Up Next's visible rows, which this replay doesn't run.

## What changed

**Covers** (f6f23ec). Core's `createQueueCoverBatcher` collects covers and hands them over in
batches: those landing within `QUEUE_COVER_FLUSH_MS` (500 ms) of the first one waiting go together.
The playing track's cover goes at once, with whatever waits, so Now Playing's tint and artwork
don't wait. Core's `withQueueCovers` merges a batch in one copy of the map. It fills in only
artwork, thumbnail and palette, and drops covers whose track has left the queue, so an old play's
cover can't bring its track back. It returns the same map, so no notification, when none applies.
`cacheYtCoversLater` flushes what waits when it ends, and skips a song that left the queue before
its turn (a new play no longer keeps caching the old play's covers). Up Next rows are memoized, so
a batch re-renders only the rows whose track changed.

**Sheet order** (9c5291e). `step()` used to set the phase, which runs every listener
synchronously (the sheet's and chrome's `useSyncExternalStore`, `useFocusedVersion`'s `setState`,
`screenSight`'s pause of the shared Library queries, the perf probe), and only then handed the
spring to the UI thread. The spring now goes first. React renders still come after `step()`
returns in both orders, so the gain is whatever the listeners cost themselves. The trace measures
it (`nowPlaying.spring` before vs after `nowPlaying.notified`). The before build is there to show
whether it was worth anything.

**Warm views** (2f33560, 5e2fd10). Switching views used to remount the one that came back: Up Next
rebuilt Legend List and every visible row, and the player its artwork (from a saved size). Now:

- The player and, once shown, the Queue stay mounted under React 19's `Activity`, hidden while
  another view shows (`QueuePane`, `PlayerPane` in `NowPlayingSheet.tsx`). Lyrics still mounts only
  while it shows.
- Hidden, a view runs no effects: no store subscription (`useQueue`, `useQueueTracks`, the
  playhead), no timer, no gesture handler, no frame callback, no reanimated reaction. The panes are
  memoized, so the sheet's renders (the playing state, the item) reach a hidden pane only when its
  own props change, and then at React's idle priority.
- Shown again, its effects re-run. `useSyncExternalStore` re-reads each store and re-renders if
  it changed meanwhile, so the Queue is right after a reorder, removal, skip or new play made
  while it was hidden. Rows whose entry and track didn't change don't render (memo).
- What a hidden Queue keeps: Legend List's drawn rows (the visible ones plus its draw distance),
  not the queue's length. Android keeps the native views, marked invisible, so the list keeps its
  scroll offset. A new play context (`queue.context`) scrolls it back to the top.
- A drag under way when the Queue is hidden ends where it began, with no move (`cancelDrag` in
  `upNextDrag.ts`).
- A hidden view's empty layout is ignored (the artwork's size, Up Next's height). A play or pause
  while the player was hidden sets the artwork's scale when it comes back instead of springing it.

Expected on the phone: `queue/open` should drop to about one `UpNextList` render and no
`UpNextRow` renders when nothing changed, against a full list and row mount before. `queue-first`
should stay as it was. Listener counts with the sheet closed should drop by the Queue's and the
player's subscriptions while hidden.

## Behavior kept

- **Sheet:** Core's `stepNowPlayingSheet` and `settleSheet` are unchanged, so drag cancellation
  (a flick back cancels), spring interruption (a tap while closing reopens) and the Back handler
  (added while shown) behave as before. Accessibility: the sheet's `pointerEvents`,
  `importantForAccessibility` and `accessibilityElementsHidden` follow the same phase. A hidden
  pane is `display: none`, so screen readers skip it, as they skipped the unmounted view.
- **Every open starts on the player** (`onNowPlayingHidden` resets the view).
- **Covers:** the existing tests (a few at a time, a cover after the song left the queue, a failed
  cover) pass unchanged.
- **Tests:**
  - Core: `queueCovers.test.ts` (merge, dropped tracks, batching on a virtual clock, the playing
    track at once). Full suite: 1,811 pass.
  - App: `queueTracks.test.ts` gained one change for 50 covers, the playing song's cover first,
    and no caching after the song left. Full suite: 289 pass.
  - Runner: traced marks timed, summed and compared; the new scenarios on the simulated phone. 51
    pass.
  - Typecheck: app, Core, `scripts/perf`.
- **Worklets:** `upNextDrag.ts` 25 worklet hashes (24 + `cancelDrag`), `PerfProbe.tsx` 2, through
  the app's Babel preset (`notes/313/workletize.cjs`).

## Not measured, and negative results

- **Device numbers: pending.** No phone was attached, and Gradle was busy with other builds, so no
  APK was built. Run the commands above with the before and after builds and put the tables here.
  The trace answers the ticket's first question: if `nowPlaying.notified - nowPlaying.step` is
  near zero in the before build, the listeners weren't delaying the spring, and the reorder is
  neutral.
- **Not seen running.** `Activity` on React Native's Fabric renderer hides a subtree with
  `display: none` (`cloneHiddenInstance`), and Android marks those views invisible but keeps them.
  The first run on the phone should check:
  - Queue → player → Queue keeps the scroll position, and the rows show at once;
  - Legend List's effects re-running on reveal don't blank or jump the list;
  - the player's artwork shows at full size at once after the Queue or Lyrics;
  - RNGH 3's `usePanGesture` and reanimated's `useScrollOffset` re-attach after a reveal (drag a
    row, and auto-scroll, after switching views a few times);
  - TalkBack skips the hidden pane.
- **Tap path still on JavaScript.** The mini player's tap reaches `openNowPlaying` through `Press`
  on JavaScript at finger-up, so a busy JS thread still delays the open. The swipe-up already
  moves the sheet on the UI thread. Moving the tap there too (a tap gesture that starts the spring
  on the UI thread) would need the sheet's phase on the UI thread. Left for the trace to justify:
  `nowPlaying.step` from the touch is that delay.
- **Queue not prewarmed.** The Queue joins the warm set when first shown, not at the sheet's first
  open: a hidden pre-render at the open would compete with it for JavaScript. `queue-first` says
  whether a first Queue is slow enough to warrant it.
- **`recycleItems` left off** for Up Next. The warm Queue and memoized rows cover the switching
  case; recycling would change the rows' mount behavior that #313's drag relies on, with no
  measurement to justify it.
