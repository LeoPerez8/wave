# #721 Glass and the screen under Now Playing: what a settled-open sheet still pays for

Ticket: #721 (parent #712). Branch `feat/721-glass-under-now-playing`, based on
`origin/feat/712-faster-lighter` at 336ac6ab. Closes the case #316 left open: covered isn't
hidden.

## What changed

Before, with Now Playing settled open, every frame the window drew (Up Next scrolling, lyrics
moving, the cover's crossfade) also drew the whole app under the opaque sheet: the kept tabs'
display lists, plus the tab bar, Search pill and mini player glass. Each glass view recorded
its backdrop on the UI thread and rendered a blurred, refracted layer on the RenderThread
(#316, "The work glass does per frame").

Now a native view in the sheet, `WaveCoverView` (`modules/wave-glass`), makes the screens under
Now Playing (`UnderNowPlaying`'s view) `INVISIBLE` while two things hold:

- JS says the sheet settled open (`useNowPlayingSettled`: the opening spring finished and the
  player content drew).
- The sheet, as placed in this frame, lies over every pixel of the screen under it (the decision
  `NowPlayingCover.hides`, JVM-tested).

Android neither records nor draws an `INVISIBLE` subtree, and its glass, no longer shown, skips
its backdrop recording through #316's `isShown` skip. Nothing under the sheet is unmounted or
laid out again: React keeps rendering it, Fabric keeps mounting it, only drawing stops.

The check runs on every window pre-draw, after the frame's animations and gestures have
placed the sheet. A drag down moves the sheet on the UI thread before JS hears of it, and a
close's spring moves it a frame after JS asks, so the frame in which the sheet first leaves its
rest is the frame that draws the screen under it again. Each glass view runs the same check
first in its own pre-draw (`WaveCoverView.refreshAll`), so the order of pre-draw listeners
can't leave a glass a frame behind.

## What was measured

Nothing on the phone (none attached). Desktop checks only:

- `NowPlayingCoverTest` (6 JUnit tests): a settled sheet over the whole screen hides it; an
  unsettled sheet, a sheet one pixel down, a narrower sheet, or a sheet or screen not laid out
  doesn't. Compiled and run with the cached Kotlin 2.2.21 compiler against a JUnit stub; the
  Gradle task (`:wave-glass:testDebugUnitTest`, now in CI's native unit tests) wasn't run here.
- The runner's simulated-phone test covers the new glass scenario `scroll-queue`.

The scenario: `scroll-queue` (`--scenario glass`, or by name) opens Now Playing's Queue, then
flings Up Next up and back down, so the sheet draws frames while settled open over Home. It
needs more songs up next than fit on the screen.

```sh
# The same S24+, fixture and perf-build kind for both; ABBA order against thermal drift.
node scripts/perf/perf.ts run --scenario scroll-queue,now-playing,soak-player --label 721-before   # a perf build of 336ac6ab
node scripts/perf/perf.ts run --scenario scroll-queue,now-playing,soak-player --label 721-after    # this branch
node scripts/perf/perf.ts run --scenario scroll-queue,now-playing,soak-player --label 721-after
node scripts/perf/perf.ts run --scenario scroll-queue,now-playing,soak-player --label 721-before
node scripts/perf/perf.ts compare perf-results/721-before-….jsonl perf-results/721-after-….jsonl

# Glass under the sheet costs nothing: on this branch, live and off should match on scroll-queue.
node scripts/perf/perf.ts run --scenario scroll-queue --glass live --label 721-live
node scripts/perf/perf.ts run --scenario scroll-queue --glass off --label 721-off
```

Budgets (120 Hz, 8.3 ms a frame):

- `scroll-queue` flings: frame p90 within 8.3 ms and a deadline-miss rate no higher than
  before. The pre-draw and layout part (where glass records) and the issue and GPU-after-swap
  parts (where the blur layers and the tabs render) must drop against before; draw and sync
  should drop too, with the tabs' subtree gone from the frame.
- On this branch, `scroll-queue` with `--glass live` against `--glass off`: no difference
  beyond run-to-run noise on any frame part. Before, `live` − `off` is the glass under the
  sheet.
- `now-playing` `close` (Close Now Playing): spring start within its 50 ms budget
  (`TIMING_BUDGETS`), first frame and frame p90 no worse than before. This is where the change
  can cost: the close's first frame now draws the screen under again (`setVisibility`
  dispatches down its tree, and whatever changed while hidden records then instead of when it
  changed).
- `soak-player`: no growth in retained memory or views against before.

Also check once by hand that the screens under are hidden: with Now Playing settled open,
`adb shell dumpsys activity top` lists the view hierarchy, where the `ReactViewGroup` holding the
screens (the sibling just before the sheet's) has `I` as its first flag; closed, `V`.

## Before (336ac6ab)

**Pending: the owner's S24+ run.** Record the run header (APK, commit, phone, Android, refresh
rate, compiler filter, Library size and the queue's length), the summary for `scroll-queue`,
`now-playing` and `soak-player`, and the results files under `docs/performance/results/`.

## After

**Pending: the owner's S24+ run.** The same, then `compare`'s table and its warnings, and the
`live` against `off` comparison on this branch.

## Behavior kept

- Nothing visible changes while Now Playing is open: the sheet is opaque (its ground is a
  gradient of opaque `#rrggbb` colours over the whole window) and lies over the whole screen
  under it whenever that screen is hidden.
- Closing (Close Now Playing, Back, a link, a card) and drag-to-dismiss show the screen under
  the sheet, its glass included, from the first frame the sheet moves. A drag that springs back
  hides it again once the sheet settles.
- The screens under keep rendering and mounting (song changes, stars, a link's navigation
  under a closing sheet); their effects, queries and accessibility state are as before.
- Dialogs, menus and the toast over Now Playing keep their glass: their backdrop is the whole
  app, which while hidden shows only the sheet, as it looks.
- `NowPlayingSheet` gains no render: it already follows `settled`.

To check on the phone: open and close by tap, chevron, Back and drag (fast and slow, and a
drag released to spring back), at the start of a close looking at the bottom of the screen
(mini player and tab bar glass); a link from Now Playing (artist, album); a long-press menu,
the lyrics card and Share over Now Playing; a theme change and rotation while open; TalkBack
on the screen after closing.

## Not measured, and negative results

- Every device number: **pending**.
- The Kotlin view (`WaveCoverView`, the `WaveCover` view registration, the shared
  `findByNativeId`) wasn't compiled: no Android SDK in the worktree. Only the pure decision
  and its tests were.
- Hiding by alpha 0 instead was rejected: HWUI skips drawing an alpha-0 node, but the UI thread
  still records its dirty children and each glass under it still records its backdrop, since
  alpha doesn't make it not shown.
- An `INVISIBLE` view's `SurfaceView` loses its surface. Nothing under Now Playing uses one
  (React Native Skia, in Settings only, draws to a `TextureView`).
