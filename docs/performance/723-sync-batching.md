# #723 Wave account sync batching and a foreground minimum interval

Ticket: #723 (parent #712). Branch `feat/723-sync-batching`, based on
`origin/feat/712-faster-lighter` at 980002cb.

## What changed

Before this ticket every play start and every play end bumped `playHistoryVersion`, and
`startSync` turned each bump into a sync 3 seconds later: two syncs per song, and one more
after each pull that brought plays (the pull bumped the version too). Every return to the
foreground synced, with no minimum interval.

`apps/mobile/src/sync/syncTriggers.ts` now times the syncs, free of React Native:

- A play start schedules no sync. Its row isn't pushed until the play ends anyway.
- Play ends batch: a sync a minute after the last end (`PLAY_BATCH_DELAY_MS`), at most
  five minutes after the batch's first end (`PLAY_BATCH_MAX_MS`), so skipping through
  songs can't hold it back. The timing is the same in the foreground and the background.
- Playlist, favorite and synced-setting edits, imported plays and song-list changes keep
  the 3-second debounced push. A push waiting takes the batched plays with it, and a play
  end doesn't hold a push back.
- A return to the foreground syncs only when the last sync that finished started five
  minutes ago or more (`FOREGROUND_SYNC_INTERVAL_MS`), or none has finished. A failed or
  offline sync doesn't count, so the next return tries again. A return while a sync runs
  adds none.
- Plays pulled from the account no longer start a sync. `PlayHistory` reports what went in
  locally through `onPlaysRecorded` (`started`, `ended`, `imported`).

Nothing is lost: plays stay unpushed in the store until a sync's push is accepted, and a
launch or sign-in still syncs at once.

## Tests

`apps/mobile/src/sync/syncTriggers.test.ts` drives the triggers with a hand-moved clock
(`testSyncClock.ts`): no sync on play start, batched and capped play ends, the 3-second
push, edits and play ends together, the song-list flag across a failed sync, the foreground
interval (after a finished and a failed sync, during a running sync, with plays waiting),
sign-out, and the first sync after launch.
`playSync.test.ts` runs the triggers against `syncCycle` and the sync service's test
harness: a play recorded and ended reaches the account in the batch after its end, and a
batch that failed offline goes up at the next foreground return.

## Phone check (pending, S24+)

Perf builds count `js:sync.run` once per sync started (signed in). Compare it with the
existing scenarios on a signed-in perf build, before and after:

```sh
node scripts/perf/perf.ts run --scenario soak-player --variant idle --label 723-before
node scripts/perf/perf.ts run --scenario soak-player --variant idle --label 723-after
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

Then, with #713's screen-off soak once integrated, play an album with the screen off for
30 minutes signed in, and switch away from and back to Wave ten times within a minute.

Budgets:

- Zero syncs from play starts. At most one sync per minute of play ends while the screen is
  off (today two per song), and the first within five minutes of the first end.
- At most one foreground sync per five minutes of switching apps (today one per return).
- Playlist, favorite and setting edits still reach another phone within 3 seconds plus one
  sync.
- Every play recorded during the soak is on the account after the next sync.

Before/after numbers are left for the owner's run.
