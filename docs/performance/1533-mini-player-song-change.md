# #1533 A song change renders the mini player cheaply

Ticket: #1533 (spec #1528). Branch `feat/1533-mini-player-song-change`, based on the
`feat/1528-screens-show-at-once` integration branch at `61dfbf4ef`.

## What the phone's log shows

The owner's exported log (Xiaomi 25118PC98G, Android 15, Wave 0.93.2-ti), from 26 November
15:32 to 28 November 03:35. It has 98 `JS blocked … by rendering MiniPlayer` lines, median 279.5 ms,
the ticket's 281 ms. Grouped by what was happening:

| When                                      | Blocks | Median | Range      |  Total |
| ----------------------------------------- | -----: | -----: | ---------- | -----: |
| On `/settings/appearance`                 |     55 | 294 ms | 274–433 ms | 16.9 s |
| Within 3 s of a song change (log's cause) |     31 |  58 ms | 51–95 ms   |  2.0 s |
| Anything else                             |     12 |  78 ms | 50–223 ms  |  1.0 s |

So the 281 ms median comes from Settings › Appearance, where the owner changed settings every
1 to 2 seconds (27 November around 02:15). Song changes cost 51 to 95 ms. Around the same song
changes the log also has 81 blocks named `rendering PlayerView`.

## Why the mini player got the blame

`useRenderCost` timed a span from the component's render to its commit's layout effects. Layout
effects run once the whole commit is done, so the span also covered everything React rendered
after the mini player in that commit, and the commit itself. The mini player sits near the start
of what renders:

- On a song change, the closed Now Playing sheet stays mounted and follows the song, so its
  artwork, colours and links are ready when it opens. `NowPlayingSheet` and `PlayerView` render
  after the mini player in the tree, in the same commit, because every `useSyncExternalStore`
  update is synchronous. Their spans start later than the mini player's, so the block log's
  longest span was the mini player's.
- On an Appearance change (theme, accent, motion), every reader of the setting renders again in
  one commit, and again the mini player's span was the longest.

The mini player also rendered all of itself on a song change: its frame, its glass element, both
gesture configurations (`usePanGesture` ran again), its gesture detectors and the Next button.
Only the cover, the two lines, the accessibility label and the play button's label change for a
new song.

## What changed

- **The mini player times only its own render.** `useOwnRenderCost(name)` (`lib/renderCost.tsx`)
  returns an element that the component places last in its output. When that element renders,
  the component's subtree has finished rendering, and that is where the span ends. A render that
  returns before placing it (nothing loaded) ends at the commit, as `useRenderCost` does. A
  block during a song change now names the work that held it, such as `rendering NowPlayingSheet`
  or `rendering PlayerView`. The mini player is named only for its own render.
- **A song change renders only the song's part.** `MiniPlayer` keeps the pill: glass, frame,
  gestures and the held-up wave. It reads only whether a song is loaded. `MiniPlayerSong` renders
  the cover, the title and artist (or why playback stopped), the press that opens Now Playing and
  the play/pause button. A song change, play or pause renders `MiniPlayerSong` alone. `NextButton`
  is the same for every song and stays as it was. Each part has its own name for the block log:
  `MiniPlayer` for the pill and `MiniPlayerSong` for the song's part, which is the span a song
  change reports.
- **Perf builds mark every span.** `render.span` (`"<name> <ms>"`) is marked for each reported
  span. The runner keeps each component's longest span per step as `renderSpansMs`, so a run shows
  the mini player's span on each Next even when no long task named it.

## Guard

`apps/mobile/src/playback/miniPlayerRenders.test.ts` renders the real `MiniPlayer` with its
native and app imports stubbed:

- a song change renders `MiniPlayerSong` once and the cover once. It renders neither `MiniPlayer`,
  its glass, `usePanGesture` nor Next. The new cover, title, artist and play label show.
- play and pause render `MiniPlayerSong` alone;
- a report that changes nothing shown (buffering, then playing again) renders nothing;
- the mini player shows nothing with nothing loaded, appears on the first song and leaves when
  playback stops.

On the code before this change, the first two tests fail. `lib/renderCost.test.ts` checks that an
own span ends where the subtree's render ends. A sibling that renders after it, with a 200 ms
render under a hand-moved clock, isn't counted. A memoized render reports nothing.

## Emulator results: not measured

No emulator run was possible on the PC for this ticket. `emulator -list-avds` is empty, because
`~/.android/avd` holds only `wave-run-903.avd/snapshots`, with no `.ini` or `config.ini`. `df -h /`
showed 7.0 to 7.8 GB free, under the 7.4 GB the AVD's data partition needs plus a build
(`scripts/emulator-apk.sh` asks for 12 GB). The acceptance criterion "a Next, Previous or crossfade
renders the mini player under 50 ms, logged by its `RenderCost`" is **pending**.

The measurement to run once an AVD and space are back: a perf build of the integration tip and of
this branch (`EXPO_PUBLIC_WAVE_PERF=1`), the 3,000-song seed (`scripts/perf/seed.ts`), then
`perf.ts run --scenario skip --label 1533-before|after` (10 Nexts each). Read
`renderSpansMs.MiniPlayerSong` per step, and the app log's `rendering MiniPlayerSong` and
`rendering NowPlayingSheet` / `PlayerView` lines. Previous and crossfade need a hand session with
crossfade on. The phone then confirms it from the WaveTiming lines of the owner's next exported log
on the `ti` release. Expect no `rendering MiniPlayerSong` line on a song change, and the blocks that
remain named after Now Playing.

## Left for later

The closed Now Playing still follows a song change in the same synchronous commit (`rendering
PlayerView`, 81 blocks around song changes in the same window). It is outside this ticket. Letting
the closed sheet follow the new song after the mini player's commit, at a lower priority, would
remove that block too.
