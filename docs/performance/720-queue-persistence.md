# #720 Queue persistence split: what a skip writes

Ticket: #720 (parent #712). Branch `feat/720-queue-persistence`, based on
`feat/712-faster-lighter` at `16492035`.

## What was measured

Before this ticket, every settled queue change, a skip included, ran `JSON.stringify` on the
whole queue and sent the string three ways: a synchronous native `saveQueue`, the SQLite row
(`playback_state.queue`), and the native resume file, which wrote the queue JSON and every
player item again on each song change and every 10 seconds while playing.

Now Core's `queueWrite` decides which parts changed: the entries (by reference), the index, the
position, and the metadata (context, shuffle, repeat, key counter). Only a change of entries
serialises the queue. A skip sends the player an index through an async `saveQueue` and runs
one SQLite `UPDATE` of `queue_index` and `position_ms`. The resume file is split in two:
`resume-items.txt` (items and queue JSON), written when the player's items or JS's queue
change, and `resume-place.txt` (index, position, shuffle, repeat, source, the queue's index
and metadata, about 200 bytes), written on song changes and every 10 seconds while playing.

**Desktop** checks, all passing:

- Core (`node --test src/queuePersistence.test.ts` in `packages/core`): index, position,
  entry, new queue, shuffle, reorder, repeat and identity cases. A skip's write never reads
  the entries: a test hands it an entries list that throws when read.
- Library store (`node --test src/library/db/playback.test.ts` in `apps/mobile`, sql.js): a
  skip runs one statement that doesn't set `queue`, a reopened database reads the moved-on
  queue back, and a row saved by the previous version still resumes.
- Native (`ResumeFilesTest`, `ResumeSnapshotTest`): write, a new `ResumeFiles` over the same
  folder (the kill), read back the same queue and place; skips and position saves leave the
  items file untouched; a one-file snapshot from the previous version resumes and is replaced
  by the split files on the next save.

Phone scenarios for the owner's S24+ run, once with a short queue (one album) and once with a
several-thousand-entry queue (Library › Songs, play all), as #314 did:

```sh
node scripts/perf/perf.ts run --serial <S24+> --apk <perf.apk> --commit <source-sha> \
  --compile baseline --scenario skip,queue-drag,soak-player --variant idle,import \
  --label 720-before
node scripts/perf/perf.ts run --serial <S24+> --apk <perf.apk> --commit <source-sha> \
  --compile baseline --scenario skip,queue-drag,soak-player --variant idle,import \
  --label 720-after
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

`skip` measures the change, but not in its response: `queue.synced` fires before the queue
settles (500 ms later), and the save runs at the settle. Read the long tasks and frame misses
in the scenario's 2.5 s window, and take a `--perfetto` trace of the long-queue run to see the
JS thread's work at the settle and the main thread's `saveQueue`. `queue-drag` edits the
entries, so it still serialises the queue once per settled drag and should stay where it was.
`soak-player` checks retained memory.

Budgets:

- A skip serialises no queue: no `JSON.stringify` of entries in JS, one SQLite statement that
  leaves `queue` alone, and no native write of the items file.
- Position saves (JS every 5 seconds, native every 10 seconds while playing) write only the
  position in SQLite and only the place file natively.
- `skip`'s `next` response (tap to `queue.synced`) is unchanged. With the long queue, the
  settle after a skip no longer shows a JS long task for serialising the queue, and the
  window's frame misses are no higher than before.
- An entry change (Add to Queue, reorder, shuffle, a new queue) writes what it wrote before:
  the queue JSON once per settled burst.

## Before (16492035)

**Pending owner's S24+ run.** Record the APK, commit, phone, refresh rate, compiler filter,
Library and queue length, raw JSONL and summary here.

## After

**Pending owner's S24+ run.** Record the same metadata, raw JSONL and the `compare` table.

## Behavior kept

- Resuming after a kill gives the same queue and place: JS reads the parts back through Core's
  `savedQueueState` (the queue JSON with the index and metadata saved apart laid over it), both
  from SQLite and from the native process after a JS restart. Parts that don't fit the entries
  (a kill between the two file writes) give way to the entries' own index.
- A SQLite row and a resume file written by the previous version still resume as they did.
- The settled save still carries the current position, as before, since position saves happen
  on their own between settles.
- YT Music queue track details are saved when the entries or those details (a cover cached
  later) change, not on every skip.

## Not measured, and negative results

- No phone numbers: before and after are **pending** the owner's S24+ run.
- The Kotlin changes to `ResumeStore`, `WavePlayerModule` and `PlaybackService` weren't
  compiled here (no Android SDK in the agent session). `ResumeFiles`, `ResumeSnapshot` and
  their tests are plain JVM and were compiled and run with a standalone `kotlinc` and JUnit 4.
- Playback resumption from the system media controls or Android Auto after a kill, and JS
  adopting the queue after its runtime restarts, need a check on the phone.
