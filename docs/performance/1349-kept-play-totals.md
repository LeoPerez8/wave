# #1349 Play totals kept up to date instead of summed on every read

Ticket: #1349 (parent #1346). Branch `feat/1349-kept-play-totals`, based on `feat/1346-instant`.

## What changed

Before, every read of a play total summed the history. "Sum up played albums and artists" and
"sum up played artists" grouped every counted play in the window. They also resolved every
streamed song's credits against the whole Library, reading every artist, album and credit to
build Core's resolver. Home's plays did the same for Recently played. Release listening scanned the
plays for recording keys, since there's no index on them, and From your library grouped every
playlist play. On the reference phone that held JS for 14.5 s over 21 reads, up to 909 ms per read.

After:

- **Migration `0069_kept_play_totals`** (`packages/client/src/db/keptTotalsMigration.ts`) keeps
  each song's counted plays, their time and their latest counted start, summed per UTC day and per
  32-day block (Core's `playBuckets`). It keeps the same per album, artist, song and Stats credit
  row the plays count for (`credited_buckets`), per recording key (`played_recordings`), and per
  playlist (`playlist_play_buckets`). Triggers on `play_events` keep the song, recording and
  playlist rows as each play is written, and mark the play's day owed (`owed_days`). The app counts
  an owed day again from its song's plays, and its block from its days, many in one statement: the
  play's own write its day at once, the startup job the rest (a pull, an import). Every writer is
  covered with no change: the player, crossfade, a BlackPlayer import, a sync pull, `deleteTracks`.
- **Credits.** What a song's plays count for (`play_credits`) is written by the app, since a
  streamed song's credits are Core's (`streamedCredits`). A Library song's credits follow
  `creditedPlayTotals`. A streamed song the Library has (`streamedTrack`) takes that song's. Any
  other streamed song is resolved as today, knowing every streamed song's release id. Triggers on
  the Library's tables mark the songs a change may re-credit as owed. A change to what Core matches
  against (artists, albums, credits) marks every streamed song the Library hasn't, and bumps a
  generation that rebuilds the cached resolver once. A play's write (start, progress, end) counts
  its owed days and credits a few songs when that needs no whole-Library read (`settlePlayWrite`).
  Otherwise the startup job does.
- **Reads.** Core's `keptTotalsPlan` splits a window into whole 32-day blocks, whole days and the
  plays of its two partial days. A read sums those rows, plus the partial days' plays through
  `play_events_started_at_idx`. It never scans the history (the tests check every plan). These read
  the kept totals: `playedEntityTotals` (Stats, Recap, mixes), `playedArtistTotals` (In your orbit,
  Follow suggestions), `songPlayTotals` (the Magic Queue carousel's most listened recently,
  Discoveries, Stats), `creditedPlayTotals`, Home's plays (each streamed song's Library song and
  album from the kept credits, so no resolver), release listening and the playlists' plays.
- **Until they settle, readers sum as before.** While anything is owed (`keptTotalsSettled`),
  every reader takes today's sum (`summedPlayedTotals`, `summedSongPlayTotals`,
  `summedCreditedPlayTotals`). So a read is never wrong, only slower until the job catches up.
- **Upgrade.** The migration notes only the last play's id. After the first screen settles, the
  `keptPlayTotals` startup job (`apps/mobile/src/library/keptPlayTotals.ts`) works through the
  history in the scheduler's background slices, one store step at a time: seeding 250 plays,
  summing or crediting 2 songs, counting 24 owed days again, or building Core's resolver a page at
  a time (see "Slices" below).
  After that it runs again whenever a Library change leaves something owed.
- **An online album's or artist's details** come from the latest played song crediting it, as
  Home's Recently played already said. Today's sum was inconsistent here: all time took the
  latest written song, a window the highest video id. Counts, time and ids are unchanged. One
  rule changes on purpose: a streamed song without a release id takes the id of another streamed
  song of the same album from any time, not only from the same window, so an online album has one
  id in every window.

## Desktop measurements

`apps/mobile/bench/keptPlayTotals.ts` (`pnpm --filter @wave/mobile bench:kept-play-totals`)
uses #579's fixture plus 6,000 streamed plays (300 videos over the same 90 days, a third of them
crediting a Library artist). It checks that the kept totals equal today's sum, then prints median
times: before (today's sum, or the reader with the totals unsettled) → after (kept). These are
desktop numbers, Node with sql.js (SQLite in WebAssembly), on a machine shared with other builds
at commit fcaa3eae0. They are not phone numbers.

| Read                                                | 1,000 songs, 16,000 plays | 12,000 songs, 60,000 plays |
| --------------------------------------------------- | ------------------------- | -------------------------- |
| sum up played albums and artists, Stats week        | 18.1 → 5.2 ms             | 88.3 → 40.0 ms             |
| … Stats month                                       | 22.9 → 7.8 ms             | 112.3 → 52.8 ms            |
| … Stats year                                        | 31.7 → 7.1 ms             | 142.7 → 50.9 ms            |
| … Stats all time                                    | 16.0 → 7.2 ms             | 94.6 → 48.6 ms             |
| … In your orbit (14 days)                           | 18.9 → 5.9 ms             | 107.3 → 48.3 ms            |
| … Follow suggestions (90 days)                      | 32.4 → 7.4 ms             | 142.7 → 53.0 ms            |
| sum up played artists, In your orbit                | 16.7 → 2.5 ms             | 80.4 → 19.4 ms             |
| sum up song plays, most listened recently (14 days) | 8.5 → 6.7 ms              | 40.9 → 47.4 ms             |
| sum up album and artist plays, all time             | 3.3 → 2.5 ms              | 51.0 → 21.3 ms             |
| read Home's plays                                   | 8.1 → 4.2 ms              | 46.6 → 9.4 ms              |
| count the playlists' plays (From your library)      | 0.9 → 0.3 ms              | 0.9 → 0.4 ms               |
| read release listening                              | 2.4 → 0.3 ms              | 8.6 → 0.7 ms               |

The kept sums are a small part of what's left. On the 1,000-song fixture the week's artist and
album sums take 0.5 and 0.8 ms; the rest is the Library rows a ranking shows (`selectArtists` and
`selectAlbums` for the played ids, 1.3 to 1.8 ms each), which today's sum reads too. Song totals
gain little: a 14-day window already summed few plays, and the result lists every played song.

What the kept totals cost:

- A Library play as the player writes it (start, progress, end): 2.4 to 2.7 ms in all, triggers
  and in-write credit included.
- Settling a whole history from scratch: 82 steps at 1,000 songs, median 6.9 ms, longest 27.3 ms.
  769 steps at 12,000 songs, median 6.7 ms, longest 73.9 ms. The longest step builds Core's
  resolver, a whole-Library read that happens once per Library change (Performance rule 6). Today
  every read of these totals paid that cost.

## Phone run: pending

None of this has run on the reference phone (Xiaomi 25118PC98G, Android 15). The 5 ms per read
criterion is the phone's and is still open. With the `ti` release that carries #1349, after an
upgrade from one without it:

1. Open Wave and leave it on Home until the startup work settles, a minute at most. The
   `keptPlayTotals` job sums the history in that time.
2. Use it as usual for a few minutes: play songs (a Library one and a streamed one), open Home, In
   your orbit and the carousel, then Stats and its week, month, year and all-time periods.
3. Run the reference taps and the summary:

   ```sh
   node scripts/perf/perf.ts run --scenario reference-taps --label 1349-after \
     --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
     --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on that artist's Similar artists row>"
   node scripts/perf/perf.ts summary perf-results/1349-after-<time>.jsonl
   ```

4. Copy the app log (Settings › App log). Record here the read lines for "sum up played albums and
   artists", "sum up played artists", "sum up song plays", "sum up album and artist plays", "read
   Home's plays", "read release listening", "count the playlists' plays" and "settle the kept play
   totals": each label's count and longest time. Set them against the 0.74.0-ti log in the spec
   (Fluidity): 14.5 s over 21 reads, up to 909 ms, and Home's plays up to 589 ms. Each of those
   reads should stay under 5 ms. A "Kept play totals didn't settle" warning means the job failed.

## Slices and owed days (review fixes)

The review of #1346's integration branch found that `settleKeptTotals` held the JS thread for a
whole step, up to 74 ms at 12,000 songs. It also asked for the history's triggers to be timed.

### Settling in slices of under 8 ms

- **Steps.** `settleKeptTotalsSteps` (`packages/client/src/db/keptPlayTotals.ts`) is a
  generator. Each step is one transaction: seed some plays, sum a few songs, count some owed days
  again, credit a few songs, or build a page of Core's resolver. The resolver used to be built in
  one whole-Library read. Now the Library rows come in pages of 500 (`playedLibraryRowsSteps`), and
  Core's `streamedCreditResolverSteps` builds a step per credit, artist, album and release. The
  credit splitter (`creditSplitterSteps`) and the Library finders work the same way.
- **The job.** The app's `keptPlayTotals` job waits for a settled turn, then runs the steps
  through the scheduler (`runSteps` with `freeTurnEffect`), each slice on a free turn. The store
  step is `KEPT_TOTALS_STEP = { songs: 2, plays: 250, days: 24 }`. The old `settleKeptTotals`
  read and its "settle the kept play totals" log line are gone. The work is now the background work
  named "kept play totals".
- **Tests.** Core's tests check that the stepped resolver resolves as the whole build does,
  including one that learns releases later. The client's tests settle with bounded steps, check
  that each owed day takes a step of its own, and check that the result equals a recount from the
  history.

`apps/mobile/bench/keptPlayTotals.ts` settles a whole upgrade's history with the store's step and
times each step and each piece. It also runs the job's 6 ms slices. The numbers below are
desktop numbers (Node with sql.js), on a shared machine.

| Settling a whole history | Before (one step per turn)          | After (store step, in slices)                      |
| ------------------------ | ----------------------------------- | -------------------------------------------------- |
| 1,000 songs              | 82 steps, median 6.6 ms, max 28 ms  | 1,858 steps, median 1.0 ms, max 5.3 ms, 0 past 8   |
| 12,000 songs             | 769 steps, median 6.6 ms, max 64 ms | 15,040 steps, median 2.2 ms, max 10.3 ms, 3 past 8 |

At 12,000 songs, by piece:

| Piece              | Steps | Median | Longest | Past 8 ms |
| ------------------ | ----- | ------ | ------- | --------- |
| seed plays         | 240   | 1.5 ms | 4.4 ms  | 0         |
| sum songs          | 6,150 | 2.8 ms | 8.7 ms  | 1         |
| credit songs       | 6,151 | 2.3 ms | 10.3 ms | 2         |
| build the resolver | 2,499 | 0 ms   | 2.2 ms  | 0         |

In 6 ms slices, 12,000 songs take 6,240 slices. The longest is 8.2 ms, and one goes past 8 ms. The
few steps past 8 ms are 3 to 4 times their piece's median, and an earlier run of the same code had
a different count (5 slices past 8 ms, longest 10.2 ms). They look like garbage collection or a
busy machine rather than a step that's too big. The phone run will tell.

### The history's triggers: marks, not sums

`apps/mobile/bench/keptTotalsTriggers.ts` (`pnpm --filter @wave/mobile bench:kept-totals-triggers`) scans 12,000 files in batches of 500 and pulls 60,000
plays in pages of 500 (`applyPulledPage`). It runs both orders: scan then pull, and pull into an
empty Library then scan. It compares migration 0069's triggers against the same database with
the `kept_` triggers dropped. `--quick` runs 1,000 files and 5,000 plays.

As first written, the triggers summed each play's day and block. That compiled the bucket and
credit triggers into every statement that writes a play. A pull cost far more than the review's
limit of about 10% or 100 ms:

| 12,000 songs, 60,000 plays | Without   | With      | Added             |
| -------------------------- | --------- | --------- | ----------------- |
| scan, empty history        | 3,374 ms  | 4,302 ms  | +928 ms (27.5%)   |
| pull, after the scan       | 25,722 ms | 39,662 ms | +13,940 ms (54%)  |
| pull, empty Library        | 13,903 ms | 28,430 ms | +14,527 ms (105%) |
| scan, after a settled pull | 3,258 ms  | 4,437 ms  | +1,179 ms (36%)   |

Now the triggers only mark the play's day owed (`owed_days`, by song and day). The app counts each
owed day again from its song's plays, and each block from its days. A step writes its many days in
one statement per span (`json_each`). Each statement that writes `play_buckets` compiles its
triggers, so bounding the number of statements is what counts. A play's own write counts its day at
once (`settlePlayWrite`, up to 8 days and 8 songs). The job's slices count the rest. Readers sum
from the history until nothing is owed, so a read is never wrong.

| 12,000 songs, 60,000 plays | Without                         | With                            | Added           |
| -------------------------- | ------------------------------- | ------------------------------- | --------------- |
| scan, empty history        | 3,376 ms                        | 4,437 ms                        | +1,061 ms (31%) |
| pull, after the scan       | 28,121 ms (longest page 622 ms) | 31,289 ms (longest page 307 ms) | +3,168 ms (11%) |
| pull, empty Library        | 14,509 ms                       | 19,146 ms                       | +4,637 ms (32%) |
| scan, after a settled pull | 3,351 ms                        | 4,562 ms                        | +1,211 ms (36%) |

After that pull the job settles in 12,687 ms of slices, and no step goes past 8 ms. Counting the
owed days again takes 2,000 steps (6,131 ms, longest 7.6 ms). Crediting takes 4,211 steps
(6,556 ms, longest 7.1 ms).

Some cost is left, and it stays:

- **A pull** still pays for the song, recording and playlist upserts, because readers need them as
  soon as the page is written. At 1,000 songs, dropping only the day marks saved about 150 ms of a
  pull. The rest is those upserts.
- **A scan** pays for the triggers on tracks, artists and albums. These already only mark songs
  owed. Their cost is being compiled into each insert statement, about 0.09 ms per file. The
  longest batch of 500 files grows by about 20 ms (196 → 217 ms). A scan writes in the background,
  so this stays.
- **A Library play the player writes** (start, progress, end) now takes 2.8 to 3.0 ms, up from
  2.4 ms. Progress and end are now one transaction each, and the play counts its own day.

This change doesn't move the reads. At 12,000 songs: Stats week 87.6 → 39.1 ms, Home's plays
48.6 → 10.1 ms, release listening 8.6 → 0.7 ms.

### What stays where it is

- **Credit attribution stays in the client.** The decisions are already Core's
  (`streamedCreditResolverSteps`, `playBuckets`, `keptTotalsPlan`). What's left in `creditSongs`
  and `libraryCredits` is about five SQL reads mixed with shaping rows, and `libraryCredits` picks
  the primary credits in SQL. Moving it would need ports for those reads, and Core would gain no
  decision.
- **The fallback readers** in `playedEntities.ts` (`streamedListeningTotals` and `streamedAlbums`)
  still read on the JS thread while the totals are unsettled. One uses `streamedTrack` per row, and
  the other builds the whole resolver. They run only between an upgrade or a big pull and the job
  settling. Moving them off the thread doesn't fit in this change: readers would need a stepped
  or off-thread version of the resolver's reads that they can await. That is left for a follow-up.

### Phone run: pending

This hasn't run on the reference phone. Use the `ti` release that carries this change, either
after an upgrade from a release without #1349 or right after a sync pull:

```sh
node scripts/perf/perf.ts run --scenario reference-taps --label 1349-slices \
  --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
  --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on that artist's Similar artists row>"
node scripts/perf/perf.ts summary perf-results/1349-slices-<time>.jsonl
```

Then copy the app log (Settings › App log). Record the longest slice of the background work
"kept play totals". It should stay under 8 ms, and no tap's frame should wait on it. Record the
sync pull's page times too.
