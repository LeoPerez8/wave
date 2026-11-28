# #1532 Reading DJ mood features doesn't hold the JS thread

Ticket #1532, part of spec #1528. Branch `feat/1532-mood-features-off-js`.

## What the owner's log showed

`Read "read DJ mood features" held JS 1.7 s (3,694 rows)`, on Home at 17:49 on 27 November, next
to a 6.3 s freeze. The read already ran off the JS thread (#1348): it is the replay's JS time,
not SQLite's.

## Cause

`selectDjMoodFeatures` asked for the candidates' features 500 video ids per statement
(`chunks`). A replayed read runs again from the top after each statement it hasn't seen
(`replayRead`), so 3,700 videos took 8 statements and 9 passes. Every pass built the Drizzle
query of each statement before it again (500 bound ids each, then keyed by `JSON.stringify` of
its parameters), and the last pass built all 8 and set every row into the result's `Map` in one
go. The JS cost grew with the square of the statement count.

The Library's features (`selectDjLibraryMoodFeatures`, "read DJ Library mood features") took two
statements and built its `Map` in its last pass the same way.

## Change

- **One statement per read.** `djMoodFeatureRows` asks for every requested video at once
  (`video_id IN (SELECT value FROM json_each(?))`, one bound JSON array) and leaves misses out in
  SQL. `djLibraryMoodFeatureRows` reads the ISRC-tag rows and the stream rows in one `UNION ALL`,
  ordered so the stream rows come last. A read is now two passes whatever its size.
- **Rows become features in slices.** Core's `djMoodFeaturesSteps` turns the rows into features
  by id, a step per row: a row counts only with its four fields and a mode of 0 or 1, and a later
  row for an id replaces an earlier one that counted (a stream's features over an ISRC tag's), as
  before. The store reads both through `attemptStepped`, so that work runs in replay slices of
  8 ms at most (`finishReplaySteps`), named `Library read replay` in the block log.
- **Same picks.** `selectDjMoodFeatures` and `selectDjLibraryMoodFeatures` keep their results
  (the client's tests are unchanged and pass), and the store's off-thread reads give what its
  synchronous ones give with 3,700 candidates and 50 downloaded Library songs
  (`databaseTests/offThreadReads.test.ts`). DJ moods and the Library stand-in read the same maps,
  so they pick the same songs.
- **Only for a mood.** Every caller already read the features only when the session has a mood
  (`mood.length === 0 ? new Map() : …`): the DJ's Library ranking, its radio candidates and first
  radio song, the Library stand-in and Play Downloaded Songs. Nothing on Home's start reads them;
  the owner's line came from a DJ session with a mood running while Home was in front. A source
  guard (`startupGuards.test.ts`) fails if a mood features read loses that check.

## Desktop measurement

Development PC (Linux, Node 26, sql.js), under parallel load from sibling tickets (load average
about 80). `replayRead` with 3,700 requested videos, 2,960 of them with features, `heldMs` and the
longest single step (pass or mapping step) through `runReplayPassesWith`. 8 runs each.

|                       | Statements | Steps | Held JS (all steps) |  Longest step |
| --------------------- | ---------: | ----: | ------------------: | ------------: |
| Before (500 ids each) |          8 |    23 |      56.6 – 79.1 ms | 5.8 – 11.1 ms |
| After (stepped)       |          1 |     3 |        3.0 – 6.3 ms |  2.2 – 4.6 ms |

## Emulator runs

Emulator results, not the phone's: AVD `wave-run-903` (android-36 google_apis x86_64), release
builds for x86_64. "Before" is the branch point `61dfbf4ef`; "after" is `2031ff0b5`, this change on
it. The 3,000-song seed (`scripts/perf/seed.ts`), plus 3,700 candidate songs (one radio, Amber
Ainsley's) with kept features, 2,960 of them found, and 1,500 Library songs downloaded from those
videos (1,200 of them found). The network was off. Each run: fresh app data on that database,
launch, dismiss the links dialog, wait 20 s on Home, open DJ, pick the first artist, turn on
Energetic, Play, then 45 s, then Home. Lines are quoted from each run's app log. The PC was under
load from sibling tickets, and the host's low-memory killer stopped the emulator twice, so some
runs were lost and redone. The rebuilt "before" runs and every "after" run used a 2 GB boot of
the AVD; the first "before" run used its 4 GB boot.

**Before**, 3 runs (all three looked the same):

```
JS blocked 50 ms … 99 ms on /dj by Library read replay           (9 blocks, within 0.9 s)
Read "read DJ mood features" held JS 945 ms (2,960 rows) on /dj; Read "read DJ Library mood features" held JS 32 ms (1,200 rows) on /dj
JS blocked 66 ms on / by Library read replay
Read "read DJ mood features" held JS 445 ms (2,960 rows) on /    (the session's next batch, Home in front)
```

| Run | `read DJ mood features` on /dj | then on / | Blocks over 50 ms by Library read replay on /dj |
| --- | -----------------------------: | --------: | ----------------------------------------------: |
| 1   |                         945 ms |    445 ms |                                  9 (50 – 99 ms) |
| 2   |                         911 ms |    415 ms |                                  9 (53 – 90 ms) |
| 3   |                         911 ms |    394 ms |                                  9 (55 – 91 ms) |

**After**, 4 runs: no `read DJ mood features` or `read DJ Library mood features` line in any run,
so each read held JS for 16 ms or less in all, every step included (`SLOW_READ_BUDGET_MS`, the
line's threshold), against the 50 ms block line. No `Library read replay` block on /dj. The ones
left on / are Home's own reads, not a mood read: on Home's start before DJ opened (57 – 157 ms),
and on returning to Home, next to `read Home's plays` and `sum up played albums and artists`
(50 – 73 ms). The other /dj blocks are `kept play totals`, renders and `DJ batch` (131 – 152 ms),
outside this ticket.

**Home's start.** No run, before or after, read mood features before DJ started: every mood
line came after the tap on Play. The owner's 1.7 s on Home was most likely a DJ session with a mood picking
its next batch while Home was in front, as the second "before" line above shows.

The phone confirms these from the WaveTiming lines of the owner's next exported log on the `ti`
release: `read DJ mood features` should no longer show, or show under 50 ms.
