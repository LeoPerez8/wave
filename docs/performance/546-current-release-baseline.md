# Current release baseline and measurement gaps (#546)

Parent: #545. Original hardware comparison: [#318](318-release-verification.md).

## Evidence collected on 2026-10-21

The attached `wave_s24` is an **emulator**, Google `sdk_gphone64_x86_64`, Android
16/API 36, 1080×2340 at density 450 and font scale 1.0. Its name is not evidence
of Samsung hardware or a 120 Hz display. No physical Galaxy S24+ or SM-G985F is
available. [Raw preflight](results/546-emulator-preflight.json) records the actual
device, installed APK SHA-256, package flags and thermal status.

The installed APK reports Wave 0.15.0-ti (1500), is debuggable, and its source
commit is unknown. It predates this effort and is **not a release comparison
baseline**. `perf.ts doctor --serial emulator-5554` succeeded after adding the
installed Android SDK's `platform-tools` directory to PATH. Animation scales
were 1, stay-awake 15 and thermal status 0; refresh rate could not be read.
`importLink`, `artist` and `playlist` remain unset in the committed fixture.
Do not invent names or a large external playlist for the owner's Library.

No release performance run, hardware result, optimization gain, variability
measurement or bottleneck has been claimed. No generated dry-run numbers are
retained as measurements. #545 and #546 remain pending hardware evidence.

## Implemented measurement coverage

`push-playlist` opens Library → Playlists → the playlist named by `--playlist`
(or `fixture.json`'s `playlist`), then returns through the header's Back button.
It runs ten measured iterations after one warm-up, as part of `all`, in both
idle and import variants. The playlist must be visible without scrolling.
The push and pop use the existing `route` mark; this measures navigation
response and transition frames, **not a promise that every playlist row has
finished loading**. Existing playlist read/decoding/query counters remain in
perf-build step records. This also covers the new recommendation footer's
impact on playlist opening once the combined build is installed.

The run header retains the playlist name and comparison warns if it changes.
A missing/blank name records an error for this scenario without stopping the
others. Keep playlist content, layout and sort order equal as well. Public
runner tests verify push/pop, both workload variants, missing-fixture recovery
and the comparison warning.

## Hardware session

1. Keep #318's B0/B1 results and pending decisions: do not reset their evidence
   or imply that completed implementation established a hardware improvement.
2. Obtain the current **release** APK and its source commit, record its SHA-256
   through `--apk`, then build the combined commit with the same native
   architecture, signing key, instrumentation and compiler settings. A local
   debug emulator APK cannot stand in for either.
3. On the S24+, record OS/fingerprint, dimensions/density/font scale, actual
   refresh rate, animation scales, thermal status, compilation, instrumentation
   and Library sizes. Pick a real first-screen playlist and artist; use the
   same import link and restore its resulting changes between measured runs.
4. Run at least three comparable baseline repetitions before interpreting
   noise, then the same after repetitions. Retain every raw JSONL file under
   `docs/performance/results/`, including negative results and scenario errors.
5. Run startup, warm-start, tabs, pushed screens, Search, songs/playlist lists,
   Now Playing, Queue, skips and drags in `idle,import`; separately run
   `soak-routes,soak-player,rescan-return` and glass scenarios from #318.
6. Use `summary`/`compare` for median/p90 response, first-frame and settle
   latency, frame misses, JS long tasks and memory growth, retaining missing
   metrics as missing. Compare variability before selecting an optimization.

```sh
node scripts/perf/perf.ts doctor --serial <phone> --playlist "<visible playlist>"
node scripts/perf/perf.ts run --serial <phone> --apk <release.apk> \
  --commit <source-sha> --compile baseline --artist "<visible artist>" \
  --playlist "<visible playlist>" --import-link <fixture-link> \
  --variant idle,import --label 546-before-1
node scripts/perf/perf.ts run --serial <phone> --compile baseline \
  --scenario soak-routes,soak-player,rescan-return --label 546-before-soak
node scripts/perf/perf.ts summary <raw-run.jsonl>
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

## Decisions and acceptance status

| Requirement                                              | Status                                                    |
| -------------------------------------------------------- | --------------------------------------------------------- |
| Identify available environment and installed build       | Captured as emulator preflight, not release hardware      |
| Repeatable playlist opening                              | Implemented and tested through the runner interface       |
| Current release on S24+ and #318 hardware checks         | Pending physical device and comparable APKs               |
| Raw idle/import runs, variability and route/player soaks | Pending same hardware, Library and import fixture         |
| Prioritized bottleneck-specific optimization tickets     | Pending actual measurements; none invented                |
| Combined-device comparison                               | Pending implementation integration and hardware baselines |

No whole-app rewrite or speculative performance change is justified by these
preflight observations. Publish bottleneck tickets under #545 only after the
measurements identify a repeatable cause.
