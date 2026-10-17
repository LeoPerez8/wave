# #306 First-tap Search: keyboard from one tap, index rebuilt per source

Ticket: #306 (parent #301). Branch `feat/306-first-tap-search`, based on `perf/301-performance` at
c9fa645 (#309 merged).

## What changed

Before, a Search tab tap asked for the field once: `requestSearchFocus` stamped a time, and the
screen's focus effect called `field.focus()` on one `requestAnimationFrame`. The same focus effect
switched the index on. Its build ran on a `setTimeout(0)` in the same window: five synchronous
SQLite reads (songs, albums, artists, genres, playlists), then `createSearchIndex` over every
entry, all in one JavaScript task. `useLoadedLibraryFinder` read every song a second time. The
index followed `libraryVersion + playlistsVersion`, so any scan batch, edit or playlist change
read and rebuilt everything, at most every 3 s, while Search was in focus.

Two things could cost the second tap:

- React Native records a field as focused in JavaScript as soon as `focus()` is called
  (`TextInputState.focusTextInput`). When Android drops that focus (the view isn't in its window
  yet, on a first visit or a tab coming back), every later `focus()` is skipped as "already
  focused", so nothing retries.
- The focus frame and the index build queue on the same thread. A frame that comes after the
  build waits for reading and indexing the whole Library.

Now:

- **Focus** (Core `packages/core/src/searchFocus.ts`, app `apps/mobile/src/search/fieldFocus.ts`).
  `stepSearchFocus` is a small state machine fed with the tap's request, the screen being shown or
  hidden, the field's layout (`onLayout`), the field's own focus and blur events, and animation
  frames. The field is focused on the first frame where the screen is in sight and the field is
  laid out. A focus the field doesn't report within 150 ms is asked again as blur, then focus, so
  React Native's "already focused" guard can't swallow it. That happens at most 3 times. A
  request waits at most 2 s for the screen, and leaving Search cancels it and blurs the field.
  Frames are only requested while a request is pending.
- **Library reads wait for the keyboard.** `useSearchFieldFocus` reports `libraryWanted` once the
  screen is in sight with no focus pending, and the keyboard a focus raised is up
  (`keyboardDidShow`, or 400 ms). Typing switches it on too. Until then Search reads nothing.
- **Sources are #309 shared queries** (`libraryListQueries` in `apps/mobile/src/library/hooks.ts`:
  the Library tabs' own `songs`, `albums`, `artists`, `genres` and `playlists` keys). The index
  follows the change bus through them. A scan or edit (`tracks`) reaches every source. A playlist
  edit or an import batch (`playlists`) reaches the playlists alone. Favorites, plays and folder-only
  changes reach none. While Search is hidden, bursts don't re-read; edits still do, so it never
  comes back finding a removed song. A tab showing the same list shares the read.
- **Index per source, in slices** (Core `packages/core/src/searchCatalog.ts`).
  `createSearchCatalog` prepares each source on its own and puts the index together from every
  source's prepared entries. Rows given again unchanged (the same array) cost nothing, and a
  changed source is prepared again alone. Preparation runs in steps of 250 entries, at most 6 ms
  of steps per JavaScript task (`setTimeout(0)` between tasks), so touches and keystrokes go in
  between. Searches use the last complete index while a source is prepared again. The catalog
  lives in the module, so the index outlives the screen. Once Search stops asking (it leaves, or
  the keyboard goes down with nothing typed), nothing follows the Library, so the catalog is
  marked `unfollowed`: when Search asks again there is no index until every source is read and
  prepared again. Sources read again unchanged (the registry kept them) bring the old index back
  without preparing. Without this, a remount showed the old index while a fresh songs read was
  prepared, finding songs deleted meanwhile (review finding 9). `createSearchIndex` itself is unchanged.
  It is now the catalog's single-source case, and the catalog's results equal it over the
  concatenated sources (tested).
- **No second song read.** The YT Music "already in your Library" finder is the app's shared one
  (`useLoadedLibraryFinder`), now built over the shared `songs` query's rows
  (`apps/mobile/src/ytmusic/finderCache.ts`): one read and one finder for Search, the Songs tab
  and every YT Music list. It used to read every song again per `libraryVersion` bump (each scan
  batch, in or out of sight) while any YT Music list was mounted (review finding 8). Only
  `currentLibraryFinder` (a Discover mix's menu, settled before it opens) still reads the songs
  itself, once per Library version, as rows a screen showed may predate a change. The artist and
  album finders are built from Search's own sources, lazily, on the first YT Music lookup. The
  index no longer waits for them.
- Matching, ranking, grouping, recent searches, the YT Music section and downloads held in place
  are unchanged.

What wasn't changed: the reads are still synchronous SQLite on the JavaScript thread. Each one is
its own task (the #309 registry), but the songs read is one task as long as the Library is big.
Paging it is #310. #304 owns the tab layout. `TabBar` still calls `requestSearchFocus` on every
Search tap, before #304's `useTabSwitches` decides whether to switch. A tap whose switch is
dropped in a rapid burst leaves a request that expires after 2 s if Search never shows. When
#304's retention unmounts Search, the next visit takes the first-visit path. The index survives
in the module, and the registry keeps the sources for 30 s.

## What was measured

### Desktop: index work (JavaScript only, no SQLite)

`node bench/searchCatalog.ts [songs]` from `packages/core` (`pnpm --filter @wave/core
bench:search`). A synthetic Library with one album per 10 songs, one artist per 25, 300 genres and
200 playlists. Node v24.19.0 on the desktop. **Desktop numbers**: Hermes on the phone is several
times slower, and the reads come on top.

50,000 songs (57,501 entries):

| Work                                      | Before #306              | #306                                   |
| ----------------------------------------- | ------------------------ | -------------------------------------- |
| First build                               | 158.9 ms in one task     | 146.7 ms in 230 steps, longest 9.0 ms  |
| A playlist edit or import batch           | 158.9 ms (whole rebuild) | 1.1 ms, the playlists alone            |
| Sources read again unchanged              | 158.9 ms (whole rebuild) | 0.0 ms                                 |
| A song download or edit                   | 158.9 ms (whole rebuild) | 151.3 ms in 200 steps, longest 14.0 ms |
| Typing "love sa" (6 searches, 200 a kind) | same                     | 41.1 ms                                |

12,000 songs (14,181 entries):

| Work                            | Before #306             | #306                                |
| ------------------------------- | ----------------------- | ----------------------------------- |
| First build                     | 43.2 ms in one task     | 46.1 ms in 57 steps, longest 4.2 ms |
| A playlist edit or import batch | 43.2 ms (whole rebuild) | 0.4 ms, the playlists alone         |
| Sources read again unchanged    | 43.2 ms (whole rebuild) | 0.1 ms                              |
| A song download or edit         | 43.2 ms (whole rebuild) | 35.0 ms in 48 steps, longest 4.4 ms |

Before #306, every rebuild also re-read all five sources, so the "before" column leaves out the
reads. Search read the songs twice, once for the index and once for the YT Music finder. Now a
playlist change reads the playlists, and nothing else is read or prepared. The longest step is
above the 6 ms budget when a GC lands in it. A whole step of 250 entries takes well under 1 ms.

### Phone: release runner (pending)

No phone was attached (`adb devices` empty), so nothing was measured on the device. **Pending.**
With a perf build of the branch head and one of c9fa645:

```sh
node scripts/perf/perf.ts run --scenario search-first-tap,search-typing,rapid-tabs \
  --variant idle,import --label 306-before   # APK from c9fa645
node scripts/perf/perf.ts run --scenario search-first-tap,search-typing,rapid-tabs \
  --variant idle,import --label 306-after    # APK from this branch
node scripts/perf/perf.ts compare perf-results/306-before-*.jsonl perf-results/306-after-*.jsonl
```

- `search-first-tap` (existing): tap to `keyboard.show` after a fresh launch. Also look at
  `search.focus` marks in the flush. More than one `focus`/`refocus` per tap means Android dropped
  the first.
- `search-typing` (new): after a Search tap, `input text love`, from the first `search.typed` mark
  to `search.results love` on screen. The `import` variant covers typing while an import fills a
  playlist. Steps record `search` (`entries`, `prepared`, `indexes`). `prepared` should only grow
  by the playlists' size during an import.
- `rapid-tabs` keeps Search out of its cycle (the fixture's `tabs`), so it only checks that the
  change costs other tabs nothing. Rapid taps through Search (the keyboard must not come up after
  the burst has left it) are covered by Core's tests. Checking them on the phone means adding
  Search to a copy of the fixture's `tabs` and reading `keyboard.show` against the last `route`.

The Library's size is the owner's, which the runner records. Without a phone the runner was only
checked on the simulated one (`run --dry-run`, numbers made up, not recorded).

## Behavior kept

- Core tests: `node --test` in `packages/core` (1845 pass). New: `searchFocus.test.ts` (first and
  warm visits, retry bound, cancel on leaving, a late request dropped, rapid taps, nothing when
  already focused or arriving without a tap). `searchCatalog.test.ts` (no index until every source
  is ready, same results and order as one `createSearchIndex`, bounded steps, reuse, a changed
  source alone, the last index while preparing, the newest rows win mid-preparation, empty
  sources, 50,000 songs in short steps). `search.test.ts` unchanged and passing.
- App tests: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test 'src/**/*.test.ts'
'plugins/**/*.test.ts'` in `apps/mobile` (293 pass). The React hooks have no render tests (none
  exist in the app). Their decisions are Core's.
- Runner tests: `node --test scripts/perf/*.test.ts` (79 pass), including the typing step's mark
  anchor and the per-step `search` counters.
- `tsc --noEmit` for `apps/mobile`, `packages/core` and `scripts/perf`.

## Not measured, and negative results

- Device numbers are **pending**: first-tap keyboard latency, typing latency and frames, idle and
  under import, on the owner's Library.
- Not verified on a device: whether Android reports the dropped focus the way the retry assumes
  (no `onFocus`). If it doesn't, the first tap still gets the focus frame after layout, as before,
  but with no index build ahead of it.
- A typing step measures from when JavaScript saw the first key (`search.typed`), not from the key
  press: `input text` sends key events, which the app has no timestamp for. A busy JavaScript
  thread delaying the first key isn't counted.
- The songs read itself (one synchronous query over every track) still blocks the JavaScript
  thread once per change that reaches it. It now comes after the keyboard, and the Songs tab
  shares it.
- Rows prepared for the songs source aren't reused row by row after a re-read (every read gives
  new row objects), so a downloaded song prepares the songs source again, in slices. Diffing rows
  by id could make it incremental if #310's paging needs it.
