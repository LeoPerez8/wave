# #314 Skip within a large Queue: work per skip in applySync

Ticket: #314 (parent #301). Branch `feat/314-native-seek-skip`, based on `perf/301-performance` at
761375e.

## The work a sync did before (761375e)

A skip goes `actions.ts` › `Queue.dispatch` (one lane) › `applyPlan` › `WavePlayer.applySync` on
the main thread (`Queues.MAIN`, where the `MediaController` lives). For a queue of n entries, by
plan kind:

| Plan                | JS thread (`applyPlan`)                                                                                                                    | Main thread (`applySync`)                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Every plan          | n keys mapped for `planPlayerSync`, which finds the anchor (`indexOf`) and diffs both sides; `new Set(native.keys)`; filter of every entry | `loaded`: every item read (`getMediaItemAt`) and put in a map by media id                               |
| Seek only (a skip)  | as above; no items sent                                                                                                                    | `editor.keys` rebuilt the list of all n media ids, then `indexOf`; `seekTo(index, 0)`                   |
| Insertion / removal | as above; items for the new keys                                                                                                           | `editor.keys.size` rebuilt the n-id list again per edit step; then `addMediaItems` / `removeMediaItems` |
| Full replacement    | as above; items for the keys not loaded                                                                                                    | `setMediaItems` with loaded items reused from the map, `prepare`                                        |

After the edit, the service side reacts on its own thread budget:

- a timeline change (insert, remove, replace) makes `PlaybackService` save the resume snapshot with
  every item (`ResumeStore.savePlayer(withItems = true)` reads n items on the main thread, encodes
  and writes on its executor);
- a skip is a media item transition: the snapshot is saved without items (O(1) on the main thread,
  the write on the executor).

Media3's own work (the controller's timeline, the session IPC, ExoPlayer) is outside Wave's code
and wasn't changed.

## What changed

- Core's `seek` step carries `index`, where the player holds the key (the anchor `planPlayerSync`
  already finds).
- Native `QueueSync` reads the player one item at a time through `PlaylistEditor` (`size`,
  `keyAt`, `itemAt`). A seek checks `keyAt(index)` and seeks; only when that key isn't there
  (the list changed under JS: Android Auto, playback resumption) does it walk the list to find
  it, and fails as before when the key is gone, so JS re-reads the player and plans again.
- Loaded items are read only for keys a step re-inserts that JS didn't send (a moved entry), in one
  pass before any step edits the list, stopping once all are found. A seek, a plain insertion and a
  removal read none. A key that can't be resolved now fails before anything changes.
- No lookup state is kept between syncs: every read goes to the controller's current timeline, on
  the main thread, so external timeline changes are never served from a stale index.
- JS: Core's new `keysToLoad(player, steps)` names the keys the plan inserts that the player
  doesn't hold. `applyPlan` sends items only for those, so a skip no longer builds a set of the
  player's keys or filters every entry.
- Instrumentation: `queue.synced` mark after each applied sync (detail: step types and queue
  length) and a `skip` runner scenario (the mini player's Next track).

## What was measured

Desktop only so far. The phone wasn't attached.

**Native, desktop JVM** (JDK 17, win32-x64). `SkipBench.kt` (kept with the #301 working notes,
not in the repo) times the seek path against a plain list standing in for the controller, so it
counts Wave's own work, not Media3's. Before is the 761375e algorithm (map every item, rebuild the
key list, `indexOf`); after is `QueueSync.apply` with the index.

| Queue | Before (µs per skip) | After (µs per skip) |
| ----: | -------------------: | ------------------: |
|    50 |                 4.29 |                0.13 |
| 5,000 |               109.94 |                0.06 |

On the phone each `getMediaItemAt` on a `MediaController` reads a window from its timeline, and the
old seek did 3n of them plus an n-entry map, so the device cost per skip should scale the same way
and be larger. That's an expectation, not a measurement.

**JS, desktop Node** (v24, `jsSkipBench.ts`, same notes folder): the JS work `applyPlan` does for a
skip.

| Queue | Plan only (µs) | Before: plan + set + filter + mirror (µs) | After: plan + `keysToLoad` + mirror (µs) |
| ----: | -------------: | ----------------------------------------: | ---------------------------------------: |
|    50 |            1.5 |                                       2.3 |                                      0.8 |
| 5,000 |           52.8 |                                     327.7 |                                     50.6 |

What's left on the JS side for a skip is `planPlayerSync` itself: mapping the queue's keys,
finding the anchor and diffing both sides, all O(n). Making that incremental would change how the
queue and the mirror are kept, so it was left out of this ticket.

## Device: pending

No phone attached during the work. To measure, with a perf build of 761375e (before) and of this
branch (after), for a short queue (one album) and a several-thousand-entry queue (Library ›
Songs, play all):

```sh
node scripts/perf/perf.ts run --scenario skip --label 314-before-short
node scripts/perf/perf.ts run --scenario skip --label 314-before-long
# same with 314-after-…, then:
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

`responseMs` is touch to `queue.synced` (skip latency through the JS lane and the native call);
the frame metrics and a `--perfetto` trace show main-thread work (`main` thread slices around the
`applySync` call). The before build has no `queue.synced` mark: build it from 761375e with the
mark added, or compare its traces only. Check on the first run that `uiautomator` finds a single
`Next track` (the mini player's; Now Playing is closed in this scenario).

## Behavior kept

- `QueueSyncTest` (JVM): seek with a correct, stale, out-of-range and missing index; a seek on a
  5,000-item list reads one key and no item; an insertion and a removal on 5,000 items read
  nothing; a move re-inserting a loaded item reads it once, before the edit; replace, clear,
  rejected steps (nothing changes); steps as JS sends them. Run through Gradle
  (`:wave-native:testDebugUnitTest`): `QueueSyncTest` 10/10. The run had 13 failures elsewhere,
  all Windows-only path tests (TreeUris, AudioFileWalker, LibraryScanner, TrackFileDeleter,
  PlaylistFiles, PlaylistImageStore), unrelated to this change.
- Core `playerSync.test.ts`: the seek's `index`, including a seek followed by edits; `keysToLoad`
  for skips (without reading the player's list), edits, replacements and removals.
- Recovery after a failed sync is unchanged: a step that doesn't fit throws
  `IllegalArgumentException`, JS re-reads `getItemIds` and plans again.
- Untouched: `PlayerMediaItems` (Track metadata and stream resolution happen when items are
  built, and JS still sends every new key), repeat (`setRepeatMode`), Android Auto (the service's
  own handling, plus the stale-index fallback above), resume snapshots (`PlaybackService`
  listeners).
