# #1453 Resume downloads and the background fill in slices at startup

Ticket: #1453 (parent #1432). Branch `feat/1453-startup-resume-slices`. On the emulator, #1434
named two blocks in the work two startup registrations leave running: `startup downloads`
181 ms and `startup backgroundFill` 61 ms (`1434-startup-block.md`).

## What held the thread

The block log puts a long task with no slice of its own down to the free turn begun in the
last second (`TURN_WORK_MS`). Both registrations' awaited work ran in that second, unsliced.

- `startup downloads`: the resume has the journal forget the failures that settled since
  (`forgetSettledFailures`) and, once an install, asks again for the songs YouTube's limit failed
  (`requeueThrottledFailures`). Both ask the shared Library finder (`currentLibraryFinder`),
  which is built over the whole Library at its first use: Core's `libraryFinder` over
  3,000 songs, in one task. That's the only step of the resume that grows with the Library.
- `startup backgroundFill`: the fill's first read indexes every unsearched song of every
  playlist (Core's `indexFillPlaylists`) in one task, and each step then built the line of the
  playlist it picked (`nextFillStep`): every song's key, a filter and a sort, to take its head.

## What changed

- The downloads' resume steps each start on a free turn of their own (`downloads resume`), and
  build the finder in slices before using it (`currentLibraryFinderInSlices`), with the
  stepped build the Library's long lists already use (`libraryFinderSteps`).
- The fill indexes what it read in slices (Core's `indexFillPlaylistsSteps`, one song a step),
  named `backgroundFill`.
- `nextFillStep` reads a playlist only up to its first song never failed, and works out no key
  when nothing failed. The order it picks is unchanged (Core's tests).

## Numbers (Node, the Core pieces alone)

Node runs these several times faster than Hermes on the emulator; the ratio is what carries
over. Slices are the app's: 6 ms or 512 steps.

| Piece                                     | Before (one task) | After (longest slice) |
| ----------------------------------------- | ----------------- | --------------------- |
| Library finder, 3,000 songs               | 21.3 ms           | 4.7 ms (6 slices)     |
| Fill index, 3,000 songs in 6 playlists    | 2.1 ms            | 1.3 ms (6 slices)     |
| `nextFillStep`, 3,000 songs, one failed   | 0.20 ms           | under 0.01 ms         |

## Not measured

A cold launch on the emulator or the reference phone: this ticket ran without one. The first
journal read (`jobsChangedSince`) still maps the whole journal in one task; it grows with the
journal, not the Library, and the next launch's `WaveTiming` lines say whether it matters.
