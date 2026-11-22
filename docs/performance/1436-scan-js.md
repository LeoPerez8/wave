# #1436 Bound the scan's remaining work on the JS thread

Ticket: #1436 (parent #1432), with #1457's slow stale rescan. Branch `feat/1436-scan-js`, based on
the `feat/1432-reference-phone` integration branch.

## How it was measured

The `wave-marquee` AVD (x86_64, Android 15, read-only instance, `-no-audio`), seeded with
`node scripts/perf/seed.ts` (3,000 songs). Every APK is the kept x86_64 release APK with a fresh
bundle (`repack-js.sh`). Network off, so streamed lookups stay out of the log.

- **200 changed files:** seed, `touch` 200 MP3s, launch, then walk Settings, Library, Search and
  Home six times while the incremental scan runs, and read the block log ("JS blocked N ms on
  /route by work").
- **Full rescan:** `seed.ts --stale`, so the scan at launch reads all 3,000 files again, and count
  the tracks saved since launch every 30 s.
- **Desktop:** `apps/mobile/bench/scanEnd.ts` (Node with sql.js) for slice sizes and the scan's end.

## What held each block

Each block line names its work. The scan's blocks were these:

1. **Every saved batch announced a Library change** (#1457). Each change had the screens in
   sight read again, so a scan of 3,000 files spent most of each batch re-reading Home, Library
   or Search. The full rescan crawled at about 100 files a minute.
2. **The scan's end linked playlist entries in one hold** (729 ms on Search): every unsearched
   entry matched against the whole Library on the JS thread.
3. **The scan's end re-filed the whole Library's credits** (`filesGone` → `relinkCredits`, 250 to
   477 ms), the first time each session, even when nothing was filed differently.
4. **Each save fired the kept play totals' change triggers for nothing.** A save upserts every
   touched file and its album, and the upsert names the credit columns, so SQLite ran
   `kept_track_change` and `kept_album_change` even when no value changed. The first save after the
   totals settled marked every streamed song owed (258 ms in the albums upsert alone), and every
   save marked its songs' plays owed again, so the totals kept settling during the scan. In the
   full rescan this grew with each batch: 361 ms, 486 ms, 836 ms, 1.1 s, 1.4 s.
5. **The lyrics index rewrote every touched song's words** (55 to 147 ms per song), though
   touching a file changes no lyrics.

The save slice size was not the cost, as #1423 found. With the causes above fixed, a save of a
dozen files takes about 30 ms on the emulator. The tracks upsert takes about 20 ms of that, and
filing artists, genres, folders and albums 6 to 10 ms.

## What changed

- **Announcements** (`scanAnnounceDue`, Core): a scan tells the app about saved batches at most
  every 15 s (`SCAN_ANNOUNCE_MS`), and once at its end.
- **Paced saves** (`nextScanSaveSlice`, Core): the slice grows towards the 30 ms budget, doubling
  while a save takes under half of it, and never collapses to one file over a fixed cost. The first
  slice is 2 files (`FIRST_SCAN_SAVE_SLICE`): 25 took 314 ms on a cold connection.
- **Playlist links** (`readPlaylistLinks`, `playlistLinkSteps`, `writePlaylistLinks`): the
  scan's end reads the links off the JS thread and matches them in named steps. The write runs the
  whole link again if a playlist's entries changed in between.
- **Credits warm** (`readLibraryCredits`, `warmCreditSplitsSteps`, `filedAsSplit`): before the
  first save, the credit splitter is read off the JS thread and built in steps. The steps also
  check whether the Library is already filed as it splits. When it is, the scan's end re-files
  nothing (`filesGone` 14 ms on the seed, from 477 ms).
- **Quiet triggers** (migration `0071_quiet_kept_triggers`): `kept_track_change`,
  `kept_album_change` and `kept_artist_change` fire only when a credit column's value changes.
- **Lyrics index** (`keepLyricsWords`): a song whose indexed text is unchanged keeps its rows.
- **Scan summary line:** `Scan done (…): N found, N read, N saved in N batches, T; saves T
(longest …, slice now N), Library changes T (longest …), waiting T`.

Every stepped run is named (#1447): "playlist links", "credit splits", "save scanned tracks",
"lyrics search index: changed songs".

## Results

### 200 changed files (emulator)

| Build                         | Scan time | Saves (longest) | Scan blocks over 50 ms                                    |
| ----------------------------- | --------: | --------------- | --------------------------------------------------------- |
| Before (integration tip)      |       n/a | n/a             | 1.3 s, 818, 754, 256, 246, 61, 51 ms; lyrics 147 ms       |
| Announce, links, pace         |   133.3 s | 4.7 s (737 ms)  | links 728 ms, files gone 250 ms, saves 55–69 ms (6)       |
| + credits warm, first slice 2 |    48.4 s | 1.9 s (384 ms)  | saves 384, 167, 54 ms; scan 50 ms                         |
| + quiet triggers              |    19.0 s | 0.5 s (31 ms)   | lyrics 55 ms on Home; none on Settings, Library or Search |

The lyrics index change came after the last run and has no emulator number; its node test checks that an unchanged song writes nothing. The before build logged no scan summary (it came with this ticket). "Waiting" is the native
scanner reading files: 18.5 of the last run's 19.0 s.

### Full rescan of the 3,000-song seed (emulator)

Tracks saved since launch, sampled every 30 s, on Home the whole time (network off):

| Build                 | First saves  | Saved later    | Rate       | Whole scan                                                                     |
| --------------------- | ------------ | -------------- | ---------- | ------------------------------------------------------------------------------ |
| Before                | 100 at 120 s | 500 at 330 s   | ~114 a min | not run to the end (about 27 min at that rate)                                 |
| Announce, links, pace | 100 at 120 s | 500 at 330 s   | ~114 a min | not run to the end                                                             |
| All of this ticket    | 193 at 180 s | 1,528 at 870 s | ~116 a min | 1,494 s: saves 23.9 s (longest 234 ms), Library changes 0.3 s, waiting 1,470 s |

A full rescan takes no longer than before, and its save blocks no longer grow batch by batch
(before: 0.4 to 2.4 s; now 50 to 96 ms, and one 234 ms first save). It isn't faster either:
#1457's slow rescan isn't the saves. The scan spends 98% of its time waiting, and it stalls when
Home's mix builds run. The saved count stood still from 480 to 540 s and from 870 to 900 s. In
those same minutes the block log shows "Home mix inputs" about once a second (220 blocks, 16.7 s
in all, longest 379 ms). The offline Deezer genre lookups failed 1,817 times over the run. The
200-file scan, walking Settings, Library and Search, read about 11 files a second. The full rescan
on Home read about 2. See "Left over".

### Slice size against total time (desktop bench)

Node with sql.js, 3,000-song Library, 200 changed files, medians of 7 runs:

| Slice |  Total | Longest slice |
| ----: | -----: | ------------: |
|   100 |  66 ms |         35 ms |
|    50 |  82 ms |         27 ms |
|    25 | 123 ms |         25 ms |
|    10 | 140 ms |         16 ms |

Smaller slices cost total time: each save carries a fixed cost (a transaction, the albums and
artists it files). On the emulator, though, the saves are 0.5 s of a 19 s scan, and the rest is the
native scanner. So the slice size barely changes how long a scan takes. What it sets is the longest
hold, which is why the pace aims at the budget instead of a fixed size. The first save of a
session takes 33 ms, and the scan's end 72 ms the first time against 19 ms once the Library is
filed.

## Left over

- The kept play totals read at startup (234 ms on Library, before the scan): #1451's fallback.
- Startup and Home blocks outside the scan: Home sections rendering (170 to 230 ms), "startup
  whatsNew" (129 ms), "Artist graph" (82 to 110 ms), "no background work" (95 to 144 ms).
- A lyrics refresh that does change words still writes the song's words in one hold (55 to
  147 ms on the emulator).
- **#1457 stays open:** a full rescan reads about 2 files a second with Home showing. The scan
  waits behind Home's mix builds, which run about once a second while it saves ("Home mix
  inputs"), and behind offline genre lookups that fail over and over. Proposed: hold Home's mix
  rebuilds and streamed genre lookups until the scan ends, then measure whether the native scanner
  or the free turns set the rate.
- A mass removal (2,471 songs gone at once) held `filesGone` for 34.7 s. Seen once, when the seed
  half failed.
