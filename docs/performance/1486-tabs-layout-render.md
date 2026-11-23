# #1486 Switching tabs doesn't re-render the tab layout

Ticket #1486, part of #1481. Branch `fix/1486-tabs-layout-render`.

## Cause

expo-router renders a layout's route on every navigation, and the tabs layout followed the
pathname itself, so each tab switch rendered `TabsLayout` (the tab bar, the entry style, the kept
tabs) again. The headless tabs under it also read every tab's route from its path on each
navigation, and expo-router builds its whole route config again for each of those reads, which put
the `(tabs)` render near the 50 ms block line on its own.

## Change

- `TabsLayout` is memoized and no longer reads the pathname. A leaf (`FollowTab`) follows it, tells
  the tab-switch timing which tab is shown and reports the kept tabs, so the layout renders only
  when the kept tabs change.
- `RememberedLinking` gives the tabs navigator the router's linking with its path reads remembered
  by Core's `rememberPathStates`, keyed by path, config and segments. It holds at most 64 paths per
  config, and each read gets its own copy of the state.

## Emulator runs

Same machine, emulator (`sdk_gphone64_x86_64`, Android 15), perf builds repacked from the release
APK, React Compiler on, the 3,000-song seed (`scripts/perf/seed.ts`), offline, then
`perf.ts run --scenario tab-switch --launch-settle 60000`: 30 tab steps through Home, Library,
Playlists and Search. Before is the integration branch at `eea28d51f`; after is this branch with it
merged. The runner's Playlists target was matched to the tab bar rather than a Library row in a
local copy; the change isn't part of this branch.

Runner, median / p90:

|        Step        |     Before      |     After      |
| :----------------: | :-------------: | :------------: |
|      Response      | 94.1 / 113.3 ms | 32.5 / 48.7 ms |
|    First frame     | 56.1 / 66.3 ms  | 46.5 / 70.5 ms |
| `tab.layout` phase | 90.1 / 112.4 ms | 31.9 / 36.9 ms |
| Long tasks (count) |       15        |       0        |

App log, "Speed since" over the run:

|                     |   Before    |   After    |
| :-----------------: | :---------: | :--------: |
|   Tab first frame   | 98 / 471 ms | 34 / 77 ms |
|    Tab response     | 78 / 281 ms | 27 / 64 ms |
| Slow taps / hitches |   18 / 4    |   4 / 0    |

JS blocks over 50 ms during tab switches: before, `TabsLayout` blocked on 19 of the switches
(57 to 268 ms) and `(tabs)` on 5 (70 to 146 ms). After, `TabsLayout` blocked on none, and `(tabs)`
blocked three times (63 to 66 ms), each the first visit to a tab, when its screen mounts.

The first frame p90 stays above the 50 ms budget on the emulator; the reference phone's run is
still to do on the `ti` release.

## Not covered

Bringing Wave back from the home screen renders `TabsLayout` once for about 300 ms, before and after
this change alike (320 ms and 307 ms). That is the resume path, not a tab switch.
