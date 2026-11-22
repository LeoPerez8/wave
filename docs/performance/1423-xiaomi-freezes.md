# #1423 Xiaomi freezes and slow transitions

## Reproduction

I built the perf release from `c1b7e5ba9` and ran it on the Android 15 `wave-marquee` x86_64 emulator. The seed started at 3,000 tracks, about 900 artists and 1,500 albums, with a scan root and a 100-song playlist. The first scan found the files, but the generated MP3 tags did not match all seeded album metadata: later reads reported 3,002 tracks and 3,002 album rows. The scan run therefore became heavier than the requested library shape.

The full `reference-taps` run reached Home, Library, Playlists, Settings and Now Playing while the first scan was active, then stopped when this emulator did not expose the expected `Related` accessibility target. The `tab-switch` run also stopped when it could not find the `Playlists` tab. Focused Settings and Search runs captured the available transitions. The generic emulator is useful for JS work attribution, but it does not establish Xiaomi handset timings.

## Work holding the JS thread

The first scan produced repeated `scan` blocks on Home and Settings. Home saw a 1.3 s scan block. Settings saw scan blocks from 250 to 540 ms, and Version History saw an 888 ms scan block. During the same scan, `lyrics search index: changed songs` blocked for 408 ms. This is work that continues after the scan's bounded database saves: event handling, reconciliation, index updates and related reads still take JS time.

Large read replays also held the thread independently of scan writes. A `read songs` replay took 2.8 s for 3,002 rows; `list albums` replays took up to 289 ms for 3,002 rows. Home's mix reads held JS for 349 ms, and DJ opening blocked for 470 ms. Search-index reads blocked for up to 235 ms in Settings. On Search, the tap run recorded 1.56 s response time, 439 ms to first frame and eight long tasks. These reads map large result sets back on JS after SQLite finishes off-thread.

The emulator logged startup blocks of 6.0 to 6.2 s before the first screen settled. WaveTiming attributed them to `startup`; Home then took 5.5 s to first frame and 9.0 s to content in one launch. The timing log does not identify a narrower startup subtask for those entries. The ticket's `/settings/followed-artists` route was not reached in this fixture.

## Change and follow-up

I tried saving four tracks per synchronous scan transaction instead of 100. The scan still produced 1.1 s and 373 ms blocks with it, so bounding writes alone does not bound the whole scan turn, and the emulator showed no gain from it. It meant 25 times the transactions, free turns and saved-star publishes per batch, with the first slice still carrying all of the batch's artwork, so it was reverted: scan saves stay at 100 tracks per transaction (Core's `SCAN_SAVE_SLICE`). The scan's remaining blocks are a follow-up ticket (below). The rest of this section measures that four-track build. While the post-change scan was active, a Settings push took 800 ms to respond and 1.0 s to first frame; the pop took 345 ms and 467 ms. During the post-change launch, WaveTiming also recorded a 4.6 s startup block; the watchdog reported the JS thread returning after 4.8 s, and the main thread returning after 5.8 s. Home's mix read held JS for 863 ms. In a later Search run, the tap response was 376 ms with a 513 ms first frame, then Home mix replays held JS for 449 and 511 ms. These results show that the change did not meet the freeze or transition budgets.

The focused runner's Search first-tap sample changed from 1,559 ms response and 439 ms first frame before the change to 518 ms and 144 ms after. That after sample did not overlap a logged scan slice, so it is not evidence of an improvement under concurrent scan. Settings push/pop worsened from 311/198 ms response and 92/39 ms first frame before, to 1,039/467 ms and 212/155 ms after while scan work was logged nearby.

The emulator cannot confirm the owner's day-long Xiaomi acceptance check. Home, Search and Settings still have blocks over 50 ms, and the fixture's album count drifted above the requested 1,500. The full set of route budgets also remains unmet.

## Render cost

I measured React render cost with a profiler build (`EXPO_PUBLIC_WAVE_PERF_PROFILER=1`), which logs every commit over 16 ms with the component that rendered. The runs were one idle `push-settings` and one idle `tab-switch` (three rounds of Playlists, Home and Library) on the same emulator and seed.

Before the fixes, update commits over 16 ms added up to:

| Component                      | Commits | Total ms | Largest ms |
| ------------------------------ | ------: | -------: | ---------: |
| Tabs (includes the rows below) |     243 |   35,869 |        384 |
| Home tab                       |      90 |    9,475 |        284 |
| Home: Discover                 |      76 |    5,270 |        216 |
| Now Playing (closed)           |      47 |    2,117 |        122 |
| Home: Recently added           |      42 |    1,554 |         78 |
| Home: In your orbit            |      21 |      907 |         74 |
| Library tab                    |      12 |      740 |         94 |

Home rendered again on every push, pop and tab switch, even while another tab was showing. Each time it gave its sections a new selection object and a new `home` object. `HomeSection` wasn't memoized, so every section rendered again. Discover also got a new Magic Queue row each time, and In your orbit got new tiles. Now Playing rendered again while closed, because each native playback report brought a new `item` object for the same song.

The fixes:

- Home's selection and `home` keep their identity until something in them changes.
- `HomeSection` is memoized.
- The Magic Queue section and the In your orbit tiles are kept until their inputs change.
- A playback report of the same song keeps the previous `item`.

Tests cover each identity, and a performance guard keeps `HomeSection` memoized.

After the fixes, on the same runs:

| Component            | Commits | Total ms | Largest ms |
| -------------------- | ------: | -------: | ---------: |
| Tabs                 |      98 |    7,011 |        432 |
| Home tab             |      59 |    3,538 |        273 |
| Home: Discover       |      42 |    1,699 |        100 |
| Now Playing (closed) |      14 |      511 |         68 |
| Home: In your orbit  |       8 |      514 |        140 |
| Home: Recently added |       6 |      267 |         66 |

| Step                     | Before: response / first frame    | After: response / first frame         |
| ------------------------ | --------------------------------- | ------------------------------------- |
| Settings push            | 523 / 64 ms, one 492 ms long task | 289 / 57 ms, largest long task 264 ms |
| Settings pop             | 413 / 66 ms                       | 146 / 27 ms                           |
| Tab switch, median of 9  | 689 ms                            | 297 ms                                |
| Tab switch, slowest of 9 | 1,610 ms (to Library)             | 620 ms (first visit to Playlists)     |
| Switch to Home, 3 rounds | 740, 1,057, 904 ms                | 297, 341, 324 ms                      |

The after build also includes the merge of `feat/1409-dj-playlists-home`, which adds Home sections such as DJ.

What's left:

- Home still updates 59 times over these runs, with Discover at 42 commits and up to 100 ms each. The cause of these remaining Home renders isn't traced yet.
- The first switch to Playlists now takes 620 ms with five long tasks, against 212 ms before. That is the first mount of the merged Playlists screen.
- Mount commits are larger after the merge: Tabs up to 1,098 ms and Home up to 828 ms on a cold launch, against 601 and 440 ms. The added Home sections are a likely cause, but this run doesn't separate them.
- The Tab bar still commits on every switch.

With a scan running (200 touched files, then a cold launch) on the after build, which still saved four tracks per transaction:

| Step             | Before the fixes, scan active       | After, scan active                           |
| ---------------- | ----------------------------------- | -------------------------------------------- |
| Settings push    | 1,039 / 212 ms                      | 260 / 80 ms                                  |
| Settings pop     | 467 / 155 ms                        | 294 / 45 ms                                  |
| Search first tap | 518 / 144 ms, no scan logged nearby | 719 / 196 ms, six long tasks, largest 288 ms |

Search's first tap is still over budget while a scan runs.

## Tickets to file under #1409

- **Yield while replaying large Library reads.** Mapping results for 3,000 songs or albums still holds JS for hundreds of milliseconds to 2.8 s. Cause: row mapping in synchronous replay passes. Where: `packages/client/src/db/offThreadReads.ts` and large list readers such as `packages/client/src/db/tracks.ts`.
- **Bound scan event and index work on JS.** Scan and changed-song index work still blocks from 250 ms to 1.3 s, with 100-track or four-track save slices alike. Cause: remaining event reconciliation and follow-on index work in foreground JS. Where: `apps/mobile/src/library/LibraryScan.ts`, `apps/mobile/src/library/startupJobs.ts`, and `apps/mobile/src/library/lyricsSearchIndexer.ts`.
- **Reduce Home and DJ work on large Libraries.** Home mix reads and DJ opening blocked for 349 and 470 ms on this fixture. Cause: recommendation input/ranking work over a full 3,000-row Library. Where: `apps/mobile/src/home/` and the DJ implementation under `apps/mobile/src/playback/`.
- **Trace startup blocks before first content.** Startup was attributed a 6.0 to 6.2 s hold, but the current line gives no subtask detail. Cause: unresolved from this run. Where: startup registrations in `apps/mobile/src/lib/startupWork.ts` and their callers in `apps/mobile/src/`.
- **Diagnose followed-artists route on device.** This run did not reach the route, so its reported freeze has no reproduced cause here. Cause: unconfirmed. Where: followed-artists screen and its data reads under `apps/mobile/src/`.

- **Trace Home's remaining renders on navigation.** Home still renders 59 times over three tab-switch rounds and a Settings push and pop, with Discover at up to 100 ms per commit. Cause: unidentified; the section props are now stable, so it is in Home's own hooks (focus, sight or store reads). Where: `apps/mobile/src/app/(tabs)/index.tsx` and `apps/mobile/src/home/HomeSection.tsx`.
- **Lighten the first Playlists mount.** The first switch to Playlists takes 620 ms with five long tasks. Cause: the Playlists screen mounting its content in one commit. Where: `apps/mobile/src/app/(tabs)/playlists/index.tsx`.
- **Lighten Home's cold mount.** A cold launch's Tabs mount commit reaches 1.1 s, with Home at 828 ms. Cause: every Home section mounting in the first commits. Where: `apps/mobile/src/home/HomeSections.tsx` and the first-frame staging in `apps/mobile/src/app/(tabs)/index.tsx`.
- **Keep the Tab bar out of tab switches.** The Tab bar commits on every switch. Cause: its props or store reads change with the route. Where: `apps/mobile/src/chrome/TabBar.tsx`.

## Runs and checks

- `docs/performance/results/1423-focused-before.jsonl`: generic Android 15 emulator, 3,000-song seed; Settings push 311 ms response / 92 ms first frame, pop 198 ms / 39 ms; Search first tap 1,559 ms / 439 ms.
- `docs/performance/results/1423-focused-after.jsonl`: same emulator after changing 200 file mtimes; Settings push 1,039 ms / 212 ms, pop 467 ms / 155 ms; Search first tap 518 ms / 144 ms. The raw app log also shows the scan blocks and freezes described above.
- Full `@wave/core` suite: 6,213 passed.
- `@wave/mobile` typecheck: passed.
- Release perf APK: built successfully for x86_64.
- `docs/performance/results/1423-render-before.jsonl` and `1423-render-after.jsonl`: profiler builds, idle Settings push and pop and three tab-switch rounds, before and after the render fixes.
- `docs/performance/results/1423-scan-after.jsonl`: the after build with a scan of 200 touched files running; Settings push and pop and Search first tap.
