# #716 The song list everywhere else

Ticket #716, parent #712. Branch `feat/716-song-list-everywhere`, built on #715's
`songs/SongList` and `SongRow` at integration commit `af98cb40`. No physical-phone
measurements have been collected.

## Change and work budgets

Every song list left on `TrackRow` now renders through the song list, or, for a
capped preview, through the same rows without virtualisation:

- `SongList`: YT Music albums, playlists and mixes (`YtSongList`), the YT Music
  artist page, Search's song results (Library hits gain their star), Stats' See all
  › Top songs, Listening History and playlists.
- `SongPreview` (`songs/SongList.tsx`): Stats' top songs, Home's Most played and
  Favorites shelves, the artist's Most played. It shares the list's renderer
  (`songs/useSongRows.tsx`) and subscriptions; it is not virtualised because these
  previews are capped.
- `useSongRows` alone: a playlist's recommended songs (five bounded slots beside
  their Add and Dismiss buttons).
- `SongRow` with the list model directly: the Queue's History and Up Next rows,
  which keep their own Legend List (sticky bar, remove button, drag).

`TrackRow`, `YtSongRow`, `SwipeYtSongRow`, `RankedYtSongRow`, `DiscoverSongRow`,
`UnsearchedSongRow`, `UnavailableSongRow`, Search's song `Hit`, `PlaylistItem`'s
song cases, the history row and the per-row swipe hooks (`useSongSwipe`,
`useUnsearchedSwipe`, `useYtSongSwipe`, `useUnavailableSwipe`,
`useLibrarySongSwipes`) are deleted. Settings › Downloads keeps its own rows.

The list follows playing ids, favorites, pending YT favorites, downloads, swipe
settings, the route, YT Music and the session's refused streams once; no row
subscribes to a whole set. Rows of unchanged inputs keep their React element, so
React skips them (and a memoized drag wrapper) entirely. YT Music lists key rows
by song id plus an occurrence counter for real duplicates (`occurrenceKeys`), not
by index. Ranked streams (Stats, Home's Most played) stay dimmed with taps ignored
while they can't play, read at press time.

Playlists move from the hand-made window in a `ScrollView` to the recycled song
list. The drag is the Queue's UI-thread drag, now shared as `catalog/rowDrag.ts`
(`useRowDrag`, `useDraggedRow`): the finger, the gap, the rows stepping aside and
auto-scroll run on the UI thread, and JavaScript hears the drag start, each drop
target change (one haptic) and the drop. The lifted row is a copy drawn over the
list on `fill`, with its grip; the move is saved on release. Recommendations are a
list slot that keeps its place (Legend List's `maintainVisibleContentPosition`,
anchored on that slot) while rows are added above it and it is in sight.

The Queue's rows are `SongRow`s and its list now recycles. An Up Next row hears
only whether it can move up or down, so an add or remove re-renders the last row
rather than every row (the old `count` prop).

Structural budgets:

- A song change renders only the rows whose playing flag flipped; a star renders
  that song's rows. Same for Search, YT Music, playlist, Stats and Home rows.
- No row-level subscription to playing ids, favorites, downloads or refused streams.
- Playlist drag: one JS call per drag start, per drop-target change and per drop;
  none per pointer move or auto-scroll frame. Perf counters `js:playlist.start`,
  `js:playlist.target`, `js:playlist.end` (the Queue keeps `js:upNext.*`).
- Up Next add or remove: one `UpNextRow` render (the old last row), plus the rows
  whose entry changed.

Desktop tests: `songs/songRowState.test.ts` (each source's playing id, star and
download job; explicit history state; gated streams; occurrence keys),
`songs/songListModel.test.ts` (list keys, Queue row layout and spoken label) and
`library/historyArtwork.test.ts` (history covers through the row). They do not
measure Android frames or device render counts.

## S24+ scenario and budget

Use paired perf APKs with the same 12,000-song fixture, Android version, 120 Hz,
compiler filter and import state. Set `playlist` in `scripts/perf/fixture.json`
(or pass `--playlist`) to a playlist of a few hundred entries, the same for both runs.

```sh
node scripts/perf/perf.ts run --scenario push-playlist,queue,queue-drag,skip,search-typing,push-artist --label 716-before
node scripts/perf/perf.ts run --scenario push-playlist,queue,queue-drag,skip,search-typing,push-artist --label 716-after
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

The frame deadline is 8.33 ms at 120 Hz. Dropped-frame rate and tap-to-first-frame
must not regress against the paired baseline; apply #713's measured budgets once
available. `push-playlist` should improve on a long playlist (recycled rows, no
window re-render while scrolling); `queue-drag` must not regress. There is no
playlist-drag scenario: drag a playlist row by hand across an auto-scroll and read
the `js:playlist.*` counters (one start and end per drag, targets only on index
changes). Skip a song with Search, a YT Music album, a playlist and Stats open and
check that `SongRow` renders only the two changed rows. Record APK/source hashes
and the results-file path.

## Before (af98cb40)

Pending the owner's S24+ run. No numbers are inferred from desktop tests.

## After (this branch)

Pending the owner's S24+ run. Record the comparison output and warnings here.

## Behavior and unverified work

Compare by hand against today's build: YT Music album (numbered), playlist (find,
pages filling in), mix and artist page; Search's song results (star now shown);
Stats ranks, plays and dimmed streams, See all; Home's Most played and Favorites;
artist Most played; Listening History (time, dimmed removed songs, covers, missing
downloads); playlists (grip, lifted row on `fill`, auto-scroll, save on release,
Move up/down for TalkBack, swipe-to-remove sliding out, unsearched and unavailable
entries, selection with unavailable entries inert, Find, recommendations staying
put on Add); the Queue (History fade, remove, drag, sticky bar, TalkBack actions
and hints). Known difference: Search's Library hits show their star (the ticket asks
for it). A playlist's lifted row rides over the head as before; only the Queue's stays
below Up Next's first slot. Phone, Hermes, gestures and TalkBack remain unverified.
No native code or dependencies changed.
