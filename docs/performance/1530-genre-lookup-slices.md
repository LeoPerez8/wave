# #1530 Genre mix artist lookup gives way to taps and stays under the block line

Ticket: #1530 (spec #1528). Branch `feat/1530-genre-lookup-slices`, based on the
`feat/1528-screens-show-at-once` integration branch.

## What the phone logged

The owner's log (Xiaomi 25118PC98G, Wave 0.93.2-ti, 26 to 27 November) has 934
`JS blocked … by Genre mix artist lookup` lines, 50 to 161 ms, about 60 ms on average, on
every screen including a static one (`/settings/version-history`). They come in pairs and
threes about 400 ms apart, which is the spacing between two Deezer requests. So the block
belongs to each request, not to each artist. The log has no `Genre mixes Deezer lookups done`
line, so the lookups were still running whenever Wave stopped.

## The cause

Android unzips Deezer's gzipped answers and drops their `Content-Length`. So the lookup's
data meter (`answerBytes`) counted each body's UTF-8 size itself, with a `for…of` walk that
makes a string for every character. A Deezer album answer is about 40 KB (an artist search is
about 20 KB, and Deezer escapes non-ASCII as `ê`). That walk, not `JSON.parse`, held the
thread:

| 200 KB Deezer-like ASCII body, median of 9 (dev PC, Node 26) | JIT     | `--jitless` (no JIT, as Hermes runs) |
| ------------------------------------------------------------ | ------- | ------------------------------------ |
| Old count (`for…of`)                                         | 5.8 ms  | 32.0 ms                              |
| New count (regex scan)                                       | 0.24 ms | 1.3 ms                               |
| `JSON.parse` of the same body                                | 0.9 ms  | 0.8 ms                               |

On one real 40 KB album answer, `--jitless`: the old count took 10 to 14 ms against 0.2 ms for
`JSON.parse`. The reference phone runs JS several times slower than this PC without a JIT,
which matches the ~60 ms per answer it logged.

## What changed

- **The size count** (`packages/core/src/networkUse.ts`): a plain ASCII body is its length,
  checked by one regex test. Any other body is counted by three regex counts (units up to
  U+07FF, units above it, surrogate pairs). The totals are the same as before, lone surrogates
  included (three bytes, as `TextEncoder` writes them). A Core test checks the totals against
  `TextEncoder`. Another fails when counting a body takes longer than parsing it; it failed on
  the old walk.
- **Answers wait out a tap** (`apps/mobile/src/home/mixArtistGenreLookup.ts`): an answer that
  comes back while a tab switch, push or Now Playing open is in flight waits for the next free
  turn before it's parsed. The scheduler's transition gate holds free turns until the
  transition settles, and requests already waited for one. A test holds the turns as a
  transition does and checks that nothing of the answer is read until they're released.
- **Profiles written less often** (`apps/mobile/src/home/artistGenres.ts`): every write stores
  all the looked-up profiles at once (up to 2,000). The lookup saves one about every 2.5 s, and
  the old 2 s delay wrote the whole set after nearly every artist, in a timer outside any turn.
  It now writes 10 s after the lookup pauses, and at least once a minute while it runs.
  Wave going to the background writes what is waiting at once (`persistedSetting`, as before
  #1530), so an Android kill afterwards loses nothing; `lib/persistedSetting.test.ts` checks
  that a write still inside its delay is made when Wave leaves.

Genre mixes come out the same: the lookup's requests, parsing and profiles haven't changed
(`deezerArtistGenre.test.ts` and the lookup's tests pass unchanged).

## Emulator run (code review of #1539): the lookup didn't run

AVD `wave-run-903` (android-36 x86_64, SwiftShader), perf build of `fix/1528-code-review` at
`1b9227e36` (which has this ticket, as the integration tip does), 28 November. The Library at the
ticket's size: `seed.ts --scale 0.25 --songs 740 --artists 300` (740 songs, 300 artists, 15
playlists), the emulator's network on (`api.deezer.com` answered a ping). Then 16 minutes of
`perf.ts run --scenario tab-switch,push-settings,now-playing,tab-switch,push-settings` (80 tab
switches, 22 pushes and pops; `now-playing` found no mini player, since nothing played).

No `JS blocked … by Genre mix artist lookup` line, but no lookup either: none of the 100 measured steps'
background slices names the job, and Wave logged no Deezer artist request. The genre mixes built
(`Genre mixes build` blocks, 50 to 94 ms) and Deezer's streamed genre lookups answered "no search
results". The lookup queues the artists of YouTube Music songs the Library has no profile of, and the
seed's generated artists gave it none to look up. So this run can't show the 50 ms line or the pause
during a tab switch, push or Now Playing either way; the phone's log answers both.

## Phone run: pending

The phone confirms this from the WaveTiming lines in the owner's next exported log on a `ti`
release that has #1530. The ticket is met when:

- no `JS blocked … by Genre mix artist lookup` line reaches 50 ms;
- genre mixes still fill on Home as before.
