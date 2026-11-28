# #1535 Hidden tabs are kept the fastest way, chosen by measuring

Ticket #1535, part of spec #1528. Branch `feat/1535-tabs-mode`, based on
`feat/1528-screens-show-at-once` at `2f2a0300d` (with #1534).

**Every number below is an emulator result** (AVD `wave-run-903`: android-36 google_apis x86_64,
pixel_7, 4 GB RAM; perf builds of `2f2a0300d`, x86_64, ART filter `speed`), not a phone
measurement. No phone was connected. The reference phone confirms it from the owner's next
exported log on the `ti` release ("What the phone log should show", below).

## Result

Core's default becomes **`detach,display-none,thaw,retain=5`**: a hidden tab is still detached and
`display: none`, but no longer frozen. On a warm tab switch the first frame came **38 ms sooner**
(130 ms median against 168 ms), beyond the default's run-to-run spread, with no memory cost.
Screens under a push stay frozen (#1423), through a choice of their own (`freezeStacks`), since
pops weren't measured here.

Medians / p90 over every step of every run, in ms. "Runs" is `perf.ts run` invocations (two a
session); `tab-switch` has 27 warm switches a run, `tab-first` about 10 first visits, `rapid-tabs`
5 bursts.

**Warm switch to a kept tab** (`tab-switch/idle/tab`), the row the choice is made on:

| Choice                                     | Runs | `tab.commit` | Response | First frame | First frame, each run |  Settle | UI frames missed | `tab.layout` |
| ------------------------------------------ | ---: | -----------: | -------: | ----------: | --------------------- | ------: | ---------------: | -----------: |
| `detach,display-none,freeze` (old default) |    4 |      36 / 58 |  52 / 87 |   168 / 282 | 168, 168, 175, 159    | 653/730 |            5 / 5 |    108 / 108 |
| `attach`                                   |    2 |      51 / 85 | 76 / 106 |   132 / 195 | 127, 157              | 636/688 |            5 / 5 |      54 / 54 |
| `keep-layout`                              |    2 |      37 / 56 |  54 / 78 |   167 / 280 | 169, 161              | 654/708 |            5 / 6 |       0 / 54 |
| **`thaw` (new default)**                   |    4 |      32 / 42 |  58 / 80 |   130 / 196 | 132, 132, 125, 122    | 638/687 |            5 / 6 |    108 / 108 |
| `keep-layout,thaw`                         |    4 |      32 / 45 |  56 / 85 |   133 / 206 | 122, 130, 179, 127    | 637/726 |            5 / 6 |      0 / 108 |

"UI frames missed" is the app log's count for each switch ("Tab to … missed N frames (…; UI)");
every switch of every choice missed some. `tab.layout` is the switches whose tab got a new layout.

**First visit after a launch** (`tab-first/idle/first`) and **ten taps back to back**
(`rapid-tabs/idle/burst`, from the last tap to the tabs settling on it):

| Choice                       | `tab-first` `tab.commit` | `tab-first` first frame | `tab-first` settle | `rapid-tabs` response | `rapid-tabs` settle |
| ---------------------------- | -----------------------: | ----------------------: | -----------------: | --------------------: | ------------------: |
| `detach,display-none,freeze` |                102 / 164 |               242 / 322 |          728 / 984 |             201 / 310 |           837 / 927 |
| `attach`                     |                106 / 135 |               184 / 271 |        1489 / 1990 |             237 / 300 |           857 / 927 |
| `keep-layout`                |                106 / 142 |               251 / 288 |         725 / 1312 |             195 / 237 |           833 / 882 |
| **`thaw`**                   |                 95 / 112 |               239 / 265 |          700 / 821 |             193 / 320 |           829 / 972 |
| `keep-layout,thaw`           |                105 / 127 |               227 / 270 |          704 / 818 |             227 / 287 |           840 / 926 |

**Memory** at the end of `tab-switch` (`dumpsys meminfo`, each run), and **JS blocks** over 50 ms in
each session's app log (two runs and the launch and seed before them):

| Choice                       | PSS MB, each run   | Native heap MB (median) | JS blocks | `by rendering ArrangeablePlaylists` | `by rendering index` |
| ---------------------------- | ------------------ | ----------------------: | --------- | ----------------------------------- | -------------------- |
| `detach,display-none,freeze` | 644, 434, 499, 447 |                     179 | 335, 254  | 46, 25                              | 28, 26               |
| `attach`                     | 501, 528           |                     239 | 284       | 23                                  | 78                   |
| `keep-layout`                | 492, 482           |                     191 | 267       | 27                                  | 22                   |
| **`thaw`**                   | 459, 441, 427, 443 |                     168 | 202, 231  | 9, 7                                | 7, 6                 |
| `keep-layout,thaw`           | 481, 439, 590, 409 |                     179 | 207, 242  | 5, 6                                | 7, 7                 |

Run-to-run noise: the old default's four run medians spread over 16 ms (159 to 175), `thaw`'s over
10 (122 to 132); `keep-layout,thaw` had one run at 179 ms, the outlier of the 16 runs. `thaw`'s slowest run is 27 ms faster than the old default's fastest.

## What the numbers say

- **Showing a frozen tab again is what cost the switch.** Every choice that leaves the hidden tab
  unfrozen (`thaw`, `keep-layout,thaw`, `attach`, which can't freeze) drew its first frame about
  35 ms sooner, and `thaw` and `keep-layout,thaw` did so with `tab.commit` no later than the
  default's. React hides a frozen tree as a suspended boundary: its views are hidden while frozen
  and shown again, and its layout effects run again, in the commit that brings it back (#1358,
  #1490). That work lands on the switch.
- **Fewer long renders of the tabs.** In the app log, a session of two runs of the default or
  `keep-layout` logged 22 to 46 JS blocks over 50 ms rendering the Playlists tab (`by rendering
ArrangeablePlaylists`) and as many rendering Home (`by rendering index`); `thaw` and
  `keep-layout,thaw` logged 5 to 9 of each (table below). `attach` isn't frozen either, yet logged
  23 and 78: an attached hidden tab takes part in each commit, which this run doesn't explain
  further.
- **Laying the tab out again isn't the cost.** `keep-layout` did what it promises (no `tab.layout`
  on any of its 54 warm switches, against 54 of 54 for the default) and its first frame didn't
  move (167 ms). `keep-layout,thaw` is within noise of `thaw`, so the simpler `thaw` wins.
- **Re-attaching the views isn't the cost either** on the emulator: `attach` (no detach, and so no
  freeze) is no faster than `thaw`, and its `tab.commit` and response are later (51 and 76 ms
  against `thaw`'s 32 and 58 ms), since an attached hidden tab still takes part in each commit.
- **Memory.** PSS after `tab-switch` didn't grow without the freeze. The emulator's PSS swings by
  up to 200 MB between runs of the same build (the default's 644 MB run against 434 to 499 MB),
  and every build stayed in the same range. The phone's PSS against the 500 MB budget is still for
  the phone run (#1358's doc).
- **What an unfrozen hidden tab renders.** Its stores still pause while hidden and catch up when it
  shows (#722), and `TabContent` keeps the navigator's renders out of it (#1534). Over 54 warm
  switches, `thaw` rendered `LargeTitleScreen` 18 times more than the default, one more render on
  each switch to Playlists (from Library); Home's and Library's screens rendered as often.
- **The UI thread still misses frames.** Every choice missed about 5 UI frames per warm switch on
  the emulator (the app log's "Tab to … missed N frames (…; UI)" lines, longest gap 83 ms
  median), on every switch. The emulator's GPU is software (each frame's `Issue` step takes
  about 50 ms in gfxinfo), so it misses frames during any motion; the 280 ms slide starts in the
  same commit that shows the tab. #1536 moves the slide's start past the tab's first frame.

## Nested routes and scroll positions

With the new default's build (`thaw`), on the seeded Library: the Playlists tab, then Archive
(a route pushed inside the tab, under the tab bar), scrolled down two screens; then Home, Library
and Playlists again, three times, and once more with a screenshot on Home. Each time Playlists
came back on Archive at the same rows (`Waiting Home` first, the header collapsed), and Home
showed Home. Screenshots in the run's notes (`1535-results/nested/`, not in the repo).

## What changed

- Core (`packages/core/src/tabScreens.ts`): `DEFAULT_TAB_SCREENS.freeze` is false; a new
  `freezeStacks` (default true, `thaw-stacks` / `freeze-stacks` in `EXPO_PUBLIC_WAVE_TABS`)
  decides whether a screen under a push freezes, apart from the tabs. `describeTabScreens` names
  `thaw-stacks` when a bundle sets it. Tests: `tabScreens.test.ts`.
- App (`apps/mobile/src/chrome/tabScreens.tsx`): `useStackScreenOptions` freezes with
  `TAB_SCREENS.freezeStacks`. Tabs still pass `freezeOnBlur={TAB_SCREENS.freeze}`, so a
  comparison bundle built with `EXPO_PUBLIC_WAVE_TABS=freeze` still freezes them.
- Guards: `perf/memoryGuards.test.ts` keeps hidden tabs detached and pausing and unfrozen by
  default, and every stack frozen through `freezeStacks`. `chrome/tabRenders.test.ts`: a hidden
  tab whose params or options change renders once as they change, not again when it shows.
- `docs/spec.md` › Performance rules, 2.
- Tooling found broken on the way, fixed here: `scripts/perf/adb.ts` died on Node 26 at its first
  adb call (an unhandled EPIPE when adb exits before reading its input), and
  `scripts/perf/seed.ts` left a reinstalled Wave unable to open its seeded database (the previous
  install's SELinux categories; now labelled as the app's data directory, `seedOwnership`).

## How the numbers were taken

One perf APK per choice, only the JS bundle different (`EXPO_PUBLIC_WAVE_TABS=<choice>`,
`EXPO_PUBLIC_WAVE_PERF=1`, `assembleRelease -PreactNativeArchitectures=x86_64`; each run's
`tabs.screens` names the build's choice). Each session, under the PC's emulator lock: install,
seed the reference Library (`node scripts/perf/seed.ts`: 3,000 songs, 60 playlists), turn the
emulator's network off, then:

```sh
node scripts/perf/perf.ts run --serial emulator-5554 --scenario tab-first,tab-switch,rapid-tabs \
  --compile speed --label 1535-<choice>-r<n> --commit 2f2a0300d
```

two runs a session, then the app log's `WaveTiming` lines. Each step's UI frames come from the
"Tab to … missed" line after its touch (the step's `touchAt` is the emulator's uptime, matched to
the log's wall clock). `tab-switch` is ten warm switches across Home, Library and Playlists, three
iterations after a warm-up; `tab-first` the first visit to Library and Playlists after a cold
launch, five iterations; `rapid-tabs` ten taps back to back, five iterations. Medians and p90s are
over every step of every run of a choice. The default and the winner ran in two sessions each,
apart in time, as a check on drift.

## What the phone log should show

On the first `ti` release with this change, the owner's exported log (WaveTiming):

- `Speed since … (Wave <version> @ <commit>): … tab <n> first frame median … p90 …`: the tab
  kind's first frame median should drop by about 35 ms against the 0.93.2-ti log's 245 / 334 ms
  (the emulator's ratio would put it near 190 / 260 ms).
- `Slow tab to /library from /: response …, first frame …, settled …`: fewer lines, and smaller
  first frames, on switches to a tab already visited.
- `Tab to /library missed N frames (longest gap … ms; UI)`: not expected to change with this
  ticket; #1536 targets them.
- `JS blocked … on /playlists by rendering ArrangeablePlaylists` and `… on / by rendering index`:
  fewer of them, as on the emulator (from 22 to 46 a session to 5 to 9).
- PSS: `dumpsys meminfo` after a session of tab switching, and no "killed for low memory" line.
