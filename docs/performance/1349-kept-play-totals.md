# #1349 Play totals kept up to date instead of summed on every read

Ticket: #1349 (parent #1346). Branch `feat/1349-kept-play-totals`, based on `feat/1346-instant`.

## What changed

Before, every read of a play total summed the history. "Sum up played albums and artists" and
"sum up played artists" grouped every counted play in the window. They also resolved every
streamed song's credits against the whole Library, reading every artist, album and credit to
build Core's resolver. Home's plays did the same for Recently played. Release listening scanned the
plays for recording keys, since there's no index on them, and From your library grouped every
playlist play. On the reference phone that held JS for 14.5 s over 21 reads, up to 909 ms per read.

After:

- **Migration `0069_kept_play_totals`** (`packages/client/src/db/keptTotalsMigration.ts`) keeps
  each song's counted plays, their time and their latest counted start, summed per UTC day and per
  32-day block (Core's `playBuckets`). It keeps the same per album, artist, song and Stats credit
  row the plays count for (`credited_buckets`), per recording key (`played_recordings`), and per
  playlist (`playlist_play_buckets`). Triggers on `play_events` keep them as each play is written.
  An insert or a play that grows (listened longer, counted now) adds to its day and block; any
  other change sums that day and block again from its song's plays. Every writer is covered with
  no change: the player, crossfade, a BlackPlayer import, a sync pull, `deleteTracks`.
- **Credits.** What a song's plays count for (`play_credits`) is written by the app, since a
  streamed song's credits are Core's (`streamedCredits`). A Library song's credits follow
  `creditedPlayTotals`. A streamed song the Library has (`streamedTrack`) takes that song's. Any
  other streamed song is resolved as today, knowing every streamed song's release id. Triggers on
  the Library's tables mark the songs a change may re-credit as owed. A change to what Core matches
  against (artists, albums, credits) marks every streamed song the Library hasn't, and bumps a
  generation that rebuilds the cached resolver once. A play's own write credits its song when that
  needs no whole-Library read (`creditPlayedSongs` in `recordPlay`). Otherwise the startup job does.
- **Reads.** Core's `keptTotalsPlan` splits a window into whole 32-day blocks, whole days and the
  plays of its two partial days. A read sums those rows, plus the partial days' plays through
  `play_events_started_at_idx`. It never scans the history (the tests check every plan). These read
  the kept totals: `playedEntityTotals` (Stats, Recap, mixes), `playedArtistTotals` (In your orbit,
  Follow suggestions), `songPlayTotals` (the Magic Queue carousel's most listened recently,
  Discoveries, Stats), `creditedPlayTotals`, Home's plays (each streamed song's Library song and
  album from the kept credits, so no resolver), release listening and the playlists' plays.
- **Until they settle, readers sum as before.** While anything is owed (`keptTotalsSettled`),
  every reader takes today's sum (`summedPlayedTotals`, `summedSongPlayTotals`,
  `summedCreditedPlayTotals`). So a read is never wrong, only slower until the job catches up.
- **Upgrade.** The migration notes only the last play's id. After the first screen settles, the
  `keptPlayTotals` startup job (`apps/mobile/src/library/keptPlayTotals.ts`) works through the
  history one store step per settled turn: seeding 1,000 plays, or summing or crediting 16 songs.
  After that it runs again whenever a Library change leaves something owed.
- **An online album's or artist's details** come from the latest played song crediting it, as
  Home's Recently played already said. Today's sum was inconsistent here: all time took the
  latest written song, a window the highest video id. Counts, time and ids are unchanged. One
  rule changes on purpose: a streamed song without a release id takes the id of another streamed
  song of the same album from any time, not only from the same window, so an online album has one
  id in every window.

## Desktop measurements

`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/keptPlayTotals.ts`
uses #579's fixture plus 6,000 streamed plays (300 videos over the same 90 days, a third of them
crediting a Library artist). It checks that the kept totals equal today's sum, then prints median
times: before (today's sum, or the reader with the totals unsettled) → after (kept). These are
desktop numbers, Node with sql.js (SQLite in WebAssembly), on a machine shared with other builds
at commit fcaa3eae0. They are not phone numbers.

| Read                                                | 1,000 songs, 16,000 plays | 12,000 songs, 60,000 plays |
| --------------------------------------------------- | ------------------------- | -------------------------- |
| sum up played albums and artists, Stats week        | 18.1 → 5.2 ms             | 88.3 → 40.0 ms             |
| … Stats month                                       | 22.9 → 7.8 ms             | 112.3 → 52.8 ms            |
| … Stats year                                        | 31.7 → 7.1 ms             | 142.7 → 50.9 ms            |
| … Stats all time                                    | 16.0 → 7.2 ms             | 94.6 → 48.6 ms             |
| … In your orbit (14 days)                           | 18.9 → 5.9 ms             | 107.3 → 48.3 ms            |
| … Follow suggestions (90 days)                      | 32.4 → 7.4 ms             | 142.7 → 53.0 ms            |
| sum up played artists, In your orbit                | 16.7 → 2.5 ms             | 80.4 → 19.4 ms             |
| sum up song plays, most listened recently (14 days) | 8.5 → 6.7 ms              | 40.9 → 47.4 ms             |
| sum up album and artist plays, all time             | 3.3 → 2.5 ms              | 51.0 → 21.3 ms             |
| read Home's plays                                   | 8.1 → 4.2 ms              | 46.6 → 9.4 ms              |
| count the playlists' plays (From your library)      | 0.9 → 0.3 ms              | 0.9 → 0.4 ms               |
| read release listening                              | 2.4 → 0.3 ms              | 8.6 → 0.7 ms               |

The kept sums are a small part of what's left. On the 1,000-song fixture the week's artist and
album sums take 0.5 and 0.8 ms; the rest is the Library rows a ranking shows (`selectArtists` and
`selectAlbums` for the played ids, 1.3 to 1.8 ms each), which today's sum reads too. Song totals
gain little: a 14-day window already summed few plays, and the result lists every played song.

What the kept totals cost:

- A Library play as the player writes it (start, progress, end): 2.4 to 2.7 ms in all, triggers
  and in-write credit included.
- Settling a whole history from scratch: 82 steps at 1,000 songs, median 6.9 ms, longest 27.3 ms.
  769 steps at 12,000 songs, median 6.7 ms, longest 73.9 ms. The longest step builds Core's
  resolver, a whole-Library read that happens once per Library change (Performance rule 6). Today
  every read of these totals paid that cost.

## Phone run: pending

None of this has run on the reference phone (Xiaomi 25118PC98G, Android 15). The 5 ms per read
criterion is the phone's and is still open. With the `ti` release that carries #1349, after an
upgrade from one without it:

1. Open Wave and leave it on Home until the startup work settles, a minute at most. The
   `keptPlayTotals` job sums the history in that time.
2. Use it as usual for a few minutes: play songs (a Library one and a streamed one), open Home, In
   your orbit and the carousel, then Stats and its week, month, year and all-time periods.
3. Run the reference taps and the summary:

   ```sh
   node scripts/perf/perf.ts run --scenario reference-taps --label 1349-after \
     --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
     --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on that artist's Similar artists row>"
   node scripts/perf/perf.ts summary perf-results/1349-after-<time>.jsonl
   ```

4. Copy the app log (Settings › App log). Record here the read lines for "sum up played albums and
   artists", "sum up played artists", "sum up song plays", "sum up album and artist plays", "read
   Home's plays", "read release listening", "count the playlists' plays" and "settle the kept play
   totals": each label's count and longest time. Set them against the 0.74.0-ti log in the spec
   (Fluidity): 14.5 s over 21 reads, up to 909 ms, and Home's plays up to 589 ms. Each of those
   reads should stay under 5 ms. A "Kept play totals didn't settle" warning means the job failed.
