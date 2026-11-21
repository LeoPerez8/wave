# #1351 Home's mixes read in batches and build only while Home is in sight

## What changed

- **One read a source.** Home's mix build (the recommendation snapshot's Library and catalog
  parts, the cold build's Library, the known videos, the Magic Queue carousel's playlist seeds)
  read each source in 128- or 512-row pages, and matched each radio song to the Library with its
  own read. Each source is now one read off the JS thread (#1348), whatever the Library's size:
  `mixSongs`, `mixArtists`, `mixPlayTotals`, `mixPlayedRecordingKeys`, `mixCredits`,
  `mixStreamedPlays`, `mixCreditNames`, `mixStreamed`, `mixPlaylisted`, `mixCatalog`,
  `graphRadios`, `knownVideos` (one statement a source, where it ran one statement a page inside a
  single read), `playlistEntryVideoIds` and `matchingSongs` (all of a build's radio songs, one
  statement over their titles). The page readers stay for the taste derivation and the desktop.
- **The history walk is summed by SQLite.** The mix inputs walked every play event in JS to add
  up each song's counted plays; `mixPlayTotals` groups them in SQL with the same filter (counted,
  started by the build's time, a Library song), and `mixPlayedRecordingKeys` gives the recording
  keys the walk collected.
- **Same picks, same order.** Each whole reader is its page reader without the cursor's limit, so
  rows come in the same order. On the 1,000-song fixture with streamed plays, playlist entries,
  catalog songs, a future play and radio songs that match and don't, the mix inputs, the catalog,
  the cold build's Library and its radio matches and the known videos serialise byte for byte the
  same before and after.
- **Home only.** `home/homeWork.ts` is a gate on Home's sight (`useScreenSight` of the Home
  screen: focused, Now Playing not over it, Wave in front). Home's mix builds and re-ranks
  (`discoverMixes.ts`, `artistMixPools.ts`, `similarArtists.ts`), the snapshot reads they start
  (`homeRecommendationSnapshot`), the carousel's seeds and the community playlists' refresh take
  each turn through it, after the
  frame or free turn they already waited for. Off Home, the read or slice under way finishes and
  the next waits until Home is back. Whoever waits for the snapshot off Home (a Magic Queue, DJ, a
  playlist's suggestions, through `recommendationSnapshot`) opens the gate while they wait, so
  their work never stalls behind it.

## Measured (desktop, Node 24 with sql.js)

`apps/mobile/src/library/databaseTests/homeMixReads.test.ts` counts the store reads of one Home
build: the mix inputs, the catalog, a cold build's Library and its radio matches, the known videos
and the carousel's playlist seeds, on the fast-again fixture with streamed plays, YT Music
playlist entries and catalog songs a tenth of the Library each, and radio songs as many.

| Library | Reads before | Reads after | Statements after |
| --- | --- | --- | --- |
| 1,000 songs, 10,000 plays | 250 | 20 | 37 |
| 12,000 songs, 54,000 plays | 2,133 | 20 | 37 |

Before, by read at 1,000 songs: `mixHistoryPage` 80, `matchingSong` 100, `mixSongsPage` 18,
`knownVideosPage` 16, `mixCreditPage` 9, `mixCreditNamesPage` 9, `mixArtistsPage` 4, the
catalog's pages 4, the streamed and playlist pages 5, the playlist seed ids 2, and 3 others. At
12,000: 423 history pages, 190 song pages and 1,200 song matches among them.

The second test runs the real mix-input read with Home leaving sight after its third read: at
most the read under way finishes while Home is out of sight, and the build ends with the same
songs, plays and seed artists once Home is back. `home/homeWork.test.ts` covers the gate: closed
before Home is first shown, a stepped build stops after its slice and resumes, a wait off Home
opens it, an unmounted Home closes it.

A whole read hands all of a source's rows to JS at once. On the 727-song reference Library that is
the size `list songs` already reads for the Library's screens; the `Read "…" held JS` line will
show what it costs on the phone.

## What this doesn't cover

- The artist graph's own pages (`read a graph similar page`, `read a graph play page`) aren't in
  the ticket's labels and still page; the graph now takes Home's turns, so it doesn't read off Home
  unless something off Home waits for it.
- A radio request already sent finishes off Home; the steps after it wait.
- In your orbit, From your library and the carousel's pages are shared Library queries, which
  already pause out of sight (#722), with a few bounded reads each. New releases are checked by
  `useHomeFollow`, which already stops when Home leaves sight, and by the daily background task,
  which runs with Wave in the background by design; they stay outside the gate.
- Home's first frame and its snapshot are #1353's.

## Phone run: pending

On the reference phone (Xiaomi 25118PC98G, Android 15), first with the `ti` release before this
ticket and then with the one that carries it, YouTube Music on and the 727-song Library:

```sh
node scripts/perf/perf.ts run --scenario reference-taps --label 1351-<before|after> \
  --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
  --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on that artist's Similar artists row>"
node scripts/perf/perf.ts summary perf-results/1351-<before|after>-<time>.jsonl
```

Then pull a mix to refresh on Home, open Settings and Search while it builds, use the app for a
few minutes, and pull the app log. Record here, for each run:

- the count and total time of the `Read "…" held JS` lines for "read a mix song page", "read
  matching song", "read a page of the videos the owner knows", "read a mix playlist page" and
  "read a mix streamed plays page" (expected after: none), and of the new "read Home's mix …" and
  "read matching songs" lines (a few per build);
- whether any of them appears on a route other than `/` (expected after: none, beyond one read
  under way when Home was left);
- each slow tap's line, checking none names a mix read;
- the "Speed since" line.
