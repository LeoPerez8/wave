# #840 to #843 Long lists without freezing: playing, resuming and opening them, and Home's reads

Tickets: #840, #841, #842, #843. Branch `feat/840-long-lists-no-freeze`, based on `main` at
`7bb325b2`.

## What was measured

Nothing yet on a phone with this branch. The figures under Before are the field reports in the
issues, read from the app log; they weren't taken with the runner, so `perf.ts compare` can't use
them.

For the after run, use a release build with a 4,875-song playlist and about 25,000 playlist entries
in all, on the phone of the field reports if possible, since they came from there. Budgets come from
`712-budgets.md` and the issues' acceptance criteria.

```sh
node scripts/perf/perf.ts run --serial <phone> --apk <release.apk> --commit <source-sha> \
  --scenario startup,push-playlist,scroll-playlist,queue,skip,skip-library \
  --playlist "<the 4,875-song playlist>" --label 840-after
```

Confirm scenario names with `node scripts/perf/perf.ts scenarios`. The runner has no scenario for
playing a list twice, resuming or Android Auto: those are manual checks that read the app log.

## Budgets

| Ticket |                        What                        |                     Budget                     |
| :----: | :------------------------------------------------: | :--------------------------------------------: |
|  #840  | Playing a 4,875-song playlist twice in quick order |     No ANR, no main-thread freeze warning      |
|  #840  |   Items the player holds with a 4,875-song queue   |                  100 at most                   |
|  #841  |   Android Auto starting a long list, skip, modes   |                     No ANR                     |
|  #842  |           Opening a 4,875-song playlist            |       First frame 150 ms, content 400 ms       |
|  #842  |           Opening a 4,875-song playlist            |        No freeze warning in the app log        |
|  #842  |                The playlist's rows                 |    Read once per opening unless it changes     |
|  #843  |   Any read on Home, with 25,000 playlist entries   |          Holds JS for 100 ms at most           |
|  #843  |              Home's playlist seed ids              | Not read in full on each Home visit or refresh |

## Before (field reports, Xiaomi 25118PC98G, Android 15)

Not runner results: no results file, and the #840 stack frames were named by matching the release
APK's dex strings, because CI keeps no R8 mapping. #840 hasn't been reproduced on a device.

**#840, 4,875-song playlist, 0.42.0-ti (also seen on 0.40.0-ti).** Two plays three seconds apart
blocked the main thread for 5.9 s, 8.5 s, 4.4 s and 3.8 s, and Android closed Wave 44 s later. The
first ANR, on 0.40.0-ti, came about 26 s after a song ended with Wave in the background.

**#841.** No figures of its own: it keeps resume and Android Auto working with #840's window.

**#842, playlist 54 of 4,875 songs.**

|  Version  |                                     Figure                                     |
| :-------: | :----------------------------------------------------------------------------: |
| 0.42.0-ti |                  5.7 s to show content, with a 4.3 s JS block                  |
| 0.42.0-ti |            The read itself ("open the playlist") held JS for 532 ms            |
| 0.40.0-ti | JS stopped responding for 7.2 s; the read repeated several times, ~100 ms each |

**#843, 25,231 playlist entries, 0.42.0-ti.**

|          Read or moment           |                           Figure                            |
| :-------------------------------: | :---------------------------------------------------------: |
|  "read Home's playlist seed ids"  | 25,231 rows, 0.6 to 2.3 s of JS, several times in 2 minutes |
| "read the videos the owner knows" |               25,237 rows, 0.2 to 0.8 s of JS               |
|   Home's content after start-up   |                         5 to 6.9 s                          |

## After

**Not yet run**, on any phone, for any ticket. No after figure exists for any budget above.

## Behavior kept

Core and app tests cover it: `playerWindow.test.ts` (the window at the queue's ends, wrap-around,
jumps, restoring a queue longer than the window, the order a media session is handed),
`longPlaylistOpen.test.ts` (reads per opening, burst pace, Find and the Library lookup in steps),
`QueueSyncTest` (covers in one replacement), `PlaybackResumptionTest`, `sourceRead.test.ts`,
`playlistSeedIds.test.ts`, `knownVideosRead.test.ts` and `mixKnown.test.ts`.

## Not measured, and negative results

- All the phone runs above are **pending**, along with each ticket's on-device acceptance criteria.
- `longListBurstPace`'s 4 ms per row is a chosen figure, which no phone run has measured.
- The queue window's 69 songs ahead differs from the 70 in #840's text; the owner decides that one.
