# #303 Contained navigation renders: who renders on a push, a pop and a tab switch

Ticket: #303 (parent #301). Branch `feat/303-contained-nav-renders`, based on `perf/301-performance`
at 761375e.

**The device numbers are pending:** no phone was attached while the ticket was built. This doc
records the render fan-out found in the code, what changed, the runs that will measure it, and the
React Compiler findings. Nothing below is a phone measurement.

## What was measured

On the phone (pending), with a perf build before and after, same Library, same compiler filter:

```sh
node scripts/perf/perf.ts run --scenario push-settings,push-library,push-tracklist,push-empty,tab-switch,rapid-tabs,now-playing --label 303-before
node scripts/perf/perf.ts run --scenario push-settings,push-library,push-tracklist,push-empty,tab-switch,rapid-tabs,now-playing --label 303-after
node scripts/perf/perf.ts compare <303-before.jsonl> <303-after.jsonl>
```

The `renders` of each step is the trace the ticket asks for: render counts per instrumented
component between the touch and the flush. The pushes, pops and tab switches cover Settings, Home,
Library and a Track list. `push-empty` is the control: navigation with next to nothing to render.
`now-playing` checks that the hidden player still opens right. Latencies (`responseMs`,
`firstFrameMs`, `settleMs`) and frames answer "measured navigation doesn't regress".

This ticket adds two counters: `PlayerView` (inside the hidden Now Playing) and `LargeTitleScreen`
(Home's and Library's list). With the counters already there (RootLayout, TabsLayout, TabBar,
MiniPlayer, NowPlayingSheet, TrackList, SongsList), a step's counts show each fan-out below.

On the desktop: the guard test (`apps/mobile/src/perf/routeObservers.test.ts`) and the React
Compiler survey (below). Neither measures time.

## Before (761375e): the fan-out in the code

expo-router's `usePathname`, `useGlobalSearchParams` and `useSegments` read one context,
`RouteInfoContext`, which the navigation container gives a new value on every route change. Every
component calling them renders on every push, pop and tab switch, wherever it is, whatever
memoization sits above it. Four always-mounted places did:

| Observer                                         | Renders on every navigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RootLayout`, through `useTrackCurrentPath`      | The root and everything it renders: `OverlayHost`, `UnderNowPlaying`, the root `Stack` (with a new `screenOptions` object) and **`NowPlayingSheet`**, not memoized, with its always-mounted player: `Background`, `PlayerView`, `Scrubber`, `Transport`, the toggles. All this to copy the path into a module variable that only `open*()` reads, on a tap.                                                                                                                                                                                                          |
| `TabsLayout`, `tabOfPath(usePathname())`         | `MiniPlayer`, `TabBar` (its tabs, two glass views) or `SelectionChrome`, none memoized. And `ChromeProvider`, which gave its context a new `{ tabBar }` object on each render: every `useChromeInset`/`useTabBarTop` reader under the tabs rendered, on **every warmed tab**: Home's and Library's `LargeTitleScreen`, `TrackList`, `BrowseLists`, `PlaylistsList`, `PlaylistItems`, `AlphabetSpine`, Search, Stats views, album and artist screens opened in a tab. This held for root-stack pushes too (Settings, `/library/*`): the tabs stay mounted under them. |
| `PlayerView` (hidden Now Playing), `usePathname` | The player view, also through `useStreamedArtistLink` (`usePathname` and `useGlobalSearchParams`), with the sheet closed.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `AlbumHead` (each album screen), `usePathname`   | The album's header (play buttons, download button, artist link read-ahead) on every album screen kept in a stack, for a value that can't change on the album's own page.                                                                                                                                                                                                                                                                                                                                                                                             |

## After (this branch)

- **The root doesn't follow the route.** `FollowCurrentRoute` (`apps/mobile/src/library/routes.ts`),
  a leaf rendered by the root that returns null, observes the route and writes it to an external
  store in a layout effect, before the frame is drawn. `open*()` reads the store. Components that
  need the route read it with `useCurrentRoute(select, active)` / `useCurrentPath(active)`: they
  render only when their selection changes, and only while `active`.
- **The hidden player doesn't follow it.** `PlayerView` and `useStreamedArtistContext` use
  `useCurrentPath(shown)`: closed, they read the path when they render for another reason. Opening
  Now Playing renders them (the shown flag changes), so the first open frame has the current path.
- **The album header doesn't follow it.** `artistLink(ids, "")`: on the album's own page no artist
  is left out, which is what the old code computed whenever the header was visible.
- **The chrome context is a boolean.** `ChromeProvider` passes `tabBar` itself, so its readers
  render only when the tab bar comes or goes.
- **The floating chrome is memoized.** `MiniPlayer`, `TabBar` and `SelectionChrome` are `memo`
  components; their props were already stable (`openNowPlaying`, `entry.noteTap`, string ids).
- **`TabsLayout` keeps `usePathname`.** The tab-entry motion sets its start in a layout effect of
  the commit that shows the new tab. Taking the tab from the store would move it one synchronous
  re-render later; not worth the risk to the motion #304 reworks. With its children memoized and
  the context stable, a `TabsLayout` render costs itself and the `Tabs` navigator, and the
  navigator renders on every route change anyway (`expo-router/ui`'s `useTabsWithTriggers` reads
  the route info itself).

`apps/mobile/src/perf/routeObservers.test.ts` keeps it that way: it lists the modules allowed to
call expo-router's route hooks (`TabsLayout`, leaves, menus, overlay cards and toasts) and fails
when another one does. It checks modules, not call sites: a hook exported from an allowed module
(as `useTrackCurrentPath` was) still needs review.

Expected per navigation step, to be confirmed by the after run: `RootLayout`, `NowPlayingSheet`,
`PlayerView`, `MiniPlayer`, `TabBar` and `LargeTitleScreen` at 0 on pushes and pops; `TrackList`
and `SongsList` at 0 when their screen isn't the one changing; `TabsLayout` unchanged.

| Step                                     | Before (renders per step) | After       | Change |
| ---------------------------------------- | ------------------------- | ----------- | ------ |
| all `push-*`, `tab-switch`, `rapid-tabs` | **pending**               | **pending** | —      |

## Behavior kept

- Routing: `open*()` builds the same `detailPath` from the current path; the store is written
  earlier than before (layout effect instead of effect), never later.
- Insets: `useTabBarTop` and `useChromeInset` compute the same values; only the context's type
  changed.
- Selection: `SelectionChrome` renders the same; `useIsSelecting` and the selection stores are
  unchanged.
- Accessibility: no label, role or state changed. `UnderNowPlaying` and the sheet's
  `importantForAccessibility` are untouched.
- Now Playing's links: the artist link and its read-ahead use the path while shown, as before.
  A streamed song's menu (`YtSongActions`) follows the route as before (active by default).
- Tests: `apps/mobile` 282/282 (`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test
'src/**/*.test.ts' 'plugins/**/*.test.ts'`), Core 1,758/1,758, `scripts/perf` 45/45;
  `tsc --noEmit -p apps/mobile` clean.
- On the phone (pending): open a detail screen from Home, a section tab and the Library stack (it
  must open in the tab it was opened from); the artist link in Now Playing on and off an artist's
  page; Go to Artist on a streamed song on a YouTube Music artist page.

## React Compiler

**Decision: off, pending a phone comparison.** It stays off in normal builds. Measuring it needs
a full native build, and enabling it needs two code fixes first (below).

How to build the comparison. `app.config.ts` turns it on only when `WAVE_REACT_COMPILER=1` is set
while bundling (the evaluated config is unchanged otherwise; `expo config` checked both ways):

```sh
cd apps/mobile/android
rm -rf app/build/generated/assets/react "$TMPDIR/metro-cache"
WAVE_REACT_COMPILER=1 EXPO_PUBLIC_WAVE_PERF=1 EXPO_PUBLIC_WAVE_COMMIT=$(git rev-parse --short HEAD) \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
node scripts/perf/perf.ts run --scenario <the same as above> --label 303-compiler
node scripts/perf/perf.ts compare <303-after.jsonl> <303-compiler.jsonl>
```

Compare against the **after** run (contained renders), not the before, so the compiler is judged
on what it adds to this change. Adopt it only if latencies or frames improve beyond run-to-run
noise and the behavior checks above pass.

Compatibility, checked on the desktop with the compiler babel-preset-expo 58 ships
(`babel-plugin-react-compiler` 1.0.0, `target: "19"`, `panicThreshold: "none"`, as the preset sets
it for release builds), over the 326 source files of `apps/mobile/src` on this branch:

- **384 components and hooks compile, 9 are skipped.** Skipped ones stay as they are:
  `Press` (`++lastKey` on a module variable), `UpNextList` (a compiler invariant), two
  `nowPlaying/hooks.ts` and two `settings/ytAccount.ts` functions (Effect generators),
  `useSlideToChoose`, `settings/waveAccount.ts:50` (a value block in try/catch), `YtSongRow`.
- **Two hooks would change behavior.** `stats/hooks.ts` gives `useCallback` deps it doesn't read,
  to re-read on a change: `plays` in `useStatsRead` (re-read Stats after a play) and `songs` in
  `useArtistStats` (re-read an artist's stats after a scan). The compiler replaces manual memos
  with its own dependencies, which drop both: compiled, Stats and artist stats would stop
  refreshing. The compiler skips functions with `eslint-disable` comments for those rules, but
  not `oxlint-disable` ones, so the suppressions there don't protect them. Before enabling it, read
  the value inside the callback or mark the two hooks `"use no memo"`.
- Reanimated: shared values are read and written with `.get()`/`.set()` everywhere outside a dev
  screen, which is what Reanimated asks for with the compiler.
- Not checked: components that read a mutable module value directly in render (not through
  `useSyncExternalStore`) would show a stale value once compiled. The survey can't see them; the
  phone run's behavior checks are the test.

The survey scripts are outside the repo, in the #301 notes (`notes/303/compilerSurvey.cjs` and
`compileOne.cjs`); they need only the workspace's `node_modules`.

## Not measured, and negative results

- **Pending (no phone):** the before, after and compiler runs above; so is whether the removed
  renders were a measurable part of the navigation delay. Fewer renders is the claim this branch
  makes; a faster transition is not claimed until the runs say so.
- Left as they are: `TabsLayout`'s own render and the `Tabs` navigator's, on every route change
  (above); each `Tab` in the bar reads the navigator's context through `useTabTrigger`;
  short-lived route observers (menus, overlay cards, toasts, the selection bar's actions); the
  navigators whose state changed and the screens whose focus changed.
- Stalls this ticket doesn't touch and that memoization can't fix: native screen attach and
  detach, the glass views re-recording their backdrop on every pre-draw (#316), the tab-entry
  animation (#304), Now Playing's open path (#305), and JS-thread database reads on focus
  (`useLibraryQuery`, #309). A Perfetto run (`--perfetto`) of the same scenarios would show which
  of them remains on `mqt_v_js`, the main thread or `RenderThread`.
