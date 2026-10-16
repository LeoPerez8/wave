# #302 Release performance baseline: the runner, the instrumentation, the baseline

Ticket: #302 (parent #301). Branch `feat/302-perf-baseline`, based on `perf/301-performance` at
66f0290.

This ticket builds the tooling every later #301 ticket measures with
([README](README.md)), and is meant to record the release baseline they compare against. **The
device baseline is pending:** no phone was attached while the ticket was built.

## What was built

- **Runner** (`scripts/perf/`): `perf.ts` (`scenarios`, `doctor`, `run`, `summary`, `compare`)
  drives the phone over adb, unattended. The scenarios are: cold start; ten tab changes; rapid tab
  taps; push and pop of Settings, Library › Albums and Library › Songs (a Track list); an
  empty-screen control (Settings › Developer); Mini player to Now Playing; Now Playing to Queue;
  the first Search tap after a launch; and a large playlist import. They run in an `idle` and an
  `import` variant. Each measured step gets gfxinfo frame stats and, on a perf build, latencies
  from the touch's native timestamp. Each scenario ends with retained memory, and each run starts
  with the metadata the ticket asks for. `--perfetto` adds a trace per scenario
  (`perfetto.pbtx`).
- **Instrumentation** (`apps/mobile/src/perf/`), opt-in at bundle time (`EXPO_PUBLIC_WAVE_PERF=1`).
  It adds touches, route, keyboard, Now Playing, Queue and import marks, render counts in 13
  components, long tasks, and the Library's size (`LibraryStore.measureScale`, Core-free SQL in
  `db/counts.ts`). In a normal build each call site calls an empty function.
- **Core** (`packages/core/src/perfLog.ts`): the in-app recorder, when it flushes, and the log
  format the runner parses.
- **Results format and before/after template**: [README](README.md).
- **CI**: the runner's tests and typecheck run with the root scripts. A change under
  `scripts/perf/` checks every package (`scripts/ci/changes.ts`, area `perf`).

## Decisions

- **The app flushes its log on its own, after 4 s without a touch.** The first design had the
  runner open `wave://perf/flush` after each window. Any link or share pauses and resumes the
  activity, React Native reports that as the app leaving and coming back, and Wave reacts to
  coming back: `WaveSync` syncs on every return while signed in, and `startInitialScan` rescans after a while. That
  work would have landed in the next measured window, so the runner sends the app nothing.
- **Pops are taps on the header's Back button, not the system back key.** A key event has no
  touch, so it gives no timestamp to measure from. Every pushed screen has `Back` (ScreenHeader),
  and Now Playing has `Close Now Playing`.
- **Latencies count from the touch's native timestamp**, not from when the runner sent the tap.
  `performance.now()` (React Native's `HighResTimeStamp`, `steady_clock`) and
  `MotionEvent.getEventTime()` are both CLOCK_MONOTONIC on Android, as are gfxinfo's frame
  timestamps. This was read from React Native 0.88's source, not yet seen on the phone.
- **The empty-screen control is Settings › Developer**, a screen in the shipped app with one row,
  so the plain release APK runs it too. A new empty route would have existed only to be measured.
- **The import variant re-launches the app per scenario**, as every scenario does. The import
  resumes after each launch (`resumePlaylistImports`), and each step records its progress.

## Baseline

**Pending: no phone was attached** (`adb devices` listed none on 2026-10-16). No device numbers
are recorded here, and none were invented.

To take it, on the S24+ (`RQCX208NW4R`), with the fixture in place ([README](README.md#fixture);
`importLink` must be set first):

```sh
# 1. The release as the owner has it: the ti prerelease APK, not a perf build.
node scripts/perf/perf.ts doctor
node scripts/perf/perf.ts run --apk wave-ti.apk --commit <ti commit> --label baseline-release \
  --variant idle,import --meta library.tracks=<n> --meta library.playEvents=<n>

# 2. A perf build of perf/301-performance at this ticket's merge, for latencies and render counts.
node scripts/perf/perf.ts run --apk wave-perf.apk --label baseline-perf --variant idle,import

# 3. One traced pass of the scenarios that look slow, for attribution.
node scripts/perf/perf.ts run --apk wave-perf.apk --label baseline-trace --perfetto \
  --scenario tab-switch,push-settings,now-playing,search-first-tap
```

Record here: the header and summary of runs 1 and 2, the cold-launch and memory tables, which
stalls the traces attribute to JavaScript, the main thread or rendering, and copies of the results
files in `docs/performance/results/`.

## Validation without a phone

- `node --test scripts/perf/*.test.ts`: the parsers on Android 14 output shapes (gfxinfo with
  framestats, meminfo, `am start -W`, `dumpsys package`/dexopt, display, getprop, thermal,
  uiautomator XML), the metrics, summaries, comparisons and comparability warnings. It also runs
  the whole runner on the simulated phone: every scenario, both variants, a plain APK, a missing
  import link and Perfetto capture.
- `node --test packages/core/src/perfLog.test.ts`: the recorder, its flush timing and the log
  format.
- `node --test apps/mobile/src/library/db/counts.test.ts`: the Library size query.
- `node scripts/perf/perf.ts run --dry-run --variant idle,import --import-link <any>`: the full
  pipeline, with simulated numbers.

## Not measured, and open questions

- **The device baseline** (above).
- Not yet confirmed on One UI: that the root view's `onTouchStart` sees every touch while
  gesture-handler gestures run; that gfxinfo's columns and the `dumpsys` shapes match the parsers;
  that `uiautomator dump` finds each target. The README lists what to check on the first run.
- No perf build was compiled: the instrumentation is JavaScript only, and typechecks. The first
  perf build should confirm that `console.log` reaches logcat in release (React Native routes it
  there) and that Expo inlined `EXPO_PUBLIC_WAVE_PERF`. The run's first line shows both.
- `importLink` in `scripts/perf/fixture.json` is empty: the owner should pick the large playlist.
