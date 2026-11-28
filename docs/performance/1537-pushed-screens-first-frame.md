# #1537 A pushed screen and Now Playing draw their first frame within budget

Ticket #1537, part of spec #1528. Branch `feat/1537-pushed-screens-first-frame`, based on
`feat/1528-screens-show-at-once`. #1355 and #1380 are the prior art.

**No emulator or phone number is in this doc yet.** See "Emulator run: not run" below. The
budgets are the ticket's: a push to an album, an artist, a playlist and Settings draws its first
frame within 100 ms, and Now Playing opens within 50 ms of response and first frame, as WaveTiming
logs them.

## The phone's numbers before (owner's log, 26 to 28 November)

Xiaomi 25118PC98G, Android 15, Wave 0.93.2-ti, from the spec's table:

| Step             | Response | First frame (median / p90) | Settled (median) |
| ---------------- | -------- | -------------------------- | ---------------- |
| Push             | 313 ms   | 353 / 584 ms               | 860 ms           |
| Now Playing open | 104 ms   | 172 / 286 ms               | 780 ms           |

The log gives pushes as one kind, not per screen. Per-screen numbers come from the emulator run
below, or from the phone's `WaveTiming` lines by their `to` route.

## What each screen drew before its first frame

A push's response is its screen's first commit (`useScreenContent`'s layout effect) and its first
frame the frame after it. The album, artist and playlist pages read their content from memory
(#1352), so that first commit is the whole page:

- **The page's head**: the cover at the window's width, the title, the line, Play and Shuffle, and
  for an artist the stats block and shows.
- **A screen and more of song rows.** Each page is a `SongList` (Legend List). On the new
  architecture Legend List starts at a size of 0, measures itself in a layout effect, and renders
  every row within the window and its 250 dp draw distance in that same commit, before the first
  paint: about 19 rows on an 800 dp window, of which 3 or 4 show under the head. A song row took
  about 15 ms on the emulator (`SONG_PREVIEW_PER_FRAME`'s note, #1440), so these rows were most of
  the first frame.

Settings already mounts its rows staged (#1355) and fits one screen, so its first frame is its
rows; nothing in it is out of sight in that frame. It is unchanged here.

Now Playing stays mounted below the screen and a tap only starts its spring (#305), so its open
commits little. Its first frame was stamped two frames after the sheet's commit: the commit's
layout effect waited a frame, then `timingSurfaceCommitted` waited another before it stamped the
frame. A pushed screen's is stamped on the frame after its commit.

## What changed

- **A pushed list gets four rows a frame** (`songs/stagedRows.ts`, `SongList`'s `stagedRows`).
  The album's, the artist's (page and Songs screen) and the playlist's `SongList` are given four
  rows in their first frame, under the head, then four more a frame until the window and the draw
  distance under it are full, then the rest, which Legend List leaves unmounted below the screen
  (Core's `listMounts`, as Up Next's rows mount, #1488). On an 800 dp window that is 4, 8, 12, 16,
  then all: whole by the fifth frame, about 80 ms, during the push's slide. Rows read after the
  head (a screen opened from a list that knows the album) are staged the same way.
- **No jump.** Rows have fixed heights and are added below those drawn, so nothing drawn moves; a
  list that grows (YouTube Music's songs joining an album) keeps every row it had, and one that
  shrinks shrinks at once. The footer (skeletons, the YouTube Music line) waits for the last row,
  so it never shows mid-list. A playlist's suggestions are its last item and come with it.
- **Back** returns to the screen under the push, which stays mounted; nothing under it is
  re-mounted or re-staged.
- **Now Playing's first frame is measured by the push's rule** (`nowPlaying/sheet.ts`,
  `nowPlayingContentCommitted`). This is a measurement fix, not a speed-up: the sheet draws
  exactly as before. The old rule stamped Now Playing's response and first frame a frame after
  the sheet's commit, and its first frame a frame after that, so its first frame read two frames
  after the commit. The new rule is the one pushes use (`timingScreenCommitted`): the response at
  the commit, the first frame on the next frame. So a Now Playing open now reads about one frame
  (16 ms at 60 Hz) less than before for the same drawing, and its numbers compare with a push's.
  Its content is still reported drawn a frame later, and settled only once the spring has
  finished too.
- **Guards.** `songs/stagedRows.test.ts` (four rows, then a screen, then all; a short list whole
  at once; rows read late staged; a list that grows takes no row back) and
  `nowPlaying/sheetTiming.test.ts` (an open's first frame is the frame after the commit).
  `perf/performanceGuards.test.ts` fails if the three lists stop staging.

## Desktop checks

Run on the PC (Linux) at this branch's head.

| Check                                                                      | Result                                        |
| -------------------------------------------------------------------------- | --------------------------------------------- |
| `pnpm --filter @wave/core test`                                            | 6,660 pass; 3 speed budgets over at load ~115 |
| `songs/*`, `nowPlaying/*`, `lib/stagedCount`, `performance/nowPlayingOpen` | 132 pass                                      |
| `perf/performanceGuards.test.ts`, `perf/memoDependencies.test.ts`          | 17 pass                                       |
| `tsc --noEmit` in Core, the client and `apps/mobile`                       | pass                                          |
| `scripts/check-guards.sh`                                                  | pass                                          |

Core's three over budget are its search on 50,000 songs and a big playlist's download decision,
timed while seven tickets built and tested at once on the PC; this branch doesn't touch Core.

## Emulator results (code review of #1539)

AVD `wave-run-903` (android-36 x86_64, SwiftShader), the reference seed (3,000 songs), network
off, perf builds (`EXPO_PUBLIC_WAVE_PERF=1`), 28 November. "Before" is the integration tip
`b079ddac7`, which already has this ticket; "after" is `fix/1528-code-review` at `1b9227e36`,
which adds #1534's route reads (see `1534-tab-switch-renders.md`). No build of the tip before this
ticket fit the disk, so this ticket's own before is still the phone's table above. First frames are
WaveTiming's, per screen.

Pushes repeated after a warm-up (Settings, the artist and the playlist by `perf.ts run`'s
`push-settings`, `push-artist`, `push-playlist`; the album "Amber Bridges" by tapping it from
Albums and going back), 11 pushes each (10 for Settings), one session per build:

| Screen   | Before median / p90 | After median / p90 | Budget |
| -------- | ------------------- | ------------------ | ------ |
| Album    | 121 / 167 ms        | 120 / 181 ms       | 100 ms |
| Artist   | 155 / 167 ms        | 151 / 175 ms       | 100 ms |
| Playlist | 185 / 231 ms        | 187 / 273 ms       | 100 ms |
| Settings | 126 / 143 ms        | 103 / 146 ms       | 100 ms |

The first push to each screen after a launch (`emulator-check`'s reference taps, one each, so
noisy): album 437 → 288 ms, artist 526 → 267 ms, Settings 206 → 143 ms, Version History
262 → 65 ms, Albums 478 → 243 ms, Artists 323 → 443 ms. A push is the first route the tabs
navigator sees with those segments, so before #1534's fix it read every tab's route again; later
pushes to the same screen didn't, which is why the repeated pushes barely moved.

Now Playing open (`now-playing`, 10 opens per build): before median 78 / p90 88 ms, after 81 /
84 ms, against 50 ms. Both builds measure by the push's rule above. Nothing in JS is left to
defer before its first frame on the emulator: the 20 opens had no long task, the sheet rendered
3 to 14 ms (`NowPlayingSheet`) and the player 1 to 5 ms (`PlayerView`), and the response came
3 to 20 ms after the tap. The first frame waits on the render thread: its issue time averaged 56
to 88 ms a frame during each open (p90 87 to 137 ms), SwiftShader drawing the sheet's glass and
motion. So no change here; the phone's log decides the 50 ms.

Every push is still over its 100 ms on this AVD, which draws in software (every moving frame
takes 60 to 100 ms, `1536-slide-after-first-frame.md`). The phone confirms these from the
`WaveTiming` lines of the owner's next exported log on the `ti` release.
