# #715 Library song list and row

Ticket #715, parent #712. Branch `feat/715-library-song-list`, merged with
integration commit `a0bbabd3` (#717, #719, #723, #724, #726). No physical-phone measurements have been collected.

## Change and work budgets

Songs, a genre, Favorites, album and artist pages use `songs/SongList` on Legend
List with recycling. Song rows are one grid row high; disc headers and the artist's
non-song slots keep their existing heights and separate recycle types. Songs and
genres keep #310's bounded page reads, selection prefetch and whole-order actions.

The list follows playing ids, favorite ids and download status once. Selection
stays with the screen's existing single selection hook and reaches the list as a
controlled snapshot. A memoized `SongRow` receives primitive display props and
stable handlers keyed by the row identity. Core computes its text, badges, artwork
choice, state and spoken label. The row has one theme lookup, no store subscription,
and mounts a swipe gesture only when a direction exists and selection is off.
`Press` uses React Native Pressable; it adds no gesture-handler detector.

Structural budgets:

- A song transition renders only the previously and newly playing rows. If several
  ids identify the same recording, only their changed playing flags may render.
- A favorite update renders one affected row per occurrence. Checking a row or
  advancing a download leaves unrelated row props unchanged.
- Render-time swipe planning constructs zero menus. Execution and long press read
  current action metadata and use the existing menu/action paths.
- The presentation cache holds at most 256 rows per list. No full song read is added.
- Spine movement follows the finger on the UI thread. JavaScript receives changed
  target letters and gesture release, rather than every pointer move.

`SongRow` has a perf-build render counter. The desktop model tests use React.memo
with the same primitive props to count two changed rows on a song transition and
one on a favorite update. They also cover stable loading/song keys, recycle types,
selection, missing-download progress and the cache bound. The spine decision tests
cover repeated moves, sparse letter slots and clamped endpoints. These checks do
not measure Android frame time or render counts on the device.

## S24+ scenario and budget

Use paired perf APKs with the same 12,000-song fixture, Android version, 120 Hz,
compiler filter and import state. Keep the same album, artist and favorites.

```sh
node scripts/perf/perf.ts run --scenario scroll-songs,push-tracklist,push-artist --variant idle,import --label 715-before
node scripts/perf/perf.ts run --scenario scroll-songs,push-tracklist,push-artist --variant idle,import --label 715-after
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

The frame deadline is 8.33 ms at 120 Hz. Dropped-frame rate and tap-to-first-frame
must not regress against the paired baseline. Apply #713's measured scenario
budgets once available. On each of the five screens, leave several rows visible,
advance between them, star a visible song, and inspect the SongRow counter deltas
without scrolling. Then scrub the spine and check that list jumps and the letter
plate still follow the finger. Record the APK/source hashes and results-file path.

## Before (a0bbabd3)

Pending the owner's S24+ run. No numbers are inferred from desktop tests.

## After (this branch)

Pending the owner's S24+ run. Record the comparison output and warnings here.

## Behavior and unverified work

Manually compare the five screens for layout, artwork and play disc, disc/track
numbers, Popular ranks, playing wave/title, favorites, explicit/download badges,
missing-song dimming/progress, find, paging, spine, swipe, long press, selection,
Select All and TalkBack speech. Include Library/Online album and artist views,
multi-disc albums, empty lists and a download finishing while selecting.

Phone, Hermes, gestures and TalkBack remain unverified under the implementer brief.
No native code or dependencies changed. #716 owns other lists and actual playlist/
Queue drag adoption; `decorateRow` allows it to wrap the shared row. Non-Library
callers retain TrackRow temporarily after deletion of the old swipe wrappers.
