# #309 Shared Library queries: reads per session, hidden screens paused

Ticket: #309 (parent #301). Branch `feat/309-shared-library-queries`, based on `perf/301-performance`
at 761375e.

## What changed

Before, `useLibraryQuery` (`apps/mobile/src/library/hooks.ts`) ran one read per mounted consumer.
Each consumer followed `libraryVersion` on its own (scan batches throttled to 1.5 s, edits at
once) and kept following it while its tab was hidden. Two screens showing the same query read it
twice, and a playlist edit re-read every Library query.

Now:

- Writers announce a `LibraryChange` (Core, `packages/core/src/libraryQueries.ts`): a data kind
  (`tracks`, `folders`, `favorites`, `playlists`, `plays`), the ids when known, and `burst` for
  streams of additions. The app bus is `apps/mobile/src/library/libraryChanges.ts`.
- Each query declares what it reads (`LibraryReads`). A change re-reads only the queries it reaches:
  a playlist edit re-reads that playlist's screen, the Playlists list and the counts, and leaves
  the Songs list, Albums and Home alone.
- Core's `createLibraryQueries` keeps one entry per query key. Every screen showing a key shares
  one result and one read at a time. A screen that opens later starts from the current result.
- Hidden screens pause. A screen is hidden when its route isn't focused (tabs stay mounted) or
  Now Playing covers it (`CoveredByNowPlaying`, provided by `UnderNowPlaying`). Bursts (scan
  batches, import additions, plays) don't re-read a query only hidden screens show, and don't
  re-render those screens. The query reads once, without the throttle, when a screen showing it
  comes back. Edits (deleted songs, tag edits, stars, playlist edits, a scan's end that dropped
  gone files) re-read even hidden queries, so no screen comes back showing a removed item. Queries
  in sight read first.
- A result that an edit made out of date while it was being read is dropped. The query then reads
  again at once. A burst landing mid-read doesn't drop the result, so scan progress still shows.
- Retention: once no screen shows a query, its result is kept for 30 s (`retainMs`). At most 8
  such results are kept (`maxRetained`), and the least recently shown goes first. A change that
  reaches a kept result drops it rather than reading it for nobody. Results that screens show are
  bounded by the mounted screens. The app releases a query's definition, and its change
  subscription once none is left, when Core reports the query dropped.

## What was measured

**Desktop model, not phone numbers.** `packages/core/bench/libraryQueries.ts`
(`node bench/libraryQueries.ts` from `packages/core`, or `pnpm --filter @wave/core bench:queries`)
runs four scripted sessions on a virtual clock, once through a model of the old hook (from
`hooks.ts` at 761375e) and once through Core's registry. It counts reads started and the most
results held at once (each copy counts; the old hook held one per consumer). The consumers per
screen come from the codebase map: Home (home, listening overview), Library (home shelf, track
count, counts, music folders), Settings (music folders ×2, missing songs), and the pushed Songs,
Albums, album, Playlists and playlist screens. Every session ends by visiting each tab once, so
the paused queries' catch-up reads are counted.

| Session    | Old reads | Shared reads | Change | Old results held (peak) | Shared results held (peak) |
| ---------- | --------: | -----------: | -----: | ----------------------: | -------------------------: |
| scan       |       119 |           31 |   -74% |                      11 |                          7 |
| import     |       191 |           11 |   -94% |                      11 |                          8 |
| navigation |        29 |            8 |   -72% |                      10 |                          8 |
| playback   |        27 |           18 |   -33% |                       9 |                          6 |

- **scan**: 150 batches 80 ms apart, watched from Library › Songs. The visible Songs list still
  reads every 1.5 s (10 reads, unchanged; #310 pages it). The hidden tabs' queries read once each
  when visited instead of every 1.5 s.
- **import**: an import adds to playlist 7 once a second for a minute while Home is in sight. The
  hidden Playlists list, the playlist screen and Library's counts read once on return instead of
  61 times each.
- **navigation**: Albums and back ten times, one album and back ten times, ten rounds of tabs. A
  screen reopened within 30 s reuses its kept result (albums 10 reads to 1, album 10 to 1).
- **playback**: 40 songs played with Now Playing over Home, and five stars. Plays wait for Home to
  come back. Stars are edits, so they still re-read hidden Home and Library counts (6 reads each).
  That is the cost of never showing an unstarred song on return.

The model counts reads, not their cost: one Songs read reads every track, while a count reads one
row.

## Before and after on the phone

**Pending.** No phone was attached (`adb devices` empty), and this ticket has no native change, so
no APK was built. The perf build now reports the registry's counters with each flush, and the
runner copies them to each step as `libraryQueries` (README, "Instrumentation for later tickets").
To measure, build a perf APK from 761375e and one from this branch, then run both with:

```sh
node scripts/perf/perf.ts run --scenario tab-switch,rapid-tabs,push-library,push-tracklist,now-playing \
  --variant idle,import --label 309-before
node scripts/perf/perf.ts run --scenario tab-switch,rapid-tabs,push-library,push-tracklist,now-playing \
  --variant idle,import --label 309-after
node scripts/perf/perf.ts compare <before> <after>
```

Compare the latencies and frames (`compare`), PSS and Java heap (`memory` records), and per-step
reads (`libraryQueries.reads` minus the previous step's; the 761375e build has no counters, so its
query count comes from the model above). A first scan needs a fresh install or a cleared Library;
note which.

## Behavior kept

- Core tests (`node --test` in `packages/core`; 28 tests in `libraryQueries.test.ts`) cover shared
  reads, per-kind and per-playlist invalidation, the throttle, pause and catch-up, the Now Playing
  cover, dropped stale reads, failed reads, retention and its bound, and the order of reads.
- App tests (`node --test 'src/**/*.test.ts' 'plugins/**/*.test.ts'` in `apps/mobile`) and the
  runner tests (`node --test scripts/perf/*.test.ts`) pass. Both typecheck.
- `useLibraryQuery(effect, initial, queryEdits?)` still works. A bare Effect is one query per Effect
  object and follows every track and folder change, as before. Every exported hook in `hooks.ts`
  keeps its signature.
- A query's result is keyed by its parameters (`album:12`), so a screen never shows another key's
  result while its own loads. `useLinkRows` and `useAlbumsMissingSongs` no longer need their own
  guards.
- The version stores (`libraryVersion`, `playlistsVersion`, the favorites' `saved`,
  `playHistoryVersion`) still bump for what follows them directly: Search's index, sync, downloads,
  the stats screens.

## Not measured, and limits

- Device numbers: pending (above).
- Reads still run on the JS thread as synchronous SQLite under the Effect. The registry starts
  them in a `setTimeout(0)`, outside the writer's call or the navigation and Now Playing
  listeners, but a long read still blocks the frame it lands in.
- A read can't be cancelled (the read is synchronous); an out-of-date result is dropped instead.
- Search's index (`searchIndex.ts`), `libraryFinder`, `streamedArtist`, `sectionSongs` and the
  stats hooks still read outside the registry. #306 takes the Search index.
- `playlistsChanged` no longer reads the remembered playlist list ahead for import additions
  (bursts). The next card that lists playlists reads it then.
