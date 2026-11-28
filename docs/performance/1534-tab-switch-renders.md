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
  That part is inherent and shallow. `TabsLayout` stays out of it (#1486). The block log names
  `(tabs)` because its `RenderCost` span runs from its render to its commit's layout effects, and
  that span held the two tab trees above. That is why `(tabs)` still blocked after #1486: the time
  was the kept tabs' renders, not the layout.

## Change

`renderTabScreens` (`apps/mobile/src/chrome/tabScreens.tsx`) puts each tab's content (page-gradient
scope, `RenderCost`, `descriptor.render()`) in a memoized `TabContent`. Its comparison holds while
these are all unchanged:

- the route object (react-navigation keeps it while key, name and params hold);
- the route's nested state, read from the route's private `CHILD_STATE` symbol at render time,
  because the route object stays the same across a push inside the tab;
- the navigation helpers (cached per route);
- the options, compared field by field, since a new object comes each navigation.

The `Screen` around it still renders on a switch: its `activityState`, style and freeze change.
Its children element keeps its identity, though, so React bails out under it. The tab left and the
tab shown render nothing for the switch. A tab's own state and stores still render what changed in
it, and a frozen tab renders the changes it missed when it shows again. A push or pop inside a tab,
new params and `setOptions` all render that tab, and only that tab.

Guard: `apps/mobile/src/chrome/tabRenders.test.ts` drives `renderTabScreens` through a navigator
that builds descriptors the way react-navigation does: fresh options and elements each navigation,
cached routes and navigation, the nested state under `CHILD_STATE`, and a screen that freezes one
timer late. It checks three things:

- a switch between kept tabs renders no tab;
- a nested push renders only that tab;
- params or options changed while a tab was hidden render it once, when it shows.

Before the change, the switch test failed with both the tab left and the tab shown rendering.

## Emulator runs: not run

None of these numbers exist yet. On 28 November the PC couldn't run the emulator:

- `wave-run-903`'s AVD config is gone. `~/.android/avd/wave-run-903.avd` holds only `snapshots/`,
  there's no `wave-run-903.ini`, and `emulator -list-avds` lists nothing.
- `df -h /` shows `233G 214G 7.3G 97% /`. `scripts/emulator-apk.sh` refuses below 12 GB, and the
  AVD needs about 7.4 GB for its data partition.
- Agent device access is off in this session.

Still to measure, emulator and then phone: `perf.ts run --scenario tab-switch` before and after on
the 3,000-song seed. Look for `rendering tab:<name>` and `rendering (tabs)` blocks, and the
`HomeScreen`, `LibraryScreen` and `SearchScreen` render counts (`useRenderCount`) across switches
between kept tabs. The phone confirms it from the WaveTiming lines in the owner's next exported log
on the `ti` release. The owner's log of 26 to 28 November is the before: `tab:index` 60 to 230 ms,
`tab:library` 128 to 148 ms, `(tabs)` up to 180 ms per switch.
