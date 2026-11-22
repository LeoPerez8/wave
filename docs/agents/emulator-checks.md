# Checking tickets on the PC's emulator

When no phone is connected, run a ticket's phone checks on the local emulator, and label every
result as an emulator result, naming the AVD and the build's commit. A criterion that names the
owner's S24+ or a car still needs that hardware, so its numbers stay unverified.

## Build and install

Install this worktree's phone dependencies with `scripts/install-for.sh mobile`.

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

## Seed a reference-size Library (#1457)

Measurements need a Library the size of the reference phone's, and a cold-booted AVD has almost
none. With Wave installed (a build of your checkout, as above) and the emulator booted, run:

```sh
node scripts/perf/seed.ts --serial <adb-serial>
```

It took 75 to 112 seconds on the PC against a cold-booted read-only `wave-marquee`: about 5 s to
write the files, 25 to 50 s to push them, 35 s to build the database. It refuses anything but an
emulator, because it empties `Music` and clears Wave's data (`pm clear`). Then it:

1. writes tagged MP3s of about 1 KB each (an ID3 tag and a Xing header claiming a 2 to 6 minute
   song) under `Music/Wave Seed/<Artist>/<Album>/`, and pushes them with `adb root`;
2. builds `wave.db` through the client's migrations and store (`packages/client/src/db/referenceSeed.ts`),
   from the same tags and from each file's size and modified time as the device reports them, so
   the scan at launch finds every file unchanged;
3. pushes it to `files/SQLite/wave.db`, grants All files access, and launches Wave.

Default sizes, the reference phone's:

| What                                                                  | Default                       | Option        |
| --------------------------------------------------------------------- | ----------------------------- | ------------- |
| Library songs                                                         | 3,000                         | `--songs`     |
| Artists                                                               | 900                           | `--artists`   |
| Albums                                                                | 1,500                         | `--albums`    |
| Playlists                                                             | 60, the biggest 3,800 entries | `--playlists` |
| Playlist entries, about 45% Library songs and the rest YT Music songs | 26,700                        | `--entries`   |
| Known videos (`selectKnownVideos`)                                    | 20,500                        | `--videos`    |
| Plays over the last year, a fifth of them streamed                    | 12,000                        | `--plays`     |
| Favorites                                                             | 150                           | `--favorites` |
| Followed artists                                                      | 5                             | `--follows`   |

`--scale 0.1` shrinks every default for a quick seed. Every name is generated, the same every run:
the first artist on Artists is `Amber Ainsley` and the first playlist on Playlists is `Archive`
(the biggest), which `scripts/perf/fixture.json` names for `perf.ts`. `--stale` gives the database
other modified times than the files', so the scan at launch reads all 3,000 files again: after it,
Library still holds 3,000 songs, 900 artists and 1,500 albums. `--local <dir>` writes the files
and the database to `<dir>` and touches no device.

A read-only instance writes nothing back, so seed it again after each boot. The seed doesn't cover
artwork (no file has a cover) or lyrics.

## The emulator check (#1359)

Between phone runs, this catches a JS block over 50 ms or a tap kind gone past its budget. Run it
on demand, and before a `ti` release is promoted to `main`. No CI job runs it and it never blocks
a PR. Install the build to check (`scripts/emulator-apk.sh`, or `--apk`), then, through the
heavy queue since it holds the emulator for a while:

```sh
bash ~/.wave/heavy.sh node scripts/perf/perf.ts emulator-check --serial <adb-serial> \
  --artist "Amber Ainsley" --playlist "Archive"
```

On a seeded Library those are the fixture's names, the defaults. It plays `reference-taps` (five iterations; `--iterations 2` for a quick look, which took ten
minutes on the PC). Then it sends Wave home and brings it back, since the timing session writes
its "Speed since" summary on leaving and a paused Wave runs no JS timer. Last, it reads the app log
(`files/logs/wave.log`) through the emulator's root, or `run-as` on a debug build. Only entries
from after it started count. `--album` and `--yt-artist` add those pages, as for `run`. A slow
cold start (`Status: timeout` from `am start -W`) doesn't stop it. The first run's numbers are in
`docs/performance/1359-emulator-block-check.md`.

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
