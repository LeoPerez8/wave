# Checking tickets on the PC's emulator

When no phone is connected, run a ticket's phone checks on the local emulator, and label every
result as an emulator result, naming the AVD and the build's commit. A criterion that names the
owner's S24+ or a car still needs that hardware, so its numbers stay unverified.

## Build and install

CI's APKs ship only `arm64-v8a` and crash in `MainApplication.onCreate` on the x86_64 AVDs. Build
your checkout instead, in the background, since a build takes 8 to 20 minutes:

```sh
scripts/emulator-apk.sh <adb-serial>
```

The package is `dev.leoperez.wave`. Only one Gradle build at a time: this machine stalls under
several, and a parallel `testDebugUnitTest` once hung for 50 minutes.

## Device

Use `wave-run-903` on host `local`, through the T3 device tools: `device_list`, `device_open`, then
the `agent-device` command it returns. Use `adb` only for installs, logs and pushing files.

## The emulator check (#1359)

Between phone runs, this catches a JS block over 50 ms or a tap kind gone past its budget. Run it
on demand, and before a `ti` release is promoted to `main`. No CI job runs it and it never blocks
a PR. Install the build to check (`scripts/emulator-apk.sh`, or `--apk`), then, through the
heavy queue since it holds the emulator for a while:

```sh
bash ~/.wave/heavy.sh node scripts/perf/perf.ts emulator-check --serial <adb-serial> \
  --artist "<artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>"
```

It plays `reference-taps` (five iterations, about 15 minutes; `--iterations 2` for a quick look),
sends Wave home so the timing session writes its "Speed since" summary, and reads the app log
(`files/logs/wave.log`) through the emulator's root, or `run-as` on a debug build. Only entries
from after it started count. `--album` and `--yt-artist` add those pages, as for `run`.

It prints the run's results file, the AVD and the build, then:

```text
First frame by tap kind:
  tab                12 taps   p90 45 ms     budget 50 ms (+25 ms noise)    ok
  Now Playing open   6 taps    p90 1200 ms   budget 50 ms (+25 ms noise)    OVER

JS blocks over 50 ms while a screen was shown: 1
  2026-11-21T10:01:00.000Z  72 ms on /library by build Home's mixes

FAIL
  JS blocked 72 ms on /library by build Home's mixes
  Now Playing open: first-frame p90 1200 ms, past its 50 ms budget by more than 25 ms
```

It exits 1 and lists why when any JS block over 50 ms happened while a screen was shown (the
screen is the route, the work is what `lib/backgroundWork.ts` says held the thread, or "no
background work"), when a tap kind's first-frame p90 passed its `TIMING_BUDGETS` budget by more
than the noise allowance, or when the log has no summary (nothing was timed). The allowance is
25 ms (`--noise-ms` changes it): the AVD's first frames move with the PC's load, and the phone
run stays the evidence for the 50 ms goal. A `Not measured:` line means a step's target wasn't on
screen, so the taps after it in that iteration weren't played; check the fixture names.

Leave an emulator another session is using alone: boot a second, read-only instance of the same
AVD on its own port (`emulator -avd <name> -read-only -no-window -no-audio -port 5560`, serial
`emulator-5560`), which shares its installed Wave and Library and writes nothing back.

## Limits

- `wave-run-903` needs about 7.4 GB free on `/` to create its data partition.
  `scripts/clean-worktrees.sh` frees space.
- The `alarm-api*` and `autosync-*` AVDs belong to other projects, so leave them alone.
- T3 starts emulators with `-no-audio`, so a real song match is unlikely. Mark that criterion
  unverified.
- Local builds have updates off, so a real update check needs an arm64 device and a CI APK.
