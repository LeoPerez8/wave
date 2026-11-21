# #1348 Library reads off the JS thread

## What changed

- **Reads replay against two read connections.** The query modules in `packages/client/src/db`
  stay as they are, written against Drizzle's synchronous SQLite API. `replayRead`
  (`packages/client/src/db/offThreadReads.ts`) runs a read against a Drizzle database whose
  statements answer from rows already fetched. The first statement it hasn't seen ends the pass.
  That statement runs on a read connection through expo-sqlite's asynchronous API, so SQLite
  works on a native thread, and the read runs again from the top with one more answer. A read of
  k statements takes k + 1 short passes. JS only builds queries and maps rows.
- **Same snapshot as before.** All of a read's statements run in one `BEGIN … COMMIT` on its read
  connection, so a read of several statements sees one snapshot, as the synchronous read did.
  The two read connections (`readConnections`, opened with `useNewConnection` after the main
  connection has migrated the file) run one read at a time each. A read goes to the one with
  fewer reads waiting, so a long read doesn't hold up a screen's. They run with
  `PRAGMA query_only = ON` and a 4 MiB page cache each.
- **Writes stay where they were.** Writes stay on the main connection, synchronous and in order
  on the JS thread, with their transactions unchanged. WAL lets the read connections see each
  commit as soon as it lands, so a read asked after a write sees it.
- **What stays on the JS thread.** Three cases run on the main connection, as before:
  - a read that writes, runs a PRAGMA, or calls `changes()`/`last_insert_rowid()`. The app log
    names it once: `Read "…" runs on the JS thread: …`. None of the store's reads does today, and
    the store test checks that.
  - a read whose statements keep changing between passes (more than 512 passes).
  - an effect that must finish in its own task, which runs under `withSyncLibraryReads`
    (`apps/mobile/src/library/syncLibraryReads.ts`). Two do: PlayHistory's play recording,
    which reads the latest play in signal order, and the taste snapshot's last attempt, which
    walks its sources in one task so that no write lands during it.
- **The log line counts JS time only.** `Read "…" held JS` now reports the passes' time for an
  off-thread read (`heldLibraryRead`), not the wait for SQLite. The budget is still
  `TIMING_BUDGETS.readMs` (16 ms).
- **Every store read goes through it.** That's all 160 `attempt` reads in `LibraryStore.ts`, the
  ones since the plan included: release listening and the follow release cache (#1327),
  dislikes and the disliked songs' tracks (#1259), the reads behind In your orbit, From your
  library and Most listened recently (#1257), and the DJ's. Collaborative playlists (#1299)
  aren't on `main` yet. `artistPhotoLookups` now takes the time once, outside the read, so its
  statements match on every pass.
- **Writes over 50 ms.** No write moved. The reference log times only reads, so it doesn't show
  which writes block past 50 ms. The phone run below adds them if they do. A write that does
  would get the same treatment.

## Desktop measurement

Run on the development PC (Windows, Node 24, sql.js), not the emulator or a phone. The fast-again
fixture (`createFastAgainFixture`). "Synchronous" is the read run straight on the connection: SQL
and mapping, all on the JS thread. "Held off-thread" is `replayRead`'s `heldMs`: its passes' JS
time, with SQLite's work left out. Mean of 5 runs after 2 to 3 warm-ups.

| Read                             | 1,000 songs: synchronous | held off-thread | 12,000 songs: synchronous | held off-thread | Statements |
| -------------------------------- | -----------------------: | --------------: | ------------------------: | --------------: | ---------: |
| list songs                       |                  12.1 ms |          3.6 ms |                  184.3 ms |         43.9 ms |          1 |
| read Home                        |                   3.4 ms |          3.9 ms |                   11.3 ms |          3.9 ms |          6 |
| read Home's plays                |                   1.4 ms |          1.4 ms |                    1.5 ms |          1.6 ms |          4 |
| sum up played albums and artists |                   9.0 ms |          2.0 ms |                   95.6 ms |         10.9 ms |          6 |
| read the taste history           |                  33.9 ms |          6.8 ms |                  192.6 ms |         39.3 ms |          4 |
| read the candidate catalog       |                   0.1 ms |          0.2 ms |                    0.1 ms |          0.2 ms |          2 |
| list albums                      |                   1.5 ms |          0.4 ms |                   17.3 ms |          2.5 ms |          1 |
| read a mix song page             |                   1.5 ms |          1.2 ms |                    2.0 ms |          1.3 ms |          2 |

On a 727-song Library, the reference phone's size, every read above holds JS for well under
16 ms on the desktop. A read that maps tens of thousands of rows ("list songs" at 12,000 songs)
still spends its mapping time on JS. The paging tickets (#1351, #1352) keep such reads off
screens.

Checks run:

| Check                                                                                                                                                                                                                                                       | Result    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `packages/client` `offThreadReads.test.ts`                                                                                                                                                                                                                  | pass (7)  |
| App `databaseTests/offThreadReads.test.ts`: 68 store reads give the synchronous result, with no main-connection statement and none left on the JS thread; reads see the write before them and keep their order; `withSyncLibraryReads` finishes in its task | pass (3)  |
| App `databaseTests/*`, `databaseCompatibility`, `log/*`, taste and play-history tests                                                                                                                                                                       | pass (88) |
| App perf guards and untranslated text                                                                                                                                                                                                                       | pass      |
| Emulator or phone run                                                                                                                                                                                                                                       | not run   |

## Phone run: pending

On the reference phone (Xiaomi 25118PC98G, Android 15), first with the `ti` release before this
ticket and then with the one that carries it, YouTube Music on and the 727-song Library:

```sh
node scripts/perf/perf.ts run --scenario reference-taps --label 1348-<before|after> \
  --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
  --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on that artist's Similar artists row>"
node scripts/perf/perf.ts summary perf-results/1348-<before|after>-<time>.jsonl
```

Then use the app for a few minutes on Home, Library, Settings and Search, and pull the app log.
Record here, for each run:

- each step's first-frame median and p90, and the "Speed since" line;
- the `Read "…" held JS` lines: their count, and the largest per read. "list songs" and "read
  Home's plays" are the reference log's 637 ms and 589 ms; after, no read should be over 16 ms;
- any `Read "…" runs on the JS thread` line (expected: none);
- JS blocks over 50 ms that name a write, so the writes can be moved too if any shows up.
