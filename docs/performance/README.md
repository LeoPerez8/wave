# Release performance runner

Every ticket under #301 measures its change the same way: the runner in `scripts/perf/` plays
fixed scenarios on the Galaxy S24+ through adb, unattended, and writes what it measured to a
results file. A ticket records its before and after in `docs/performance/<issue>-<slug>.md`
(template at the end).

The runner measures a release APK. It works with any APK, and gives more with a **perf build**,
a release build with the opt-in instrumentation turned on:

|                                                          | Plain release APK | Perf build |
| -------------------------------------------------------- | :---------------: | :--------: |
| Frame times, deadline misses, jank counters (gfxinfo)    |        yes        |    yes     |
| Cold launch time (`am start -W`), retained memory        |        yes        |    yes     |
| Perfetto traces (`--perfetto`)                           |        yes        |    yes     |
| Latency from the touch: first frame, response, settle    |         -         |    yes     |
| Keyboard latency, Now Playing and Queue shown            |         -         |    yes     |
| Render counts, long tasks, Library size, import progress |         -         |    yes     |

## Commands

From the repo root, with Node 22.18 or newer (no install needed: the runner has no dependencies):

```sh
node scripts/perf/perf.ts scenarios                 # what each scenario does
node scripts/perf/perf.ts doctor                    # phone settings the runs depend on
node scripts/perf/perf.ts run --label baseline      # every scenario, idle variant
node scripts/perf/perf.ts run --label baseline --variant idle,import
node scripts/perf/perf.ts run --scenario now-playing,queue --label 304-after
node scripts/perf/perf.ts summary perf-results/<file>.jsonl
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
node scripts/perf/perf.ts run --dry-run             # the whole pipeline on a simulated phone
```

`pnpm perf <command>` does the same. `run` options:

- `--scenario all|<a>,<b>`: `all` is every scenario except `import` (see Variants).
- `--variant idle|import|idle,import`.
- `--iterations <n>`: overrides each scenario's count. Use it for quick checks, not for results.
- `--label <name>`: names the run and its file, `perf-results/<label>-<time>.jsonl`. `--out` sets
  the file.
- `--apk <file>`: installs the APK first (`adb install -r`) and records its SHA-256.
- `--commit <sha>`: the APK's commit when it can't say itself. A perf build reports its own.
- `--compile <filter>`: sets the ART compiler filter first (`cmd package compile -m <filter> -f`),
  e.g. `speed-profile` or `verify`. #317 uses this.
- `--import-link <url>`: overrides the fixture's playlist link.
- `--artist <name>`: overrides the fixture's artist (`push-artist`).
- `--meta key=value`: records a value as given. On a plain APK, pass the Library's size this way
  (`--meta library.tracks=12000 --meta library.playEvents=54000`).
- `--perfetto`: records a Perfetto trace per scenario under `perf-results/traces/`.
- `--serial <serial>`: picks the phone when more than one is attached.
- `--dry-run`: uses the simulated phone in `scripts/perf/fakeDevice.ts`.

`perf-results/` is ignored by git. To keep a run, copy its `.jsonl` to `docs/performance/results/`
and link it from the ticket's doc. Never record a dry run's numbers: they are made up.

## Building a perf build

The instrumentation (`apps/mobile/src/perf/perf.ts`) is compiled in only when the JS bundle is
built with `EXPO_PUBLIC_WAVE_PERF=1`. Expo inlines the variable at bundle time. Without it, every
instrumentation export is an empty function chosen when the module loads, and the root layout
mounts no probe and attaches no touch handler. The cost of an instrumented call site in a normal
build is one call to that empty function.

Build it like any local release APK (see the Android build notes), with two variables set for
the bundle step:

```sh
cd apps/mobile/android
rm -rf app/build/generated/assets/react      # Gradle doesn't see env changes: force a re-bundle
EXPO_PUBLIC_WAVE_PERF=1 EXPO_PUBLIC_WAVE_COMMIT=$(git rev-parse --short HEAD) \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Delete Metro's cache too (`$TMPDIR/metro-cache`) when switching between perf and plain builds. The
run's first line says whether the app on the phone is a perf build. A perf build has the same
version, package and signature as the release it's built from, so it installs over it in place.

## Fixture

`scripts/perf/fixture.json` holds what the scenarios assume:

- `package`: `dev.leoperez.wave`.
- `tabs`: the tab bar's tabs to cycle through, by label, Home first. The bar must hold them, plus
  Search.
- `importLink`: a public playlist link for the large import, shared to Wave as a share sheet would.
  **Not set yet.** Pick a YouTube Music or Spotify playlist of at least 2,000 songs and commit its
  link here. The import variant can't run without it.
- `artist`: the artist `push-artist` opens, by name as Library › Artists shows it. **Not set
  yet.** Pick an artist with a long play history that shows on the list's first screen without
  scrolling, and commit the name here. `push-artist` can't run without it. `--artist` overrides it.
- `settleMs`, `windowMs`, `launchSettleMs`, `memoryIdleMs`, `flushTimeoutMs`: timing (below).

The phone, for runs that compare:

- The owner's Library as it is. Every run records its size: songs, playlists, playlist entries,
  the largest playlist and play-history rows. `compare` warns when they moved by more than 1%.
- Something in the queue, so the mini player shows (Now Playing and Queue scenarios). Paused.
- Motion smoothness on Adaptive or High (the run records the active rate and the setting).
  Animation scales at 1x. Stay awake while charging (`adb shell svc power stayon usb`). Screen
  unlocked, Wave in front, no other app opened during the run. The runner checks that Wave is in
  front after each launch and each iteration, and stops a scenario if it isn't.
- Same compiler filter for before and after (recorded; `--compile` sets it).
- Thermal status 0 at the start (recorded at the start and end of the run).
- After an import run, delete the imported playlist, so the next run's Library is the same.

`doctor` checks the settings it can read.

## Scenarios

Each scenario starts from a fresh launch (`am force-stop`, then `am start -W`), waits
`launchSettleMs`, runs its setup, then repeats its steps. The first iterations are warm-up and
aren't recorded. Every measured navigation step is a tap, so it has a touch to measure from:
pops tap the header's Back button, and Now Playing closes with its Close button. Only the cold
launch, the share and the import's idle window have no touch.

| Scenario           | Steps (measure)                                                                     | Response mark             | Iterations |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------- | ---------: |
| `startup`          | cold launch (`cold`)                                                                | (am start -W)             |          5 |
| `tab-switch`       | ten tab taps cycling through `tabs` (`tab`)                                         | `route`                   |          3 |
| `rapid-tabs`       | ten tab taps back to back, measured from the last (`burst`)                         | `route`                   |          5 |
| `push-settings`    | Home › Settings (`push`), Back (`pop`)                                              | `route`                   |         10 |
| `push-library`     | Library › Albums (`push`), Back (`pop`)                                             | `route`                   |         10 |
| `push-tracklist`   | Library › Songs, the whole Library as a Track list (`push`), Back (`pop`)           | `route`                   |         10 |
| `push-artist`      | Library › Artists › the fixture's artist, to its stats block (`push`), Back (`pop`) | `artist.stats`, `route`   |         10 |
| `push-empty`       | Settings › Developer, one row: the empty-screen control (`push`, `pop`)             | `route`                   |         10 |
| `now-playing`      | mini player (`open`), Close Now Playing (`close`)                                   | `nowPlaying.shown/hidden` |         10 |
| `queue`            | Queue in Now Playing (`open`), Queue again (`close`)                                | `visible` queue           |         10 |
| `skip`             | the mini player's Next track (`next`)                                               | `queue.synced`            |         10 |
| `search-first-tap` | the first Search tap after a fresh launch (`first-tap`)                             | `keyboard.show`           |          5 |
| `import`           | share the link (`card`), tap Import (`start`), 10 s of the import (`during-import`) | `import.running`          |          1 |

`skip` measures how long a skip takes to reach the player, so it depends on the queue's length:
load the queue under test before the run (a short album, or the whole Library as Songs) and leave
it paused. Each iteration moves one entry on, so start far enough from the end.

`push-empty` is the control: navigation with next to nothing to render. If it's as slow as
`push-settings`, the cost is in navigation itself, not in what the screen shows.

### Variants

- `idle`: nothing else going on.
- `import`: runs `import` first, then the other scenarios while the import fills (Wave resumes it
  after each fresh launch). Each step records the import's progress, so a step taken after the
  import finished shows it.

Keys in summaries and comparisons are `<scenario>/<variant>/<measure>`, e.g.
`push-settings/import/push`.

## What a step measures

The runner finds each tap's target with `uiautomator dump` before the window opens and keeps its
position. Then, for each step:

1. waits `settleMs` so the screen is still, clears logcat and resets gfxinfo;
2. taps (`input tap`);
3. keeps the window open `windowMs` (2.5 s; 4 s for `rapid-tabs`, 10 s for `during-import`);
4. reads `dumpsys gfxinfo <package> framestats`;
5. on a perf build, waits for the app's flush (below) and reads it from logcat.

Times line up because `performance.now()`, a touch's native timestamp and gfxinfo's frame
timestamps all use Android's CLOCK_MONOTONIC.

| Metric         | Meaning                                                                                                                                          | Needs a perf build |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------: |
| `firstFrameMs` | Touch to the first frame that finished rendering after it: the **first visible response**. The frame reaches the screen about one refresh later. |        yes         |
| `responseMs`   | Touch to the step's response mark: **navigation latency** (`route`), **keyboard latency** (`keyboard.show`), Now Playing or Queue shown.         |        yes         |
| `settleMs`     | Touch to the last frame before 250 ms without frames: when the transition finished.                                                              |        yes         |
| `burstMs`      | First to last frame of that burst. The only latency a plain APK gives.                                                                           |         no         |
| `inputToJsMs`  | Touch to JavaScript's touch handler: input delayed by a busy JS thread.                                                                          |        yes         |
| `frames`       | Frames rendered in the window, deadline misses, jank counters (slow UI thread, high input latency), the frame-time histogram.                    |         no         |
| `renders`      | Renders per instrumented component in the step.                                                                                                  |        yes         |
| `longTasks`    | Long tasks React Native reported in the step, when it reports them.                                                                              |        yes         |
| `launch`       | `am start -W`: `TotalTime`, `WaitTime`, launch state. A perf build adds React Native's startup timings.                                          |         no         |
| memory         | `dumpsys meminfo` after each scenario plus `memoryIdleMs` idle: PSS, RSS, Java and native heap, graphics.                                        |         no         |

`summary` reports each latency as median / 90th percentile, the frames' pooled 50th, 90th and
99th percentiles and the share that missed their deadline. `Missing` counts steps whose response
mark never came, which means the step didn't do what it should (a wrong target, an error on
screen).

Limits:

- gfxinfo keeps the last 120 frames per window, about 1 s at 120 Hz. Its totals and histogram
  count every frame. When a step rendered more than 120 frames and the kept ones don't reach back
  to the touch, `firstFrameMs` and `settleMs` are left empty (`framesCovered: false`), not
  guessed.
- A frame is "late" when gfxinfo says it missed its deadline (Android 12+ records the deadline per
  frame).
- `route` is marked on the first frame callback after the new route commits. It shows JavaScript
  is done. The native transition may still be running: `settleMs` covers that.

### How the perf build writes its log

Marks, touches and render counts are kept in memory (Core's `createPerfRecorder`). The app writes
them to logcat in one flush (`WavePerf` lines, tag `ReactNativeJS`) once it has had **no touch for
`PERF_FLUSH_QUIET_MS` (4 s)**. Every window closes sooner after its last touch, so logging never
lands inside a measured window, except in long windows with no touch (`during-import`), where the
app may flush every 4 s.

The runner never sends the app a command. A link or share would pause and resume the activity, and
Wave reacts to coming back to the foreground (sync, the rescan on return): that work would land in
the next window.

## Results file

JSON Lines, one record per line, appended as the run goes, so an interrupted run keeps what it
measured. Records, in order:

- `run`, first: `schema` (1), `run` (id), `label`, `startedAt`, `dryRun`, `runner` (repo commit,
  Node, options), and the metadata:
  - `apk`: package, `versionName`, `versionCode`, `lastUpdateTime`, `commit`, `file` (path and
    SHA-256 with `--apk`);
  - `device`: serial, manufacturer, model, Android version, SDK, build fingerprint;
  - `display`: `refreshRateHz` (active mode), `peakRefreshRate`, `minRefreshRate`,
    `refreshRateMode` (Samsung's Motion smoothness);
  - `animationScales`; `compilation` (`status`, `reason`); `thermalStatus`;
  - `perfBuild`; `library`: `tracks`, `playlists`, `playlistItems`, `largestPlaylist`,
    `playEvents` (from a perf build, or `--meta library.<key>=<n>`); `importLink`; `app` (the perf
    build's first flush metadata); `manual` (`--meta`).
- `step`, one per measured step: `scenario`, `variant`, `measure`, `iteration`, `index`, the
  metrics above, `touchAt`, `expectMissing`, `framesCovered`, `finalRoute`, `flushComplete`, and
  `launch` and `appStartup` for a cold launch, `importProgress` while an import runs.
- `memory`, one per scenario: `scenario`, `variant` and the `dumpsys meminfo` fields in KB.
- `trace`, one per scenario with `--perfetto`: the local `.pftrace` path.
- `error`: a scenario that couldn't go on (target not found, Wave not in front, no import link) and
  why. The run goes on with the next scenario.
- `end`: `finishedAt`, `thermalStatus`.

`scripts/perf/results.ts` has the types.

## Instrumentation for later tickets

`apps/mobile/src/perf/perf.ts`:

```ts
import { perfMark, registerPerfMeta, usePerfVisible, useRenderCount } from "@/perf/perf";

useRenderCount("UpNextList"); // first line of a component: counts its renders
usePerfVisible("queue"); // marks `visible` "queue" on the first frame after mount
perfMark("import.running", String(total)); // a timing mark, name `area.event`, optional detail
registerPerfMeta("import", () => ({ done, total })); // reported with each flush
registerPerfMeta("library", readScale, true); // reported with the first flush only
```

Always call them unconditionally; they are no-ops in normal builds. Add a count or a mark where a
ticket needs evidence, and give a new response mark a scenario step's `expect` in
`scripts/perf/scenarios.ts`. Marks already in place:

- `route` (pathname), each time the route changes, on the next frame;
- `keyboard.show`, `keyboard.hide`;
- `nowPlaying.shown`, `nowPlaying.hidden`;
- `visible` "queue" (Up Next mounted);
- `import.running` (songs in the import), `import.idle`;
- `queue.synced` (the plan's step types and the queue's length, e.g. `seek 4210`), each time the
  player took a queue change;
- `artist.stats` ("played" or "not played"), on the frame after an artist page's stats block
  shows what it read (again after each re-read);
- touches with their native timestamp, from the root view's `onTouchStart`.

Render counts are in RootLayout, TabsLayout, LibraryLayout, TabBar, MiniPlayer, NowPlayingSheet,
PlayerView, UpNextList, HomeScreen, LibraryScreen, SearchScreen, SettingsScreen, LargeTitleScreen
(Home's and Library's), SongsList, TrackList and ArtistStatsBlock.

A new scenario goes in `SCENARIOS` (`scripts/perf/scenarios.ts`). Then make the simulated phone in
`fakeDevice.ts` answer it, so `--dry-run` and the tests cover it.

## Attributing a stall

`run --perfetto` records one trace per scenario: scheduling, CPU frequency, atrace for the app and
the framework (input, view, gfx, am, wm, binder), SurfaceFlinger's frame timeline, process memory
and Wave's logcat lines (`scripts/perf/perfetto.pbtx`). Open the trace at https://ui.perfetto.dev.
Tracing costs CPU: compare traced runs only with traced runs, and take the comparison numbers from
an untraced run.

In the Wave process:

- `main` thread, `Choreographer#doFrame` and `deliverInputEvent`: native main-thread work and
  input delivery.
- `mqt_v_js`: the JavaScript thread. Long slices while a frame is due are JavaScript work.
- `RenderThread`, `DrawFrame`: rendering cost.
- The frame timeline track: each frame's jank type (app deadline missed, buffer stuffing,
  SurfaceFlinger).

To find a step's touch in the trace, look up its `touchAt` (CLOCK_MONOTONIC ms) in the results.
Perfetto shows boot time by default, which runs ahead of the monotonic clock by the time the phone
spent in deep sleep. Line them up on the `deliverInputEvent` slice for that tap.

## Validating the runner without a phone

`node scripts/perf/perf.ts run --dry-run` runs every scenario against `scripts/perf/fakeDevice.ts`.
The simulated phone answers each adb command the way Android 14 prints it. It runs Core's recorder
on a virtual clock as the app does, and throws on any command it doesn't know. The tests
(`node --test scripts/perf/*.test.ts`) run the parsers on captured output shapes and the whole
runner on the simulated phone.

Things only a phone can confirm, to check on the first device run:

- `touchAt` is set on each step. If not, the root view's `onTouchStart` isn't seeing touches, and
  every step waits out its flush timeout.
- gfxinfo's `framestats` columns and the `dumpsys` shapes match the parsers on One UI.
- `uiautomator dump` finds each target. Labels: the tab labels, `Settings`, `Back`, `Albums`,
  `Songs`, `Artists`, the fixture's artist, `Developer`, `Now playing: …`, `Close Now Playing`,
  `Queue`, `Next track`, `Import`.

## A ticket's performance doc

`docs/performance/<issue>-<slug>.md`, e.g. `docs/performance/304-now-playing.md`:

```markdown
# #<issue> <Title>: <what was measured, in a few words>

Ticket: #<issue> (parent #301). Branch `feat/<issue>-<slug>`, based on `perf/301-performance` at
<commit>.

## What was measured

The scenarios and variants (`node scripts/perf/perf.ts run --scenario <…> --variant <…>
--label <issue>-before`), and why they cover the change. Any desktop or Core benchmark, with its
command; label its numbers **desktop**.

## Before (<commit>)

The run's header from `perf.ts summary` (APK, commit, phone, Android, refresh rate, compiler
filter, Library size), then the summary table for the scenarios that matter. Results file:
`docs/performance/results/<file>.jsonl`.

## After (<commit>)

The same, then `perf.ts compare <before> <after>`'s table and any warnings it printed. Say what
changed and by how much, and what didn't.

## Behavior kept

What was checked to stay the same (tests, the scenario's response marks, manual checks).

## Not measured, and negative results

Anything pending (no phone: **pending**, never invented numbers), experiments that didn't help, and
limits of the measurement.
```

Before and after must come from the same phone with the same fixture, refresh rate, compiler filter
and kind of build. `compare` prints a warning for each difference it sees.
