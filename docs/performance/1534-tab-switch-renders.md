# #1534 Switching tabs renders neither the tab left nor the tab layout

Ticket #1534, part of spec #1528. Branch `feat/1534-tab-switch-no-render`, based on
`feat/1528-screens-show-at-once` at `61dfbf4ef`.

## Cause

On every navigation, react-navigation's `useDescriptors` (inside expo-router) builds each route's
descriptor again. The descriptor's `render()` returns a new element tree:
`NavigationActivityProvider`, `NavigationBuilderContext.Provider`, `NavigationProvider`,
`SceneView`, then the screen. Options are a new object each time too. expo-router's `TabSlot`
renders on each navigation and calls `renderFn(descriptor)` for every kept tab, so React got new
elements for each tab. None of those components is memoized, so React rendered each tab's whole tree:

- **The tab left.** react-native-screens freezes a hidden screen one render late (`DelayedFreeze`:
  `setTimeout(0)` before `Freeze` suspends). The render that hides the tab gave it new elements,
  so it rendered whole once more before the freeze landed.
- **The tab shown.** It unfreezes in the same commit and gets new elements, so it rendered whole
  too.
- **`(tabs)`.** The tab navigator's state lives in the root stack's state, as the `(tabs)` route's
  nested state, so every switch renders the root stack, the `(tabs)` screen and the tab navigator.
  That part is inherent and shallow. `TabsLayout` stays out of it (#1486).

**Correction (code review of #1539).** This doc first said `(tabs)` still blocked after #1486
because its span held the kept tabs' renders. The emulator runs of #1535 and #1536, on builds with
this change, disproved it: the tab trees stopped rendering on a switch, and `rendering (tabs)`
blocks stayed, 32 to 36 a session. Read again, those blocks came on **a tab's first visit after a
launch** (perf.ts's `tab-first`, every ~6 s), not on warm switches, which logged none. A profiler
build (`EXPO_PUBLIC_WAVE_PERF_PROFILER=1`) with marks around each step showed the cause, the same
on every first visit to Library and Playlists:

- the commit was `(tabs)`'s, about 62 to 82 ms of render, of which the tab's own tree took 20 to
  25 ms;
- before that tab rendered, the tabs navigator read all nine tabs' routes from their paths again
  (expo-router/ui's `useTriggersToScreens`), about 5 ms each, 45 ms in all;
- the same reads in the next pass, for the same route, took 0 ms each.

`RememberedLinking` (#1486) remembers those reads with Core's `rememberPathStates`, which keyed
each read by its path and every segment of the route showing. Every route shown for the first time
(a tab's first visit, and every push over the tabs) missed for all nine. expo-router uses the
segments only to sort its route configs, where a route group (`(tabs)`) at its position is all that
counts. The key now holds only that, so the answers are the same and a new route reads nothing
again (`packages/core/src/pathStates.ts`, its tests).

## Change

`renderTabScreens` (`apps/mobile/src/chrome/tabScreens.tsx`) puts each tab's content (page-gradient
scope, `RenderCost`, `descriptor.render()`) in a memoized `TabContent`. Its comparison holds while
these are all unchanged:

- the route object (react-navigation keeps it while key, name and params hold);
- the route's nested state, read at render time under `CHILD_STATE`, the symbol expo-router's
  copy of react-navigation keeps it under (imported from
  `expo-router/build/react-navigation/core/useRouteCache`; a development bundle throws if it's
  gone), because the route object stays the same across a push inside the tab;
- the navigation helpers (cached per route);
- the options, compared field by field, since a new object comes each navigation.

The `Screen` around it still renders on a switch: its `activityState`, style and freeze change.
Its children element keeps its identity, though, so React bails out under it. The tab left and the
tab shown render nothing for the switch. A tab's own state and stores still render what changed in
it, and a frozen tab renders the changes it missed when it shows again. A push or pop inside a tab,
new params and `setOptions` all render that tab, and only that tab.

Guard: `apps/mobile/src/chrome/tabRenders.test.ts` drives `renderTabScreens` through a navigator
that builds descriptors the way react-navigation does: fresh options and elements each navigation,
routes from expo-router's own route cache (`useRouteCache`, so a change to it or to `CHILD_STATE`
fails here), cached navigation, and a screen that freezes one timer late. It checks:

- a switch between kept tabs renders no tab;
- a nested push renders only that tab, and so does a re-tap's pop back to the tab's root;
- params or options changed while a tab was hidden render it once, when it shows.

`chrome/tabBar.test.ts` checks that tapping Search asks for its field's focus, when it switches
and when it's re-tapped.

Before the change, the switch test failed with both the tab left and the tab shown rendering.

## Emulator results (code review of #1539)

AVD `wave-run-903` (android-36 x86_64, SwiftShader), the reference seed (3,000 songs), network off,
perf builds, 28 November, one session per build of `emulator-check` (reference taps, 1 iteration)
then `perf.ts run --scenario tab-first,tab-switch,skip-library,now-playing` (`tab-first` 5
iterations and a warm-up, `tab-switch` 3 iterations of 10 switches). Before: the integration tip
`b079ddac7` (this ticket's `TabContent` without the route-read fix). After:
`fix/1528-code-review` at `1b9227e36`.

| In the `run` part of the session                      | Before      | After      |
| ----------------------------------------------------- | ----------- | ---------- |
| `rendering (tabs)` on `/library` and `/playlists`     | 14          | 1 (57 ms)  |
| `rendering tab:<name>`                                | 0           | 0          |
| warm `tab-switch`: `(tabs)` or `tab:<name>` blocks    | 0           | 0          |
| `tab-first`: `(tabs)` span, median / max (10 visits)  | 73 / 102 ms | 26 / 41 ms |
| `tab-first`: visits with a `(tabs)` span over 50 ms   | 10 of 10    | 0 of 10    |
| `tab-first`: Library's first frame, median (5 visits) | 190 ms      | 159 ms     |

Both builds also log ten `rendering (tabs)` blocks on `/`: each is a launch (the tab-first
iterations start cold), where `(tabs)` mounts with Home inside it. They aren't switches.

A push over the tabs still logs `rendering (tabs)` (Settings, an album, an artist, a playlist),
though the blocks are shorter: on the first push to each after a launch, the album's 322 → 146 ms,
the artist's 306 → 168 ms, Settings' 171 → 101 ms, the playlist's 210 → 100 ms. That name is the span's, not the work's: the root
stack renders `(tabs)` before the pushed screen, and `(tabs)`' span runs to its commit, so it holds
the pushed screen's render too. The pushes' first frames are in
`1537-pushed-screens-first-frame.md`.

Criterion 3, by hand on the after build: in the Playlists tab, a pushed playlist and a re-tap of
Playlists went back to the tab's root; a scrolled Playlists list and a re-tap went back to its top;
a tap on Search brought the keyboard up (`dumpsys input_method`: `mInputShown=true`).

The phone confirms all of it from the WaveTiming lines in the owner's next exported log on the `ti`
release. The owner's log of 26 to 28 November is the before: `tab:index` 60 to 230 ms,
`tab:library` 128 to 148 ms, `(tabs)` up to 180 ms per switch.
