# #1489 Library reads don't block the screen in sight

Ticket #1489, part of #1481. Branch `fix/1489-library-reads`.

## What the held figures are

A line `Read "<name>" held JS N ms` is the sum of the read's slices on the JS thread: the replay's
passes and its mapping steps of 8 ms at most (`replayRead`, `mapInSteps`, `finishReplaySteps`), each
followed by a new task. It is not one block. A block is the separate line `JS blocked N ms on
<route> by <work>`, and that is the figure the 50 ms budget applies to.

- `read playlist entries to link` (owner: 4.6 s, 0 rows) is Core's `playlistEntryLinkSteps`, run in
  steps after each scan (the link state is in memory, so a launch's first scan links again). On the
  emulator it held 1.2 to 1.4 s per scan and logged no block: the owner's figure is the same sum on
  a slower phone.
- `read Home's mix playlist entries` (owner: 186 to 214 ms, 26,731 rows) and `read the Library's
credits` (owner: 190 ms on Settings) are mapping in steps; neither logged a block on the emulator.
- `read Home's plays` and `sum up played albums and artists` (owner: 326 to 348 ms on a playlist
  page) are Home's and Stats' kept queries. Each counted play is a burst that read them again every
  10 s (`keptThrottleMs`) whatever screen was in front, and while the kept play totals are still
  settling (#1349) a sum-up reads the whole play history.

## Cause

The read blocks on the playlist page after a play came from three places:

- Core's registry (`createLibraryQueries`) reads a kept query again on every change that reaches
  it, in sight or not, so it is ready when its screen opens. A play moves Home's and Stats' totals
  by one, and it did that on the page the owner was playing from.
- Normalize Volume's measuring step asked the Library about the whole queue on every queue change
  to find the five songs ahead: `read the songs to measure` held 203 to 274 ms (1,730 to 1,736
  rows) on a 1,700-song playlist, again every 10 s, and logged blocks of 51 to 69 ms.
- The streamed genre worker runs after every play and walks every streamed video still without a
  genre, one Deezer lookup each. Offline every lookup fails, so it walked all of them (2,900 to
  4,000 failures a run), each with a `read streamed songs` that held 24 to 118 ms on the page.

## Change

- A counted play (`{ kind: "plays", burst: true }`, `waitsForSight`) no longer reads kept queries no
  screen in sight shows while Wave is on screen. They keep their result, marked stale.
- A screen showing one that comes into sight reads it first (urgent), from the kept result.
- When Wave goes to the background (`LibraryQueries.away`, fed from `AppState` in
  `sharedQueries.ts`) the waiting queries are read, so Home is up to date when Wave comes back.
- Any other change (a scan, an edit, a sync) still reads kept queries at once, as before.
- Each measuring step asks the Library about the queue 25 songs at a time, from the current song on,
  and stops once it has the five ahead (Core's `nextMeasureCandidates`): a 1,700-song playlist costs
  a read of 26 songs.
- Three failed genre lookups in a row end the streamed genre pass (`FAILURES_ENDING_A_RUN`); the
  next play, or Wave coming back, tries again. A single bad video still lets the pass go on.
- The playlist link is unchanged: it already runs in steps and logs no block.

## Emulator runs

Emulator `emulator-5560` (Android 15, x86_64), the 3,000-song seed (`seed.ts`) plus four short
tones, a debug-signed release APK repacked with each change (`repack-js.sh`). Each run: install,
seed, launch, wait for the link, push the tones and relaunch (a second scan and link), open
Playlists › Archive (1,700 songs) and play its first song, then 60 s on that page. Lines are quoted
from the app log of each run.

**Before** (`main` at the branch point):

```
Read "read playlist entries to link" held JS 1.2 s (0 rows) on /     (no block line near it)
JS blocked 51 ms on /playlists/playlist/1 by Library read replay
Read "read the songs to measure" held JS 203 ms (1,736 rows) on /playlists/playlist/1
Read "read Home's plays" held JS 62 ms (22 rows) on /playlists/playlist/1; Read "sum up played albums and artists" held JS 137 ms (1 row) on /playlists/playlist/1
JS blocked 50 ms on /playlists/playlist/1 by Library read replay
JS blocked 52 ms on /playlists/playlist/1 by Library read replay
Read "read the songs to measure" held JS 236 ms (1,735 rows) on /playlists/playlist/1   (every ~10 s after)
```

**After 1** (plays wait for sight): no `read Home's plays` or `sum up played albums and artists`
on the page after the play. The streamed genre storm still blocked:

```
JS blocked 56 ms on /playlists/playlist/1 by Library read replay
JS blocked 116 ms on /playlists/playlist/1 by Library read replay
```

**After 2** (plus the genre pass ending): 9 lookup failures instead of 2,916. The measuring read
still blocked once:

```
JS blocked 69 ms on /playlists/playlist/1 by Library read replay
Read "read the songs to measure" held JS 274 ms (1,733 rows) on /playlists/playlist/1
```

**After 3** (plus paged measuring, this branch): no `Library read replay` block on the page, and
no `read the songs to measure` line (under the 50 ms budget for a held line). Three lookup
failures, then the pass ends. The link logs no block after either scan:

```
Read "read playlist entries to link" held JS 1.3 s (0 rows) on /; Read "list artist photo lookups" held JS 27 ms (900 rows) on /
JS blocked 56 ms on /playlists/playlist/1 by rendering MiniPlayer
JS blocked 97 ms on /playlists/playlist/1 by Library write: save the queue
Read "read recommendation page" held JS 18 ms (128 rows) on /playlists/playlist/1
```

## Not covered

Blocks on the page that are not reads, so outside this ticket:

- `Playlist suggestions`: 50 to 163 ms each, about 50 s after opening a playlist offline (`0 offers
51262 ms after opening (read 41801 ms, rank 8100 ms)`). Its ranking runs in long steps.
- `Playlist in Library` (172 to 187 ms), `no background work` (169 to 178 ms) and `rendering (tabs)`
  (97 to 118 ms) on opening the page.
- `Library write: save the queue` (97 to 251 ms) on a play from a 1,700-song playlist.
- `rendering MiniPlayer` / `NowPlayingSheet` / `PlayerView` (50 to 77 ms): #1488.
- `Home mix inputs` (59 to 80 ms) and `Home artist graph` (59 ms) run on the page because the
  playlist's suggestions ask for the recommendation snapshot (`recommendationSnapshot`, which opens
  Home's gate), not because of the play. Their reads (`read Home's mix playlist entries` and the
  rest) log no block of their own.

The owner's 4.6 s for the link and 326 to 348 ms for the sum-ups are held figures from a slower
phone with a longer history; a phone run on the `ti` release confirms the block lines there.
