# Home opens from memory, and a cold start draws the last Home at once (#1353)

Parent: #1346 (`docs/spec.md` › Fluidity). Budget: tap to first frame within 50 ms at the p90 on
the reference phone (Xiaomi 25118PC98G, Android 15), and that first frame shows Home's real
content, never a skeleton that gets swapped out. Built on #1352's kept queries.

## What changed

**Before.** Home's first frame drew `HomePlaceholders`: a `HomeSectionSkeleton` for every local
section. Two animation frames later it mounted the real sections, which then asked the Library.
Each section showed its skeleton again until its read answered. At a cold start nothing was
ready, so the reads ran while "Wave … started", "list playlists", "list songs" and "open the
playlist" were running too.

**After.**

- **First frame is the real Home.** `app/(tabs)/index.tsx` draws `HomeContent` from its first
  render. `HomePlaceholders`, `HomeSectionSkeleton` and `homePlaceholderSkeleton` are gone. The
  follow cards' reads and Recap still wait until Home has painted (`afterHomeFrame`).
- **Cold-start snapshot** (`home/homeSnapshot.ts`, Core's `homeSnapshot.ts`). When the app goes
  to the background, Home saves what its local sections last showed. The next cold start reads
  it once, before Home's first render, so the first frame draws the last Home. Artwork comes
  from the image cache, because the rows hold the same thumbnail paths and URLs. Each section
  shows the snapshot's copy only until its first read this session answers. After that it shows
  the read, and the snapshot's copy is let go. Rows are keyed by id, so the rows still there
  keep their places.
- **Magic Queue in place.** The carousel opens on the snapshot's page in sight. Its first pool
  read is planned as `keep` with the snapshot's pages (`magicQueuePagesRead`), so fresh data
  fills the same songs in the same places, and nothing new is drawn under the owner's eyes. The
  pages are also kept for the session (`keptPages`), so Home mounting again finds them.
- **Ready in memory** (`home/homeReady.ts`, through #1352's `keepReady`). From the first settled
  screen on, `readyScreens.ts` keeps Home's queries first, one per free turn: In your orbit's
  ranking, Most played albums and artists, and From your library, for today's local day. Home's
  own lists (`readHomeAdded`, `readHomePlays`, `readHomeFavorites`) and the Stats facts'
  `readListeningSums` are kept with the Library's queries (`readyLibraryQueries`).
- **Sections already kept on the phone** draw their kept copy in the first frame, as before:
  Discover's Artist and Genre mixes (`home.discoverMixes`, `home.genreMixes`), Community
  playlists (`home.communityPlaylists`, the last cached rows), and New releases and Upcoming
  shows (`home.followCards`). The snapshot doesn't hold a second copy of them.
- **No snapshot** (first start, or after a missing, old-format or corrupt one): each local
  section draws its heading over the room its content takes, empty (`HomeSectionSpace`), until
  its read answers a frame or two later. No error line is written. A Discover mix row whose
  first build is still on the network keeps `DiscoverMixesSkeleton`, because that data isn't
  local.
- **Startup jobs** still start only after the first content Home shows from a read
  (`firstContentShown`) and when no touch is in flight (#1350's scheduler). The snapshot doesn't
  release them early, so they don't compete with Home's first reads.
- **Desktop guard.** `perf/screensFromMemoryGuard.test.ts` now covers Home. Its entry lists each
  hook the first frame draws, and a new `snapshot` kind checks that the hook draws
  `useSnapshotted` and that its query is kept at startup or for the session. A further test
  fails if a Home file draws `HomeSectionSkeleton` or `HomePlaceholders`, or if the snapshot
  stops being read, saved or written on AppState.

## Snapshot format

Stored under the key-value key `home.snapshot` (expo-sqlite kv-store, the same store as
persisted settings). It's JSON:

```json
{ "version": 1, "savedAt": 1763700000000, "page": 1,
  "sections": { "content": {…}, "mostPlayed": {…}, "orbit": […], "fromYourLibrary": […],
                "stats": […], "magicQueue": [[…], […], […]] } }
```

- `content`: Recently added, Recently played, Most played and Favorites (Home's `HomeContent`).
- `mostPlayed`: Most played albums and artists (Stats' all-time top).
- `orbit`: In your orbit's nine songs.
- `fromYourLibrary`: the playlists' rows.
- `stats`: the Stats facts as drawn (label and value).
- `magicQueue`: the carousel's pages; `page` is the page in sight.

**Fallback.** `parseHomeSnapshot` returns none for nothing stored, text that isn't JSON, a
different `version`, or a missing `savedAt`. Each section is checked against the fields Home
draws (`homeSnapshotList`, `homeSnapshotRecord`). A section that fails its check is left out and
waits for its read, while the others still show. A page that isn't a whole number ≥ 0 reads as
none. Reading storage that throws is no snapshot either.

**Size bound.** `HOME_SNAPSHOT_MAX_LENGTH` is 512 K characters. A snapshot over it, or with
nothing in it, isn't kept: the key is removed, and the next cold start opens without one. The
write is the async `Storage.setItem`, so it happens off the JS thread.

## Measured (desktop, Node 24 V8; not the phone)

A synthetic Home, generous for the reference phone's 727-song Library: 20 recently added and 20
recently played albums, 10 most played songs, 10 favorites, 10 top albums, 5 top artists,
9 orbit songs, 20 playlists with four covers each, 6 facts, and 3 × 9 Magic Queue songs, each
row with the client's full fields and phone-length paths.

| What                           | Figure                                           |
| ------------------------------ | ------------------------------------------------ |
| Stored snapshot                | 83,818 characters (82 KB)                        |
| `JSON.parse` of it             | 0.14 ms on desktop                               |
| Parsed snapshot, heap after GC | 96 KB, let go section by section as reads answer |
| Home's kept queries            | 3 more queries (the rows Home already shows)     |

On the phone, Hermes parses more slowly than V8. Expect a few milliseconds for the parse at a
cold start, once. The phone run below confirms it.

Tests run: `pnpm --filter @wave/core test` (Core's `homeSnapshot.test.ts`: round trip, sections
left out, missing, corrupt and old-format snapshots, page checks, the size bound). In the app:
`perf/screensFromMemoryGuard.test.ts`, `home/magicQueueSection.test.ts` (as written and as the
React Compiler builds it: a cold start draws the snapshot's pages before the pool's read
answers), `home/homeOpening.test.ts`, and the perf guards.

## Phone run: pending

On the reference phone, with the `ti` release that carries this change:

1. Open Home, scroll a little, swipe the Magic Queue carousel to page 2, then send Wave to the
   background.
2. Force-stop Wave (`adb shell am force-stop dev.leoperez.wave`), then start it cold.
3. The first frame should show the last Home, on page 2, with covers. No skeleton should show,
   and nothing in sight should move when the reads answer.
4. Tap within a second of Home drawing, then use Wave normally for a few minutes.
5. Run the runner's cold start and Home scenarios on the release before this change and on the
   one with it: `node scripts/perf/perf.ts run --scenario startup,reference-taps,scroll-home`.
   Record both runs here, along with the app log's "Speed since" summary.

Pass when no freeze line follows the cold start, the first tap after it is within budget, Home's
first frame line shows content, and PSS stays under 500 MB.
