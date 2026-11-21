# #1356: online screens open at once with what Wave already knows

Budget: a tap on an online screen (online Search, a YT Music artist, album or playlist page, a
community playlist from Search or Home, Version History) draws its first frame within 50 ms at the
p90 from the native touch, with the tapped item's name and cover (docs/spec.md › Fluidity). What
the network adds comes in place.

## What changed

- **Pages seen this session.** Core's `knownPages` keeps a bounded set of pages, the one used
  longest ago dropped first (Performance rules, 12).
  - YT Music albums and playlists (community playlists included) read whole open again with their
    songs in the first frame and no request, offline too (`ytmusic/knownYtPages.ts`, 12 pages). A
    playlist whose later pages failed or were still coming is read again. Try Again reads anew.
  - YT Music artist answers (`yt_artists`) read or saved this session start the artist page
    `ready` instead of waiting on an asynchronous Library read (`ytmusic/knownYtArtists.ts`, 16
    answers). It covers the YT Music artist page, its Similar artists and About, and the Library
    artist page's Fans might also like and About, which read the same answers. Every read and save
    of an answer passes through it, and an older answer never replaces a newer one.
  - YT Music's answers to the queries Search asked (`search/knownYtSearches.ts`, 24 queries) show
    before the frame is drawn when the query is asked again, with no request. A failed search
    isn't kept.
- **The tapped cover.** `openYtArtist` takes the cover the tile or row drew (Search's artist rows,
  Similar artists). The artist page's head draws it in the first frame in place of the skeleton
  circle, and keeps it as the image's placeholder until the page's own image decodes, so the head
  never blanks. Albums and playlists already opened with their head (`useYtListHead`).
- **Version History** starts its read once the push has settled (`useSettledOnce`), so the first
  frame and Back never wait on it. Its pull on Settings was already asynchronous.

Unchanged on purpose: a found artist page still waits for the Library finder before it draws its
songs, so a downloaded song never shows first as streamed and then swaps (#1258). Its head (name,
cover, the Play and Shuffle placeholder) is drawn in the first frame.

## Desktop

Measured on the desktop only, not on an emulator or phone:

- `pnpm --filter @wave/core test`: 5809 tests pass, `knownPages` among them.
- The app tests near the change (`src/ytmusic`, `src/search`, `src/updates`, `src/perf` guards,
  `untranslatedText.test.ts`) pass, `knownYtPages`, `knownYtArtists`, `openedArtist` and
  `knownYtSearches` among them.
- No timing was taken here: tap-to-first-frame needs the phone's native touch timestamps.

## Phone run: pending

On the reference phone (Xiaomi 25118PC98G, Android 15), set up as #1347's run says, first with the
release before this ticket (the baseline) and then with the one that carries it:

```sh
node scripts/perf/perf.ts run --scenario reference-taps --label 1356-before \
  --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
  --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on that artist's Similar artists row>"
# install the release with #1356, then:
node scripts/perf/perf.ts run --scenario reference-taps --label 1356-after \
  --artist "<same>" --playlist "<same>" --album "<same>" --yt-artist "<same>"
node scripts/perf/perf.ts compare perf-results/1356-before-<time>.jsonl perf-results/1356-after-<time>.jsonl
```

Record here the `yt-artist` push step's first-frame median and p90, and the app log's "Speed
since" line. By hand on the same phone, each opened twice (the second opening is the one this
ticket speeds up), with the app log's push lines noted:

1. A YT Music artist from Search's online results, and one from a Similar artists row: the first
   frame shows the tapped cover and name; the image doesn't blank when the page's own arrives.
2. A YT Music album from Search, and a community playlist from Search and from Home: the second
   opening shows its songs at once, then in airplane mode once more.
3. Search: type a query, let YT Music answer, clear the field and type it again: the results show
   with no loading row.
4. Settings › Version History, then Back at once, with the network slow or off: Back is never held.
