# #304 Warmed tabs: rapid taps, kept tabs and how a hidden tab is kept

Ticket: #304 (parent #301). Branch `feat/304-warmed-tabs`, based on `perf/301-performance` at
a82e41d.

**The device numbers are pending:** no phone was attached while the ticket was built. This doc
records what the code does on a tab switch, what changed, the instrumentation and the runs that
will choose how hidden tabs are kept. Nothing below is a phone measurement.

## What a tab switch did (a82e41d)

- **A tap was a switch, every time.** `Tab.onPress` called expo-router's trigger, which queues a
  routing intent; the drainer dispatches it in a passive effect. A burst of taps queued one switch
  per tap, and each one rendered and committed its tab in turn, mounting tabs never visited only
  to hide them a commit later. Nothing coalesced them: `focused` is committed state, so taps that
  arrived before their switch committed all went through.
- **The entry motion started from nothing.** `useTabEntry` set opacity to 0 in the commit that
  showed the tab, then faded to 1 in 280 ms (ease-out exponential). By the curve, the first frame
  at 120 Hz showed the new tab at about 18% opacity, a kept tab's ready content included, and
  every switch in a burst started from 0 again.
- **Hidden tabs**, from expo-router's `TabSlot` defaults: lazy, every visited tab kept mounted
  for the rest of the session (tabs taken off the bar included), hidden with `display: none` and
  detached from the window by react-native-screens (`ScreenContainer` with `enabled`), never
  frozen (`freezeOnBlur={false}` is hard-coded).
- What `display: none` costs, from React Native 0.88's sources: Yoga zeroes the hidden subtree's
  layout, and React Native skips laying out a hidden node's children (their shadow nodes keep
  their frames, so native views keep their size and scroll offset, and no `onLayout` fires
  inside). Showing the tab again lays its whole subtree out again in the commit, on the JS
  thread. Detaching adds a native re-attach on the UI thread. Which of the two matters on the
  phone is what the comparison below is for.

## What changed

- **Rapid taps settle on the last tab** (Core `stepTabSwitch`, `packages/core/src/tabSwitch.ts`;
  app `apps/mobile/src/chrome/tabSwitches.ts`). A tap switches at once. While that switch hasn't
  shown, more taps only record where to end up; when it shows, the last tab tapped goes next,
  and the tabs in between are skipped. At most one switch is in flight. No tap is held back, so
  there is no debounce. A switch that hasn't shown after `TAB_SWITCH_LOST_MS` (1 s) stops
  holding the bar, so a dropped switch can't leave it dead. A tap on the tab on screen sends
  nothing, as before.
- **The entry never hides ready content.** A tapped tab slides in from the tapped tab's side
  while it fades up from `ENTRY.tabOpacity` (0.5), not 0. Reduce motion still only fades, from
  the same start, in 150 ms. Core decides when a tab enters (`enter` from `stepTabSwitch`): only a
  tapped tab arriving, never a launch, a link, Back or a tab coming back from under a pushed
  screen.
- **Retention is bounded** (Core `keepTabs`, app `useKeptTabs` in
  `apps/mobile/src/chrome/tabScreens.tsx`). The tabs kept mounted while hidden are the latest
  ones on the bar, at most `retain` (default: the bar's five). A tab taken off the bar is no
  longer kept. With a smaller `retain`, the tab left longest ago is unmounted and built again on
  its next visit.
- **How a hidden tab is kept is a bundle-time choice**, so the phone can compare them without
  code changes. `TabSlot` now renders through `renderTabScreens`, expo-router's default render
  with these choices (`EXPO_PUBLIC_WAVE_TABS`, parsed by Core `parseTabScreens`):

  | Choice                      | Hidden tab                                                                                         |
  | --------------------------- | -------------------------------------------------------------------------------------------------- |
  | `detach` (default)          | taken out of the window by react-native-screens                                                    |
  | `attach`                    | left in the window, `display: none` (Fabric makes the view `INVISIBLE`)                            |
  | `display-none` (default)    | `display: none`: showing it lays the subtree out again                                             |
  | `keep-layout` (with detach) | keeps its layout, every tab filling the slot (`position: absolute`): showing it lays nothing out   |
  | `freeze` (with detach)      | its React tree is frozen (`freezeOnBlur`): no renders while hidden, pending ones run when it shows |
  | `retain=<n>`                | at most n tabs kept mounted, the shown one included                                                |

  **The default is unchanged** (`detach,display-none,retain=5`): the ticket asks to measure before
  choosing, and no phone was attached. A perf build reports its choice in `tabs.screens`.

### Instrumentation

- `tab.commit` (`<tab> first|warm`): the layout effect of the commit that shows the tab. React's
  work for the switch (render, mount or re-show, layout) is done. `first`: the tab was built for
  this visit; `warm`: it was kept.
- `tab.layout` (tab): the shown tab's screen got a new layout. None with `keep-layout`, which is
  the point of it.
- `tab.settled` (label): a tab showed with no switch left on its way.
- The runner times named marks per step (`phases` in `scenarios.ts`, `phasesMs` in results,
  a phase table in `summary`, medians in `compare`). `tab-first` (new) and `tab-switch` time
  `tab.commit` and `tab.layout`. Past them, the frames (`firstFrameMs`, `settleMs`) are native
  work: re-attaching the tab's views, the UI thread's layout and drawing. A `--perfetto` run
  splits that further (`main`, `RenderThread`).
- `rapid-tabs` now waits for `tab.settled` on the last tapped tab instead of the first `route`
  after the last tap, which could be a tab from earlier in the burst.

## What to measure (pending)

Perf builds, same phone, same Library, same compiler filter; one APK per choice (only the JS
bundle differs between them):

```sh
cd apps/mobile/android
rm -rf app/build/generated/assets/react "$TMPDIR/metro-cache"
EXPO_PUBLIC_WAVE_TABS=<choice> EXPO_PUBLIC_WAVE_PERF=1 EXPO_PUBLIC_WAVE_COMMIT=$(git rev-parse --short HEAD) \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
node scripts/perf/perf.ts run --scenario tab-first,tab-switch,rapid-tabs --label 304-<choice>
```

1. **Before**: `perf/301-performance` at a82e41d (`304-before`), the same scenarios. `tab-first`
   doesn't exist there; run its steps with this branch's runner against the old APK (the runner
   needs no app change for it; `tab.commit` and `tab.layout` will be missing on the old APK). The
   old APK has no `tab.settled` either, so its `rapid-tabs` responses come out missing: compare
   bursts by `settleMs`, frames and `finalRoute` there.
2. **After, default** (`304-detach`): rapid taps and the entry motion alone. Expected: `rapid-tabs`
   responds sooner and renders fewer TabsLayout/TabBar commits per burst; `tab-switch` unchanged.
3. `keep-layout`, `attach`, `freeze`, then `retain=3` with the best of them. Fixture `tabs` should
   name four tabs (Home, Library, Playlists and another section) so `retain=3` evicts.

Choose by `tab-switch/idle/tab` (warm visits): `tab.commit` (JS layout), `firstFrameMs`,
`settleMs`, frame p90 and late frames; `tab-first` must not regress; memory from the
`tab-switch` row (PSS, graphics). Adopt a choice only if it beats `detach,display-none` beyond
run-to-run noise. Then change `DEFAULT_TAB_SCREENS` in `packages/core/src/tabScreens.ts`.

What each choice is expected to show, to check against the numbers rather than assume:

- `keep-layout`: no `tab.layout` on a warm visit and an earlier `tab.commit`; the native re-attach
  stays.
- `attach`: the native re-attach goes; the JS relayout stays; hidden tabs still hold their views
  (memory).
- `freeze`: helps only if hidden tabs render while hidden (most of that went in #303 and
  `useFocusedVersion`); can add work to the switch that unfreezes.
- `retain=3`: less memory, a `first` visit cost each time an evicted tab comes back.

| Step                      | Before      | After (default) | Best choice |
| ------------------------- | ----------- | --------------- | ----------- |
| `tab-first/idle/first`    | **pending** | **pending**     | **pending** |
| `tab-switch/idle/tab`     | **pending** | **pending**     | **pending** |
| `rapid-tabs/idle/burst`   | **pending** | **pending**     | **pending** |
| memory after `tab-switch` | **pending** | **pending**     | **pending** |

## Behavior kept

- Tests: Core `tabSwitch.test.ts` (11) and `tabScreens.test.ts` (12): coalescing, settling on the
  last tap, no duplicate switch, the lost-switch bound, when a tab enters, retention, the choice
  parser. `scripts/perf` tests cover phases, the `tab-first` scenario and `rapid-tabs` settling
  on the simulated phone. After merging `perf/301-performance` at a57e84d: app 293/293, Core 1,827/1,827,
  `scripts/perf` 77/77; `tsc` clean for
  `apps/mobile`, `packages/core` and `scripts/perf`.
- The default render is expo-router's (same `Screen` props and styles) apart from tabs that left
  the bar, which are unmounted when hidden. Navigation state is held by the router, not by the
  mounted navigator, so an unmounted tab's nested route is expected to come back with it. Check on
  the phone (pending): take a tab off the bar after opening an album in it, put it back, tap it.
- A tab tap still runs Search's focus request first, and switches through the trigger's own
  `switchTab` (the same `JUMP_TO`/`NAVIGATE` the trigger built). A tap on the tab on screen with
  no switch on its way is a re-tap (Core `retapped`): it runs the trigger's own `onPress`, which
  emits `tabPress`, so the tab's list scrolls to the top (`useScrollToTop`) and its stack pops to
  its root, as before #304. (The first version of this ticket dropped `tabPress`; the review
  caught it.)
- `TabBar` stays memoized: `onTabTap` is a stable callback.
- Accessibility: tab roles, labels and selected state unchanged; hidden tabs are detached or
  `display: none` as before (`keep-layout` hides them by detaching).
- On the phone (pending): a nested route and scroll position survive repeated visits with every
  choice; reduce motion only fades.

## Not measured, and negative results

- **Pending (no phone):** every number above, and the choice of how hidden tabs are kept.
- Not claimed: that the entry motion's start opacity was a measurable part of the delay. It was a
  visible blank, removed on reading the code.
- `TabsLayout` still renders on every route change (`usePathname`, #303), and so does the `Tabs`
  navigator and each tab trigger.
- `attach` with `keep-layout` isn't offered: a laid-out tab left in the window would draw under the
  shown one. `freeze` needs `detach`: react-native-screens only freezes screens it manages.
