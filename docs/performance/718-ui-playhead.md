# #718 One UI-thread playhead: renders, label cadence and hidden work

Ticket: #718 (parent #712). Branch `feat/718-ui-playhead`, based on
`origin/feat/712-faster-lighter` at 874fb375.

## What was measured

Desktop checks cover Core's position extrapolation, lyric index, sleep label cadence and
worklet contract, plus the app's public `observePlayhead` lifecycle. The lifecycle tests
exercise seek, pause, song change, background, foreground, sheet close and teardown.
Babel's Expo preset also transforms every changed worklet file without leaving a worklet
directive untransformed. These checks establish behavior, not phone performance.

Validation: Core and mobile typechecks pass; 65 focused Core tests and all 44 Now Playing
app tests pass. Oxlint, formatting and `git diff --check` pass for the changed files.

Use the existing `scripts/perf` scenarios on comparable perf builds:

```sh
node scripts/perf/perf.ts run --scenario now-playing,now-playing-first,scrub,soak-player --variant idle --label 718-before
node scripts/perf/perf.ts run --scenario now-playing,now-playing-first,scrub,soak-player --variant idle --label 718-after
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

Repeat `now-playing,now-playing-first,scrub` with `--variant import`. For the stall check,
bundle with `EXPO_PUBLIC_WAVE_PERF_STALL_MS=1500`: the scrubber, its times and the end-of-track
menu countdown must continue moving while JS is blocked. Lyrics still need JS to render a
new current line, so their highlight can catch up after a stall.

The screen-off soak scenario belongs to #713 and is absent from this ticket's starting
commit. After integration, use its final scenario name and the budgets in
`docs/performance/712-budgets.md`. Run it with Now Playing left on synced lyrics, first with
a deadline timer and then End of track. Also leave the sheet closed with playback running.
Repeat each with a foreground return: times and the current line must catch up immediately.

Budgets for this change:

- Zero JS intervals for the playhead, lyrics and sleep label, in every state.
- Zero UI playhead frames and zero time-driven lyrics/sleep-label renders while the app is
  inactive or Now Playing is closed. Playback events and unrelated app work are counted
  separately.
- While visible and active, the `SyncedLyrics` render counter changes with the current line
  index. Mount, layout, selection, lyrics and translation changes are separate causes.
- `SleepTimerLabel` updates at most once per second for a deadline, including while paused;
  End of track has no time-driven React updates. The menu's end-of-track countdown updates
  through native text props, retaining its existing wording.
- The `Scrubber` render counter has no time-driven updates. Layout, queue identity and a scrub
  release can still render it.
- Keep the existing 50 ms Now Playing spring-start budget from `TIMING_BUDGETS`. At 120 Hz,
  a display interval is about 8.33 ms; compare missed frames and latency against #546 on the
  same phone. A numerical regression allowance and the whole-app screen-off wake-up budget
  must be set from the first S24+ baseline run, as #546 has no physical-device baseline.

## Before (874fb375)

**Pending owner's S24+ run.** No phone numbers were collected.

The starting code gives each `usePlayhead` caller a 200 ms JS interval, and a deadline label
also starts a 250 ms interval. The gate checks whether the sheet is shown, not AppState.
Lyrics rebuild their per-line translation objects at every playhead render.

## After

**Pending owner's S24+ run.** Record the combined build SHA, APK and raw JSONL here, then
paste `summary` and `compare` results. No improvement in frame time or battery use is claimed.

One UI frame callback extrapolates the latest timestamped report linearly, clamped to the
song's end. Position, duration and wall time are shared values. Reports, seeks, pauses and
song changes replace the report immediately. Unknown durations still extrapolate for lyrics;
the scrubber retains its disabled state until the duration is known.

Only a changed lyric index crosses to React. Translation props are memoized per lyrics and
translation result. Deadline labels cross once per changed whole second; a paused deadline
keeps the UI clock active. Hidden or inactive, the callback stops and playback/timer report
subscriptions detach. Returning reads the latest report before restarting frames. Pending
lyric follow timeouts are cancelled when the playhead becomes hidden.

## Behavior kept

Core tests retain position extrapolation and clamping, current-line boundaries and empty
lyrics, sleep timer enforcement decisions and duration formatting. App lifecycle tests cover
visibility, current reports on return, deadline countdowns while paused, and cleanup.
The seek still checks the grabbed queue entry, commits only on release, and gives the same
haptic. Accessibility increments read a fresh position at the time of the action.

On the S24+, check the time labels' font baseline and scale, TalkBack's current value and
10-second actions, unknown duration, forward/backward seek, pause/resume, song change while
scrubbing, lyrics auto-scroll/manual-scroll/share/translation, both sleep timer modes and the
menu countdown's wrapping. Also check these after backgrounding and returning.

## Not measured, and negative results

No phone, APK render, frame trace, battery measurement or manual visual/accessibility check
was run. Phone acceptance remains pending and does not block integration.

Native position reporting and the playback-state fanout are unchanged here; #719 owns them.
Whole-app screen-off JS wake-ups therefore cannot be attributed solely to this change, and
zero UI timers does not establish zero whole-app JS work.
