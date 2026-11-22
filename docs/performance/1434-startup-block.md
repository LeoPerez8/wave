# #1434 Name and split the startup block: which startup work holds the JS thread

Ticket: #1434 (parent #1432). Branch `feat/1434-startup-block`, based on #1423's merge
(`c062a78e4`).

## What was measured

Cold launches on the emulator (AVD `wave-marquee`, read-only, 3,000-song seed), reading the
`WaveTiming` lines from Wave's log: `JS blocked … by …` and `Slow screen /: first frame …,
content …`. Before is #1423's release APK. After is the same APK with this branch's JS bundle
repacked into it (`expo export:embed`, `hermesc -O`, debug key), installed over it with the data
kept. Each launch waited for the emulator's load average to fall below 2.5.

One diagnostic launch first used a perf build that traced the module loads, the first mount,
each `startServices` call and each startup registration's synchronous start against the
runtime's long tasks. That trace isn't in the branch.

## What held the thread

- The 4.6 to 6.2 s "startup" blocks in `1423-xiaomi-freezes.md` are the first mount's commit:
  the root layout's render, Home's module load and render, the layout effects and the passive
  effects, in one task. Since #1423 they're named after the section rendering
  (`rendering HomeSection(discover)` and the like). That work is #1440's.
- `startServices` takes about 13 ms in all, across its ten calls.
- The startup registrations, run one per free turn after the first settle, take 0 to 9 ms each
  in their synchronous start, except `optimize` (`PRAGMA optimize=0x10002` on the JS thread):
  157 ms in the diagnostic launch. In the four measured launches it didn't block, so its cost
  depends on how stale the statistics are.
- In work the registrations leave running: `downloads` 181 ms and `backgroundFill` 61 ms in one
  after launch, `followCheck` 140 and 64 ms in the diagnostic launch (named by the 1 s turn
  window, so another work's block in that window can land on it).
- A 282 ms block before first content, after the first commit's renders, logged as plain
  `startup`. It didn't recur in the measured launches.

## What changed

- Core's block log keeps the startup steps the app marks (`startupStep`). An unnamed block
  before the first settle says `startup (<step>)` with the latest step begun before it ended:
  `after the first mount` (the root layout's last effect) or `first content shown`.
- A startup registration's start runs as a slice named `startup <name>`, and its turn carries
  that name, so the line says `by startup downloads` rather than `by downloads`.
- The first planner statistics pass waits until Wave goes to the background, or runs at once
  with no screen shown (a headless start). Every later trip to the background runs the plain
  `optimize`, as before. Where the pass ran is in `725-database-settings.md`.

## Before (`c062a78e4`)

| Launch | Home first frame | Home first content | Blocks before first content                                     |
| ------ | ---------------- | ------------------ | --------------------------------------------------------------- |
| 0      | 1.6 s            | 4.4 s              | rendering HomeScreen 4.2 s                                      |
| 1      | 2.4 s            | 9.0 s              | rendering HomeSection(discover) 5.8 s, startup 130 ms and 54 ms |
| 2      | 1.2 s            | 6.4 s              | rendering HomeSection(upcoming-shows) 1.8 s                     |

Launch 0 ran on an earlier boot (`base1`). The diagnostic perf build: 1.9 s and 5.5 s.

## After (this branch)

| Launch | Home first frame | Home first content | Blocks before first content                 |
| ------ | ---------------- | ------------------ | ------------------------------------------- |
| 1      | 1.7 s            | 4.6 s              | rendering HomeSection(upcoming-shows) 3.0 s |
| 2      | 390 ms           | 2.4 s              | rendering HomeScreen 906 ms                 |

The host ran other sessions' builds throughout, and two launches of the same APK differ by 2 to
4x. These numbers don't show the branch making Home faster or slower. Its changes run after Home's
first frame or rename lines, so none was expected.

## Blocks still over 50 ms after Home's first frame

Named and ticketed (or proposed):

- `rendering HomeSection(favorites)`, `HomeSection(stats)`, `HomeContent`, `NowPlayingSheet`,
  `PlayerView`: 77 to 604 ms. These are first mounts and renders: #1439, #1440, #1441.
- `Home mix inputs`, `Home Magic Queue seeds`, `Genre mixes build`, `Artist mixes build`,
  `taste profile`, `DJ opening`, `DJ grid candidates`, `DJ mood lookup`: 50 to 373 ms (#1437).
- `Library read replay`: 72 to 136 ms (#1435). `scan`: 188 ms (#1436).
- `startup downloads` 181 ms and `startup backgroundFill` 61 ms: proposed ticket "Resume
  downloads and the background fill in slices".
- `unnamed background work`: 50 to 401 ms, many per launch. Stepped work started without a
  `BackgroundWorkName` gets the default name. Proposed ticket "Name every stepped background
  work".
- `no background work`: 52 to 173 ms, with nothing named running after the first settle.
  Proposed ticket "Find the unnamed blocks after Home's first content".

## Behavior kept

Core's tests (`node --test` in `packages/core`) cover the new step naming. The registration
order, quiet-frame gate and free turns are unchanged; only their names changed. `optimize`
still runs both of its passes.

## Not measured, and negative results

- The reference phone: no phone was attached.
- Whether the first statistics pass now gets skipped in sessions that never leave the screen,
  such as Wave closed by a crash. The next session's first trip to the background runs it.
- The new `startup (<step>)` names didn't appear in the after launches, because no unnamed block
  came before the first settle.
