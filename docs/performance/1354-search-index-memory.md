# Search reads an index kept in memory (#1354)

Parent: #1346 (`docs/spec.md` › Fluidity). Budget: Search's first frame and each keystroke's
local results within 50 ms at the p90 on the reference phone (Xiaomi 25118PC98G, Android 15).

## What changed

**Before.** Search's index followed the Library's shared list queries only while Search wanted
it. Each time Search opened after being let go, it read "list songs", "list albums", "list
artists", genres and playlists whole and prepared them again before it found anything. The
reference log shows Search's content taking 384 ms to 1.9 s.

**After.** The index is kept for the whole session:

- A startup job (`afterFirstSettled("searchIndex")` in `app/_layout.tsx`) starts it after the
  first screen settles. If Search is wanted before that, it starts at once.
- Core's `createSearchIndexFollower` (`packages/core/src/searchIndexFollow.ts`) decides each read.
  Every source is read once, songs first. An edit (tag edit, deletion, playlist edit, sync pull)
  re-reads the sources it reaches at once. A scan batch or a download landing patches only its
  songs, by id (`songsWithIds`), into their place in the songs list's read order (Core's
  `compareSongReadOrder`). Albums, artists, genres and playlists follow bursts at most once per
  1.5 s. Favorites and plays reach no source and read nothing, so favoriting from a Genius result
  is one write and no rebuild.
- Reads run off the JS thread (#1348). Preparing goes through the one scheduler (#1350) in 6 ms
  slices of 250 entries.
- Core's `createSearchCatalog` now reuses what it prepared for any row whose search text is
  unchanged (rows keyed by id). A re-read prepares only the rows that changed. Until every
  source is prepared, the index finds what the ready sources hold (`complete()` reports when
  all are).
- Opening Search and typing read nothing from the Library. `useSearchIndex` only reads the kept
  index, and the YT Music "in Library" finder is built over the index's songs
  (`libraryFinderOver`). `search/searchIndexReads.test.ts` guards this.
- Community playlists (#1298) come from the network and stay out of the index. They don't gate
  the first frame or a keystroke's local results.

Not in the index: local lyrics search (`useLocalLyricsSearch`) queries its word index (FTS),
which runs off the JS thread since #1348. It used to run one query per keystroke. Now
`search/lyricsQueries.ts` reads it only after typing pauses for 250 ms, or at once when the query
is submitted or a recent search is picked. Every new keystroke drops an older read's answer, so an
old answer never lands over a newer query. Until the new answer arrives, the last one stays in
place, so the Lyrics section doesn't jump in and out while typing. A change to what Songs shows
filters that answer again without a new read. `search/lyricsQueries.test.ts` and
`search/lyricsSearch.test.ts` cover this: no read per keystroke, one read after the pause, a
stale answer dropped, and clearing the field clearing Lyrics.

## Memory (counted in #1346's budget)

Measured on desktop Node 24 (V8), `--expose-gc`, heap used after GC. The rows are synthetic but
use the app's field shapes (`SongRow`, `AlbumRow`, `ArtistRow`), with one album per 10 songs, one
artist per 5, 20 playlists and 15 genres.

| Library                     | Index entries | Rows kept | Prepared index |   Total |
| --------------------------- | ------------: | --------: | -------------: | ------: |
| 727 songs (reference phone) |           981 |    584 KB |         603 KB | ~1.2 MB |
| 5,000                       |         6,535 |    3.9 MB |         3.4 MB | ~7.4 MB |
| 20,000                      |        26,035 |   15.8 MB |        12.7 MB |   28 MB |

On the reference phone the index costs about **1.2 MB**. The songs rows are shared with the YT
Music finder, which already held a copy while Search was open. Hermes's object layout differs
from V8's, so the phone's figure is checked in the phone run below (PSS with and without the
index).

## Desktop timings (this PC, Node 24, same synthetic Library)

| Library | Songs prepared whole | Keystroke p90 (12 queries, limit 50) | Keystroke worst |
| ------- | -------------------: | -----------------------------------: | --------------: |
| 727     |               1.6 ms |                              0.55 ms |         0.88 ms |
| 20,000  |                59 ms |                               7.3 ms |           14 ms |

Preparing runs in 6 ms slices, so the 59 ms for 20,000 songs is spread over about ten free turns.
`packages/core/src/searchCatalog.test.ts` keeps a 50,000-song step bound.

## Phone run: pending

This was measured on the desktop only. On the reference phone, with YouTube Music on.
**Before:** the `ti` release without #1354. **After:** the `ti` release with it.

```sh
node scripts/perf/perf.ts run --scenario search-first-tap --label 1354-<before|after>
node scripts/perf/perf.ts run --scenario search-typing --label 1354-<before|after>-typing
node scripts/perf/perf.ts summary perf-results/1354-<before|after>-<time>.jsonl
# PSS after a few minutes of use, Search opened at least once:
adb shell dumpsys meminfo dev.leoperez.wave | grep -E "TOTAL PSS|Native Heap|Dalvik Heap"
```

Record here, for both runs:

- Search's first-frame median and p90, and `search.typed` → `search.results` per keystroke.
- How many `"search indexed lyrics"` reads the app log shows while typing (expected: one per
  pause or submit).
- Whether the app log shows `Read "list songs"`, `"list albums"` or `"list artists"` when Search
  opens or while typing. After the change, none should appear.
- The `search` perf meta (`entries`, `prepared`, `complete`, `read`).
- TOTAL PSS.

The after run meets the ticket when both p90s are within 50 ms and no list read appears when
Search opens or while typing.
