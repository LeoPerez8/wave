# #725 Database settings and the ongoing-play index

Ticket: #725 (parent #712). Branch `feat/725-database-settings-2`, based on
`origin/feat/712-faster-lighter` at 16492035.

## What changed

- The Library's connection (`library/db/connection.ts`, shared by the phone and the sql.js
  tests) sets WAL with `synchronous=NORMAL`, `temp_store=MEMORY`, an 8 MiB page cache
  (SQLite's default is 2 MiB), 64 MiB of memory-mapped reads and `analysis_limit=400`.
  Before, it set only WAL and foreign keys, so every commit waited on a full disk sync.
- `PRAGMA optimize` runs twice. The first run, `optimize=0x10002`, is a startup job named
  `optimize` that runs after the migrations, once the first screen has settled. The second
  is a plain `optimize` each time Wave goes to the background. `analysis_limit` caps ANALYZE
  at about 400 rows per index. Neither run is part of building the store, so cold launch
  does no ANALYZE before the first screen.
- Migration `0044_ongoing_plays` adds `play_events_ongoing_idx`, a partial index on
  `ongoing` for ongoing play events only. Index 43 belongs to #720's queue persistence. The
  0044 timestamp sorts after 0043 so phones apply both, in either merge order.
- Grouped writes: scan save slices (`saveBatch`), imported BlackPlayer plays
  (`saveImportedPlays`) and sync pull pages (`applyPulledPage`) already ran in one transaction
  each. New tests now keep them that way.

## Desktop evidence

- `connection.test.ts`: the settings read back as applied (sql.js has no mmap and always
  reports `mmap_size` 0). Optimizing after open writes `sqlite_stat1` for the play history.
  The background run refreshes statistics after the session's reads have made them stale.
  Replacing the background run with a no-op fails the test.
- `playHistory.test.ts`: with a 5,000-play imported history, starting a play ends the
  previous one with `SEARCH play_events USING INDEX play_events_ongoing_idx` and no scan of
  `play_events`. `latestPlay` uses the same index. A Library from before 0044 gets the index on
  upgrade. The existing play-history tests pass unchanged.
- `groupedWrites.test.ts`: a 100-file scan slice, 500 imported plays and a 300-play pull page
  each begin one transaction, and no write commits outside it (`traceTransactions` in
  `testDatabase.ts`).
- Planner statistics change plans. With them, the 1,000-song fast-again fixture (one artist
  with 300 of its songs) plans `artistsByIds`/`listArtistsPage` as a scan of
  `track_artists`, a cheap choice at that size. At 12,000 and 50,000 songs the analyzed
  plans still seek `track_artists_artist_idx` and `album_artists_artist_idx`.
  `artistCounts.test.ts` now guards the 12,000-song case with statistics. The #579 guards
  still check the plans without statistics.

## Phone runs (pending, owner's S24+)

Use comparable perf builds before and after:

```sh
node scripts/perf/perf.ts run --scenario skip,startup,rescan-return --variant import --label 725-before
node scripts/perf/perf.ts run --scenario skip,startup,rescan-return --variant import --label 725-after
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

Budgets:

- `skip` (`queue.synced`): no regression against #546. The play start's update of ongoing
  plays now seeks one or two rows instead of scanning the whole history.
- `startup`: first content no later than before. `startup.started optimize` appears after
  `startup.content`. The first run after the update is the only one that analyses every
  table.
- `rescan-return`: the rescan's save slices commit without a full sync each. Compare its
  slice timings and the slow-library-read log.
- Before and after, check a Library with a large imported BlackPlayer history for slow reads
  of Library › Artists and artist pages. Those are the reads whose plans change with
  statistics.

Not measured here: whether NORMAL sync and mmap save time on the phone's storage. The numbers
above are for the owner's run.
