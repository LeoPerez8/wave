# #1347 Native touch timing and the 50 ms first-frame budget

## What changed

- **Taps count from the native touch.** `app/_layout.tsx` already hands the touch's
  `nativeEvent.timestamp` to the timing session. On Android that timestamp shares the clock that
  JS's `performance.now()` reads, so no conversion is needed. From React Native 0.88.0-rc.4's
  source:
  - `TouchEvent.kt` stamps the event with `MotionEvent.getEventTime()`, and `TouchesHelper.kt`
    sends it to JS as `timestamp`. That is `SystemClock.uptimeMillis()`, `CLOCK_MONOTONIC` in ms.
  - `performance.now()` is `NativePerformance::now`, which returns `HighResTimeStamp::now()`:
    `std::chrono::steady_clock` since boot (`ReactCommon/react/timing/primitives.h`). On Android
    that's `CLOCK_MONOTONIC` too. The source's own comment says it's "the duration from system
    boot to now".

  The session no longer drops a touch whose timestamp is more than a minute old. It used to treat
  such a touch as "now", which hid exactly the wait this ticket is about. A touch now expires a
  minute after JS _heard_ it (a finger held that long, or an end that never came), so JS blocked
  for any length of time still counts its wait. A timestamp ahead of `now` (another clock, an
  older RN's epoch stamp) still falls back to the time JS heard it.

- **Budgets.** `TIMING_BUDGETS` gives 50 ms to first frame for tab, push, pop, screen, the Queue,
  Now Playing open and close, and two new kinds, `relatedOpen` and `relatedClose` (Related rising
  over the player and leaving it). Responses keep 100 ms (50 ms for Now Playing), content 400 ms,
  `readMs` 16 ms, and the Now Playing links 200 ms.
- **Related timing.** Core's `relatedTimingKind` decides when a Now Playing screen change is a
  Related open or close. Now Playing closing or YouTube Music turning off is not a tap, so it
  doesn't start a timing that would cancel the one being measured. When Related is asked for with
  Now Playing closed, the sheet rising counts as Now Playing open.
- **Summary.** "Speed since" gives each tap kind's first frame, then its response, each as median
  and p90, for example `push 12 first frame median 41 ms p90 70 ms, response median 30 ms p90
55 ms`. A milestone seen on only some taps says how many it measured (`response (3 measured)`).
- **Reference scenario.** `reference-taps` in `scripts/perf/scenarios.ts`, run by name. It covers
  every tab, Settings › Disliked songs and Version History, DJ, a Magic Queue tile on Home,
  Library › Albums (and an album), Songs, Artists › the fixture artist (and a YT Music artist from
  its Similar artists row, with About), Playlists › the fixture playlist, Now Playing open and
  close, the Queue tapped and swiped, Related open and close, and Search. The runner gained a
  `descSuffix` target (Magic Queue tiles' labels end in ", start Magic Queue") and the `--album`
  and `--yt-artist` options.

## Desktop checks

Run on the development PC (Windows), not the emulator or a phone. These cover the timing rules,
not frame latency.

| Check                                              | Result                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Core `timing.test.ts`, `nowPlayingScreens.test.ts` | pass                                                                                 |
| App `timingSession.test.ts`                        | pass, including a touch JS hears 70 s late behind a blocked thread (counted in full) |
| `scripts/perf/device.test.ts`                      | pass                                                                                 |
| Emulator or phone run                              | not run                                                                              |

## Phone run: pending

On the reference phone (Xiaomi 25118PC98G, Android 15), with the current `ti` release installed,
YouTube Music on, and Home showing the Magic Queue carousel and the DJ card:

```sh
node scripts/perf/perf.ts run --scenario reference-taps --label 1347-baseline \
  --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
  --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on that artist's Similar artists row>"
node scripts/perf/perf.ts summary perf-results/1347-baseline-<time>.jsonl
```

Record here the phone, the Wave version and commit, each step's first-frame median and p90, and
the app log's "Speed since" line after the run. The warmup iteration finds the targets. If one
isn't found (Version History below the fold after the fling, the DJ card or a Magic Queue tile
off screen), fix that step's target in `scenarios.ts` and run again. This run is the baseline
#1348–#1359 compare against.
