# #1359 An emulator check that fails on a JS block over 50 ms

## What changed

- **`perf.ts emulator-check`.** One command plays `reference-taps`, then judges the app log the
  device wrote meanwhile. It fails on any `JS blocked N ms on <screen> by <work>` line (#1350) over
  50 ms, naming the work and the screen, on a tap kind whose first-frame p90 in "Speed since"
  passes its `TIMING_BUDGETS` budget by more than the emulator's noise (25 ms, `--noise-ms`), and
  when the log has no summary. It prints each tap kind's p90 and every block, and exits 1 on a
  failure. The judging lives in `scripts/perf/emulatorCheck.ts`; its tests write their lines with
  Core's own `jsBlockLine` and `speedSummaryLine`, and its kind names are typed by `TimingKind`,
  so a new tap kind fails the typecheck until the check knows it.
- **Reading the summary.** The timing session writes "Speed since" when Wave leaves the screen,
  but on Android a paused Wave runs no JS timer, so the summary waits for its return. The check
  sends Wave home, then brings it back, then reads `files/logs/wave.log` through the emulator's
  root (`run-as` on a debug build). Only entries from after the check began count.
- **Runner fixes found by the first runs.** On an emulator whose data has several launcher-icon
  aliases enabled, `am start -p` resolved no activity, so every run stopped at its first launch:
  the runner now starts the launcher component by name (`cmd package resolve-activity`). A cold
  start that outlasts `am start -W`'s wait (`Status: timeout`) no longer skips the scenario: the
  runner waits for Wave to be in front and goes on without a launch time.
- **Where it runs.** On demand and before a promotion (`docs/agents/emulator-checks.md`,
  `docs/verification/1136-readiness.md` › Promotion). No CI job runs it and no PR waits on it.

## Desktop checks

| Check                                                                                               | Result |
| --------------------------------------------------------------------------------------------------- | ------ |
| `scripts/perf` `emulatorCheck.test.ts`, `runner.test.ts`, `profileDevice.test.ts`, `device.test.ts` | pass   |
| `tsc -p scripts/perf`                                                                               | pass   |

## Emulator run

Emulator, not a phone: AVD `wave-marquee` (Android 15, `sdk_gphone64_x86_64`), a read-only
second instance on port 5560, with the AVD's base data (2 songs, no playlists). The build was this
branch at `5bcf2a379` built locally for x86_64 (`assembleRelease`, versionName 0.80.1-ti, not a
perf build), with one local change to bundle at all: `packages/client/src/db/offThreadReads.ts`'s
`declare joinsNotNullableMap` field fails Metro's Babel ("The 'declare' modifier is only allowed
when the 'allowDeclareFields' option…"), so the build read the field through a cast instead. That
change wasn't committed: the field comes from #1348 and needs its own fix.

```sh
node scripts/perf/perf.ts emulator-check --serial emulator-5560 --artist Radiohead \
  --playlist Favorites --iterations 2
```

It ran for ten minutes. The scenario stopped at the playlist step (the base data has no playlist
named Favorites, so the Now Playing, Queue, Related and Search taps weren't played), and exited 1:

```text
First frame by tap kind:
  tab                4 taps    p90 4400 ms   budget 50 ms (+25 ms noise)    OVER
  push               9 taps    p90 2000 ms   budget 50 ms (+25 ms noise)    OVER
  pop                8 taps    p90 809 ms    budget 50 ms (+25 ms noise)    OVER

JS blocks over 50 ms while a screen was shown: 122
```

Of the 122 blocks, 96 ran with no background work in a slice or turn, 9 in a Magic Queue batch,
8 in unnamed background work, 4 in the Home mix catalog, 2 in the Artist mixes build, and one each
in scan, optimize and the Genre mixes build. The longest were 10.3 s on `/` with no background
work (during startup), 3.2 s on `/` by the Artist mixes build, and 1.9 s on `/library/artist/6`.
These are the emulator's numbers on a loaded PC, so they don't measure the reference phone, but
the startup blocks and the named slices over 50 ms are worth a look in #1350's follow-up.

## Named blocks and the Library's upkeep (#1346 follow-up)

Every free turn now carries a name (`whenFree` and `freeTurn` require one, so the typecheck catches
a new unnamed one), and the synchronous work that ran outside any slice is wrapped in `inSlice`:
the Playlist, Genre and Artist pages kept ahead, DJ's opening read, Search's index reads, the
Library query registry's settle, and the client's read replay passes ("Library read replay"). A
block over 50 ms during them is now put down to that name instead of "no background work".

The Library's startup upkeep (relinking credits, keying recordings, backfilling recording titles,
watching taste sources) ran while its layer was built, before the first screen. It now runs as
"Library upkeep" after the first screen settles (`runLibraryUpkeep`, from `app/_layout.tsx`).
Measured on the desktop (Node 24 with sql.js, not the phone), with
`pnpm --filter @wave/mobile bench:startup-upkeep`:

| Songs  | Relink, steady (ms) | Steady total (ms) | First-pass title backfill (ms) |
| ------ | ------------------- | ----------------- | ------------------------------ |
| 1,000  | 0.21                | 0.77              | 131                            |
| 12,000 | 2.38                | 2.84              | 1,416                          |
| 50,000 | 10.29               | 10.77             | 5,925                          |

At steady state keys take about 0.2 ms, titles 0.07 ms and taste 0.2 ms at every size. The
first-pass backfill runs once, after the update that adds titles; it is the cost that used to sit
before the first screen. Each of its 128-row batches is about 15 ms, over the 8 ms slice, as it
was before this change. Until the upkeep runs, an upgrade's first screen may show credits not yet
relinked for a moment.

## Phone run: pending

The check is meant for the emulator, and the phone run stays the evidence for the 50 ms goal. On
the reference phone (Xiaomi 25118PC98G), the same command works if the phone is rooted, or with a
debug build (`run-as`). Otherwise read the "Speed since" line from Settings › Developer › Save
Logs after a `reference-taps` run:

```sh
node scripts/perf/perf.ts emulator-check --serial <phone> --noise-ms 0 \
  --artist "<artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>"
```

Then check that the startup blocks carry names (none of the long ones under "no background work")
and that "Library upkeep" runs after the first screen settles.
