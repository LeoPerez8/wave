# Local screens open from data already in memory (#1352)

Parent: #1346 (`docs/spec.md` › Fluidity). Budget: tap to first frame within 50 ms at the p90 on
the reference phone (Xiaomi 25118PC98G, Android 15), and that first frame shows the screen's
real content, never a skeleton that gets swapped out. Home is #1353's, which builds on the
pattern here.

## What changed

**Before.** Each local screen asked the Library when it mounted. The shared queries
(`useLibraryQuery`) kept a result for 30 s after its last screen left, at most 8 of them, and
dropped it at the first change that reached it. An album, artist, playlist or genre opened for
the first time drew its header from the tapped row and track skeletons until its read came back.
Stats, Settings › Disliked songs and Settings › History read on every opening. DJ worked out its
albums on every opening.

**After.**

- **Kept queries (Core).** `createLibraryQueries` gained `keep(key, reads)`. A kept query is
  read at once and stays in memory however long nobody shows it. When a change reaches it, it
  is read again, an edit at once and bursts (scan batches, imports, plays) at most every
  `keptThrottleMs` (10 s) while no screen in sight shows it. A screen that opens it starts from
  its current result and reads nothing. Tests in `packages/core/src/libraryQueries.test.ts` cover
  each kind of write: a scan batch, a scan's end, an import, a sync pull, a play, a star and a
  tag edit.
- **Startup keeps (`apps/mobile/src/library/readyScreens.ts`).** A startup job after the first
  screen settles keeps each query on its own free turn of the background scheduler (#1350):
  - the Library's lists and counts, Songs' order in its saved sort, the collaborative playlists,
    private-copy notices and playlists' last plays;
  - the first 8 playlists (collaborative ones first, each of at most 1,000 entries);
  - the first 12 genre openings;
  - Settings › Disliked songs, read again on a free turn when the dislikes change;
  - Settings › History's head;
  - Stats' opening period;
  - DJ's opening;
  - the saved YouTube Music answers (Fans might also like, About) of the 8 most played
    artists.
- **Pages from the rows in memory.** An album's and an artist's page, a Songs page's rows and
  link rows come from the Songs, Albums, Artists and Genres rows Search's index already keeps for
  the session (#1354), so they cost no second copy (`library/libraryRows.ts`,
  `library/libraryMemory.ts`). Core's `createLibraryDetails` builds the pages, and
  `packages/client/src/db/libraryDetailsParity.test.ts` checks every album's and artist's page
  against the Library's own reads on a real SQLite. Until the index has read the lists, or for an
  id it doesn't hold, the screen reads the Library as before. Songs seeds its pages before the
  frame is drawn, so rows from memory are in the first frame.
- **Recently opened.** Every playlist, genre and removed-songs page opened stays kept, at most 8
  (Core's `createRecentKeeps`, `keepRecentlyOpened`).
- **Desktop guard.** `apps/mobile/src/perf/screensFromMemoryGuard.test.ts` checks four things.
  Every route is either a covered screen, a tab's alias of one, or listed as not local with a
  reason (`perf/screensFromMemory.ts`). Each covered screen calls the hooks its entry names. Each
  of those hooks is kept, drawn from the rows, kept for the session or a store, as its entry
  says. No covered route reads the Library from its own body, except the one reviewed press.

## Bounds and memory (counted in #1346's budget)

Measured on desktop Node 24 (V8), `--expose-gc`, heap used after GC. The Library is synthetic: 727
songs (the reference phone's), 80 albums with covers, 90 artists plus guest credits, 12 genres and
10 playlists of 60 entries, built in the client's test database.

| Cache                                         | Bound                                     | 727 songs |
| --------------------------------------------- | ----------------------------------------- | --------: |
| Albums list                                   | one row per album                         |    264 KB |
| Artists list                                  | one row per artist                        |     17 KB |
| Genres list                                   | one row per genre                         |      3 KB |
| Playlists list (+ last plays, collaborations) | one row per playlist                      |     61 KB |
| Songs' order                                  | ids and spine, one sort                   |     20 KB |
| Playlist pages ahead                          | 8 playlists, at most 1,000 entries each   |    375 KB |
| Genre openings ahead                          | 12 genres, a header and a first page each |    226 KB |
| Album and artist pages from the rows          | id maps; the rows are the index's (#1354) |    399 KB |
| Recently opened pushed screens                | 8                                         | ≤ 400 KB¹ |
| Stats readings                                | 32 (each a top 10 or a genre podium)      | < 50 KB ² |
| Disliked songs, History's head                | one row per dislike; 100 plays            | < 60 KB ² |
| DJ's opening                                  | the last snapshot's families and albums   | < 50 KB ² |
| Artist answers read ahead                     | 8, within `knownYtArtists`' 16 (#1356)    | ≤ 16 kept |

¹ Eight playlist pages like the ones above. A long playlist opened costs its own entries
(about 8 KB per 10 entries). It goes when it isn't among the 8 opened last.

² Estimated from the row sizes above, not measured.

The 399 KB for album and artist pages is the worst case, with every album's and artist's page
worked out. A page is only worked out when it's opened. Before any is, the id maps cost under
100 KB.

The new caches total about **1.5 MB** for the reference Library, against a 500 MB PSS budget. The
Songs rows themselves (1.4 MB here) were already kept by #1354. Hermes lays objects out
differently from V8, so the phone run below checks the real figure (PSS).

## Phone run: pending

Measured on the desktop only (no phone or emulator run here). On the reference phone. **Before:**
the `ti` release without #1352. **After:** the `ti` release with it. Open the Library tabs, an
album, an artist, a playlist (a collaborative one too), a genre, DJ, Stats, Settings and its
Library, Disliked songs, History and Version History pages, each after the app has been open a
minute.

```sh
node scripts/perf/perf.ts run --scenario reference-taps --label 1352-<before|after>
node scripts/perf/perf.ts run --scenario push-tracklist --label 1352-<before|after>-tracklist
node scripts/perf/perf.ts run --scenario push-artist --label 1352-<before|after>-artist
node scripts/perf/perf.ts run --scenario push-playlist --label 1352-<before|after>-playlist
node scripts/perf/perf.ts run --scenario push-settings --label 1352-<before|after>-settings
node scripts/perf/perf.ts summary perf-results/1352-<before|after>-<time>.jsonl
# PSS after a few minutes of use:
adb shell dumpsys meminfo dev.leoperez.wave | grep -E "TOTAL PSS|Native Heap|Dalvik Heap"
```

Record here, for both runs:

- Each push's tap to first frame, median and p90.
- Whether that first frame showed the screen's rows (no track skeletons on album, artist,
  playlist, genre, Stats or DJ), from the screen recording or the `screen.content` mark landing
  in the first frame.
- Whether the app log shows a `Read "…"` line for the opened screen's own query between the tap
  and its first frame. After the change none should appear, except for a playlist or genre
  opened for the first time that isn't among those kept ahead.
- The `libraryQueries` perf meta (`kept`, `reads`, `shared`) and `readyScreens` (`kept`).
- TOTAL PSS.

The after run meets the ticket when every covered push's p90 is within 50 ms, its first frame
shows real rows, and PSS stays under 500 MB.
