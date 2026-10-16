# #318 Release verification: the whole #301 pass against the original baseline, on the S24+

Ticket: #318 (parent #301). Branch `feat/318-release-verification`, based on `perf/301-performance`
at ca8ec0a.

**Nothing in this doc is a measurement.** The S24+ wasn't attached when it was written (`adb
devices` listed none on 2026-10-16). Every result cell says **pending**. The doc is the plan for
one sitting with the phone: the builds, the commands in order, what each acceptance criterion reads
from the results, the manual checks, and the decisions the numbers settle. Fill in the tables as
the runs come in, and copy every kept results file to `docs/performance/results/`.

This ticket added two scenarios to the runner for the memory-growth criterion (`soak-routes`,
`soak-player`, below and in the [README](README.md)). Nothing else in the app changed.

## Builds

Same package, version (0.5.3) and signature for every APK, so each installs over the last with
`adb install -r` and keeps the Library.

| Id  | What                                                                     | Commit                                        | Kind                          | Answers                                                                                        |
| --- | ------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| B0  | **Original baseline**: Wave 0.5.3 as released, main before the effort    | 66f0290 (`v0.5.3`; holds the audit's 6f32163) | plain release (CI)            | frames, cold and warm launch, retained memory: the numbers the owner's stalls were reported on |
| B1  | Instrumented baseline: #302's runner marks, no app optimization but #307 | 761375e (merge of #302)                       | perf build                    | latencies, render counts, long tasks, JS heap of the old app                                   |
| B2a | Combined pass, no app-specific ART profiles yet                          | `perf/301-performance` head                   | perf build                    | #317's "before"; a check that B2 differs from it only by the profiles                          |
| U   | Unminified release of the head, for profile generation (#317)            | `perf/301-performance` head                   | plain, R8 off                 | `perf.ts profile generate` only; never measured                                                |
| B2  | **Combined pass**, with the generated profiles committed                 | head + `apps/mobile/profiles/`                | perf build                    | latencies, renders, queries, listeners, glass probes, soak counters                            |
| B3  | **The ti release APK** of the combined pass                              | same commit as B2                             | plain release                 | the B0 comparison like for like: what the owner will install                                   |
| S0  | Stall build before #313                                                  | d2997e2                                       | perf, `STALL_MS=1500`         | scrub and Queue drag with JavaScript blocked, before                                           |
| S1  | Stall build of the combined pass                                         | same commit as B2                             | perf, `STALL_MS=1500`         | the same, after                                                                                |
| C   | React Compiler on                                                        | same commit as B2                             | perf, `WAVE_REACT_COMPILER=1` | open decision 1                                                                                |
| T\* | Hidden-tab choices: `keep-layout`, `attach`, `freeze`, then `retain=3`   | same commit as B2                             | perf, `EXPO_PUBLIC_WAVE_TABS` | open decision 2                                                                                |
| N0  | Now Playing, old spring order (trace marks in place)                     | 0ca3fd5                                       | perf build                    | open decision 5                                                                                |
| N1  | Now Playing, spring first, no other #305 change                          | 9c5291e                                       | perf build                    | open decision 5                                                                                |

Notes on the list:

- **B0 is the baseline the ticket means.** It's a plain build, so it gives frames (gfxinfo), launch
  times and memory, but no latencies. Latencies from the touch need the perf instrumentation, which
  only exists from 761375e on. B1 is the earliest build with it. It already contains #307 (merged
  before #302), which only changes Core's import planner, so B1's `import` variant is not the
  original import cost. B0's frames during the import are.
- **B1 lacks marks later tickets added**: `tab.commit`, `tab.layout`, `tab.settled` (#304),
  `songs.rows` (#310), `artist.stats` (#311), `queue.synced` (#314), the sheet phases (#305),
  `search.typed`/`search.results` (#306), `startup.content` (#315), the glass probe (#316) and the
  listener, query, playlist and background-work counters. On B1 those steps record their response
  as missing. Compare them by `burstMs`, `settleMs`, frames and frame parts, not by `responseMs`.
- **B3 should be the real ti release** once `perf/301-performance` reaches `ti` (push the
  `v<version>-ti` tag by hand, see the release notes). Until then a local plain release build of
  B2's commit stands in. Record which in the run's `--meta build=`.
- Build B2a, U, B2, S1, C and T\* from the same checkout, one Gradle build at a time. Between perf,
  plain and env-switched builds, delete `apps/mobile/android/app/build/generated/assets/react` and
  Metro's cache (README, "Building a perf build").

Commands (from `apps/mobile/android`, after the usual prebuild and `local.properties`; `$HEAD` is
the short commit):

```sh
# B0: download the release itself, not a rebuild.
gh release download v0.5.3 --repo LeoPerez8/wave -p wave-0.5.3.apk -D /tmp/wave-318
mv /tmp/wave-318/wave-0.5.3.apk /tmp/wave-318/B0.apk

# A perf build of <commit> (B1, B2a, B2, S0, S1, C, T*, N0, N1): check the commit out, then
rm -rf app/build/generated/assets/react "$TMPDIR/metro-cache"
EXPO_PUBLIC_WAVE_PERF=1 EXPO_PUBLIC_WAVE_COMMIT=$(git rev-parse --short HEAD) \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
#   S0, S1 add: EXPO_PUBLIC_WAVE_PERF_STALL_MS=1500
#   C adds:     WAVE_REACT_COMPILER=1
#   T* add:     EXPO_PUBLIC_WAVE_TABS=keep-layout | attach | freeze | <best>,retain=3

# U: unminified, for profile generation only (#317).
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -Pandroid.enableMinifyInReleaseBuilds=false

# B3 stand-in: the same commit as B2, no perf variables.
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Copy each APK to `/tmp/wave-318/<Id>.apk` as it's built.

## Before the session

1. **Fixture** (`scripts/perf/fixture.json`). `importLink` and `artist` are still `null`, and
   without them the import variant and `push-artist` can't run. Pick a public Spotify playlist of
   at least 2,000 songs (Spotify exercises #307's search pacing; 5,000 is better for #307) and an
   artist with a long play history that shows on Library › Artists' first screen. Commit both.
   For the `retain=3` run only, use a copy of the fixture with four tabs (Home, Library, Playlists
   and one more section) via `--out` and a separate label; the main runs keep the three tabs.
2. **Phone** (README, "Fixture"): the owner's Library as it is; Motion smoothness on Adaptive or
   High; animation scales 1x; `adb shell svc power stayon usb`; screen unlocked; something in the
   Queue (at least five songs up next), paused; thermal status 0; no other app opened during runs.
   `node scripts/perf/perf.ts doctor` checks what it can.
3. **Library size for plain builds.** B0 and B3 can't report it. Read it once from B2's first run
   header and pass it to every plain run: `--meta library.tracks=<n> --meta
   library.playEvents=<n> --meta library.playlistItems=<n>`.
4. **Order matters.** Install the builds oldest first: B0, B1, S0, N0, N1, then everything from the
   head. The head's migrations 0022 (`playlist_revisions`) and 0023 (`play_totals`) add tables and
   triggers that an older APK doesn't know about. Going back to an older APK afterwards should
   still work (the old code ignores them and the triggers keep them right), but nobody has tried
   it, so don't.
5. **Leave the Library alone between runs**, except to delete the imported playlist after each
   import run. Every run records its size, and `compare` warns when it moved by more than 1%.

## Command sequence

`R` is the runner as a shell function, `R() { node scripts/perf/perf.ts run "$@"; }`. Every comparison run uses `--compile baseline`:
B0 ships AndroidX's profile with profileinstaller 1.3.1, which can't install it on Android 15+,
and B2/B3 ship Wave's own with 1.4.1, so the compiled state differs unless the runner sets it.
Record `artProfile` from each run header in the results table. Keep the phone on the charger
between runs and let thermal status return to 0.

```sh
R() { node scripts/perf/perf.ts run "$@"; }

# 0. Checks.
node scripts/perf/perf.ts doctor

# 1. Original baseline (B0, plain). Idle and import, the soaks, the slow scenarios by name.
R --apk /tmp/wave-318/B0.apk --commit 66f0290 --compile baseline --label 318-B0 \
   --variant idle,import --meta build=B0 --meta library.tracks=<n> --meta library.playEvents=<n> \
   --meta library.playlistItems=<n>
#    Then delete the imported playlist.
R --compile baseline --commit 66f0290 --label 318-B0-soak \
   --scenario soak-routes,soak-player,rescan-return --meta build=B0 --meta library.tracks=<n> ...
R --compile baseline --commit 66f0290 --label 318-B0-glass --scenario glass --meta build=B0 ...
#    Compile-state controls: neither depends on the profile.
R --compile verify --commit 66f0290 --label 318-B0-verify \
   --scenario startup,warm-start,tab-switch,push-tracklist,now-playing,queue --meta build=B0 ...
R --compile speed  --commit 66f0290 --label 318-B0-speed \
   --scenario startup,warm-start,tab-switch,push-tracklist,now-playing,queue --meta build=B0 ...
#    Sideload state of the shipped APK (#317's before):
adb install -r /tmp/wave-318/B0.apk && node scripts/perf/perf.ts profile device
#    open Wave, wait 15 s, close it
node scripts/perf/perf.ts profile device
adb shell cmd package bg-dexopt-job && node scripts/perf/perf.ts profile device

# 2. Instrumented baseline (B1, perf).
R --apk /tmp/wave-318/B1.apk --compile baseline --label 318-B1 --variant idle,import
#    Delete the imported playlist.
R --compile baseline --label 318-B1-soak --scenario soak-routes,soak-player
#    One traced pass for attribution (compare traced runs only with traced runs).
R --compile baseline --label 318-B1-trace --perfetto \
   --scenario tab-switch,push-settings,push-tracklist,now-playing,queue,search-first-tap
#    Skip with a short queue (one album), then with the whole Library as Songs, play all, paused:
R --compile baseline --label 318-B1-skip-short --scenario skip
R --compile baseline --label 318-B1-skip-long  --scenario skip

# 3. Stall before #313 (S0).
R --apk /tmp/wave-318/S0.apk --compile baseline --label 318-S0 --scenario scrub,queue-drag

# 4. Spring order (N0, N1), for decision 5.
R --apk /tmp/wave-318/N0.apk --compile baseline --label 318-N0 --scenario now-playing,now-playing-first
R --apk /tmp/wave-318/N1.apk --compile baseline --label 318-N1 --scenario now-playing,now-playing-first

# 5. Profiles (#317): generate on the head, commit, then build B2 and B3 while step 6 runs.
R --apk /tmp/wave-318/B2a.apk --compile baseline --label 318-B2a \
   --scenario startup,warm-start,tab-switch,push-tracklist,now-playing,queue
node scripts/perf/perf.ts profile generate --apk /tmp/wave-318/U.apk --commit <head>
#    Check profiles.json for targets it didn't find, commit apps/mobile/profiles/, build B2 and B3,
#    then check what each ships:
node scripts/perf/perf.ts profile check-apk apps/mobile/android/app/build/outputs/apk/release/app-release.apk \
   --mapping apps/mobile/android/app/build/outputs/mapping/release/mapping.txt

# 6. Combined pass, perf (B2). Everything B1 ran, plus what only the head can answer.
R --apk /tmp/wave-318/B2.apk --compile baseline --label 318-B2 --variant idle,import
#    Don't delete the playlist yet. Wait until the import's notification says it's done, then:
R --compile baseline --label 318-B2-after-import \
   --scenario tab-switch,push-library,push-tracklist,now-playing,search-typing
#    compare warns that playlist entries grew: expected here. Now delete the imported playlist.
R --compile baseline --label 318-B2-soak --scenario soak-routes,soak-player,rescan-return
R --compile baseline --label 318-B2-soak-import --variant import --scenario soak-player
#    Delete the imported playlist.
R --compile baseline --label 318-B2-trace --perfetto \
   --scenario tab-switch,push-settings,push-tracklist,now-playing,queue,search-first-tap
R --compile baseline --label 318-B2-skip-short --scenario skip
R --compile baseline --label 318-B2-skip-long  --scenario skip
#    Glass probes, ABBA so thermal drift doesn't land on one probe (#316, decision 3):
for probe in off record blur live coalesced live blur record off; do
  R --compile baseline --glass $probe --label 318-glass-$probe \
     --scenario glass,tab-switch,push-library,now-playing
done
#    Compile-state controls, as for B0:
R --compile verify --label 318-B2-verify --scenario startup,warm-start,tab-switch,push-tracklist,now-playing,queue
R --compile speed  --label 318-B2-speed  --scenario startup,warm-start,tab-switch,push-tracklist,now-playing,queue
#    #317 before/after on the same commit (B2a against B2):
node scripts/perf/perf.ts compare perf-results/318-B2a-*.jsonl perf-results/318-B2-*.jsonl

# 7. Stall after #313 (S1).
R --apk /tmp/wave-318/S1.apk --compile baseline --label 318-S1 --scenario scrub,queue-drag

# 8. Decisions 1 and 2 (C, T*): same scenarios as B2, one APK each.
R --apk /tmp/wave-318/C.apk --compile baseline --label 318-compiler \
   --scenario push-settings,push-library,push-tracklist,push-empty,tab-switch,rapid-tabs,now-playing,queue,search-typing
for choice in keep-layout attach freeze; do
  R --apk /tmp/wave-318/T-$choice.apk --compile baseline --label 318-tabs-$choice \
     --scenario tab-first,tab-switch,rapid-tabs,soak-routes
done
#    Then the best of them with retain=3, with the four-tab fixture.

# 9. The ti release APK (B3, plain). The same as B0's step 1, for a like-for-like comparison.
R --apk /tmp/wave-318/B3.apk --commit <head> --compile baseline --label 318-B3 \
   --variant idle,import --meta build=B3 --meta library.tracks=<n> ...
#    Delete the imported playlist.
R --compile baseline --commit <head> --label 318-B3-soak \
   --scenario soak-routes,soak-player,rescan-return --meta build=B3 ...
R --compile baseline --commit <head> --label 318-B3-glass --scenario glass --meta build=B3 ...
R --compile verify --commit <head> --label 318-B3-verify --scenario startup,warm-start,tab-switch,push-tracklist,now-playing,queue --meta build=B3 ...
R --compile speed  --commit <head> --label 318-B3-speed  --scenario startup,warm-start,tab-switch,push-tracklist,now-playing,queue --meta build=B3 ...
#    Sideload state of the new APK (#317's after), as for B0:
adb install -r /tmp/wave-318/B3.apk && node scripts/perf/perf.ts profile device
#    open Wave, wait 15 s, close it; then bg-dexopt-job; profile device after each.

# 10. The manual checklist below, on B3. Leave B3 installed.
```

Comparisons to print and paste into the tables:

```sh
P() { node scripts/perf/perf.ts "$@"; }
P compare perf-results/318-B0-<time>.jsonl       perf-results/318-B3-<time>.jsonl        # plain: frames, launch, memory
P compare perf-results/318-B0-soak-<time>.jsonl  perf-results/318-B3-soak-<time>.jsonl   # growth over the soaks
P compare perf-results/318-B0-glass-<time>.jsonl perf-results/318-B3-glass-<time>.jsonl
P compare perf-results/318-B0-verify-<time>.jsonl perf-results/318-B3-verify-<time>.jsonl # controls
P compare perf-results/318-B0-speed-<time>.jsonl  perf-results/318-B3-speed-<time>.jsonl
P compare perf-results/318-B1-<time>.jsonl       perf-results/318-B2-<time>.jsonl        # perf: latencies, renders
P compare perf-results/318-B1-soak-<time>.jsonl  perf-results/318-B2-soak-<time>.jsonl   # JS heap, listeners
P compare perf-results/318-B1-skip-long-<time>.jsonl perf-results/318-B2-skip-long-<time>.jsonl
P compare perf-results/318-S0-<time>.jsonl       perf-results/318-S1-<time>.jsonl
P compare perf-results/318-N0-<time>.jsonl       perf-results/318-N1-<time>.jsonl
P compare perf-results/318-B2-<time>.jsonl       perf-results/318-compiler-<time>.jsonl
P compare perf-results/318-glass-off-<time>.jsonl perf-results/318-glass-live-<time>.jsonl  # and each probe pair
P summary perf-results/318-B2-after-import-<time>.jsonl
```

`compare` prints a warning for every way two runs differ (phone, refresh rate, compiler filter,
Library size, build kind, glass). B0 against B1 or B2 always warns "Perf build": don't compare
latencies across that line, only frames, launch and memory.

### How long it takes

The soaks are the long part. On a perf build each step waits about 8 s (settle, window and the
app's flush), so `soak-routes` (nine steps a cycle at three tabs, 20 cycles and a warm-up) runs
about 25 minutes and `soak-player` (four steps, 30 cycles and a warm-up) about 16. A plain build
doesn't wait for a flush and takes about half. `--iterations` lengthens a soak when the growth
table shows a field still rising at the end.

## What each criterion reads

- **The initial scenarios, same phone, fixture, refresh rate and compile state, idle and while
  importing, and after the import.** `318-B0` against `318-B3` (and `318-B1` against `318-B2`) with
  `--variant idle,import`, every run on `--compile baseline`. `318-B2-after-import` covers "after
  import completion": the same Library with the finished playlist in it, idle.
- **First response, navigation and keyboard latency, frame deadline misses, cold and warm startup,
  query and render counts, retained memory.** Latencies (`firstFrameMs`, `responseMs`, `settleMs`,
  keyboard from `search-first-tap`) from B1 against B2. Frames, deadline misses, frame parts, cold
  and warm launch (`am start -W`) and retained memory from B0 against B3, and again B1 against B2.
  Render counts and `libraryQueries` reads per step from B2 (B1 has render counts but no query
  counters; #309's desktop model stands in for the old count). `compare` now prints retained memory
  at each scenario's end, before and after, and the views, activities and binders alive.
- **Prolonged tab/route cycling and player/Queue switching.** `soak-routes` and `soak-player`.
  Each reads `dumpsys meminfo` six times over its cycles; each step records the JS heap
  (`jsHeapUsed`, perf builds), listener counts and the Library query registry's sizes. `summary`
  and `compare` print the growth table: first, last, and what the second half of the samples added.
  `still growing` on any row is a finding to investigate (heap dump, `--perfetto`, more cycles),
  not something to average away. `levelled` is a cache filling up and stopping, which is expected
  for the warm views (#305), kept tabs (#304) and retained queries (#309, at most 8).
- **Correctness.** The manual checklist below, on B3, plus the per-ticket device checks.
- **Every experiment's outcome.** The experiments table below: each row gets its device result,
  including "no difference" and "worse".
- **A pass/fail table and follow-ups, no 120 Hz claim from desktop numbers or tests.** The table
  below. The 120 Hz row passes only on B3's (and B2's) gfxinfo frames.

## Pass/fail

A difference counts when both medians move the same way by more than the larger of 10% and one
frame at 120 Hz (8.3 ms), and the p90s agree. Anything smaller is "no change". A row that
regressed fails even if its ticket's own target improved.

| #   | Criterion                                                               | Runs compared                             | Pass when                                                                        | Result  |
| --- | ----------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- | ------- |
| 1   | Same phone, refresh rate, fixture, compile state across runs            | every `compare` header                    | no warning but the expected ones (perf build, playlist entries after import)     | pending |
| 2   | Cold launch (`startup/*/cold` TotalTime)                                | B0 → B3, idle and import                  | faster or no change                                                              | pending |
| 3   | Warm launch (`warm-start/*/warm`)                                       | B0 → B3                                   | faster or no change                                                              | pending |
| 4   | Return after the rescan interval, tab tapped at once (`rescan-return`)  | B0 → B3; B2 `backgroundWork`              | tab frames no worse; `forcedSlices` near 0 idle                                  | pending |
| 5   | First visit to each tab (`tab-first`)                                   | B0 → B3 frames; B1 → B2 latencies         | no regression                                                                    | pending |
| 6   | Warm tab switch (`tab-switch`)                                          | B0 → B3; B1 → B2                          | faster or no change; fewer late frames                                           | pending |
| 7   | Rapid tab taps settle on the last tab (`rapid-tabs`)                    | B0 → B3 `settleMs`, `finalRoute`; B2      | settles on the last tab, sooner                                                  | pending |
| 8   | Push and pop: Settings, Albums, Songs, the artist, the empty control    | B0 → B3; B1 → B2                          | faster or no change; `push-empty` shows what navigation alone costs              | pending |
| 9   | Library › Songs to its first rows (`push-tracklist`)                    | B1 → B2 `responseMs`; B0 → B3 frames      | faster                                                                           | pending |
| 10  | Artist page to its stats (`push-artist`)                                | B1 → B2; B0 → B3 frames                   | faster or no change                                                              | pending |
| 11  | Now Playing open and close, first and warm                              | B1 → B2; B0 → B3 frames                   | faster                                                                           | pending |
| 12  | Queue open and close, first and warm                                    | B1 → B2; B0 → B3 frames                   | warm open faster; first no worse                                                 | pending |
| 13  | Skip, short and long Queue (`skip`)                                     | B1 → B2 frames, trace; B2 `responseMs`    | long Queue no slower than short                                                  | pending |
| 14  | Scrub and Queue drag, idle and importing                                | B1 → B2                                   | fewer `js:*` calls per drag; frames no worse                                     | pending |
| 15  | Scrub and Queue drag with JavaScript stalled 1.5 s                      | S0 → S1                                   | frames keep coming during the stall; first frame about a refresh after the touch | pending |
| 16  | Search: first tap to keyboard (`search-first-tap`)                      | B1 → B2                                   | keyboard on the first tap, one `focus` mark, sooner                              | pending |
| 17  | Search typing to results (`search-typing`), idle and importing          | B2 (new scenario; B1 has no marks)        | results within a few frames of the last key; `search.prepared` flat              | pending |
| 18  | Import: card, start, ten seconds filling (`import`)                     | B0 → B3 frames; B1 → B2                   | fewer late frames and long tasks while it fills                                  | pending |
| 19  | Navigation while importing (every scenario, `import` variant)           | B0 → B3; B1 → B2                          | close to the idle variant; better than B0                                        | pending |
| 20  | Navigation after the import finished                                    | `318-B2-after-import` against `318-B2`    | close to idle before the import                                                  | pending |
| 21  | Frame deadline misses on navigation steps                               | B0 → B3                                   | fewer, every scenario                                                            | pending |
| 22  | Render counts per step                                                  | B1 → B2                                   | 0 for RootLayout, NowPlayingSheet, PlayerView, MiniPlayer, TabBar on push/pop    | pending |
| 23  | Library queries per step (`libraryQueries.reads` deltas), playlist work | B2                                        | no reads for hidden screens; `*.unrelated` flat while importing                  | pending |
| 24  | Retained memory at each scenario's end                                  | B0 → B3                                   | no scenario grows by more than 10% PSS without a known reason (kept views)       | pending |
| 25  | Growth over `soak-routes`                                               | B0, B3 (memory); B2 (heap, counters)      | no `still growing` row                                                           | pending |
| 26  | Growth over `soak-player`, idle and importing                           | B0, B3; B2                                | no `still growing` row; listeners flat                                           | pending |
| 27  | Glass: idle screen draws nothing (`idle-home`)                          | every glass run                           | 0 frames under every probe                                                       | pending |
| 28  | Glass: what it costs a navigation frame                                 | `318-glass-off` → `318-glass-live`        | recorded either way (decision 3)                                                 | pending |
| 29  | Compile-state controls (`verify`, `speed`)                              | B0 → B3                                   | recorded; differences there aren't the profile's                                 | pending |
| 30  | Sideloaded APK gets its profile                                         | `profile device`, B0 and B3               | B3 holds a profile after launch and `speed-profile` after the idle compile       | pending |
| 31  | Manual correctness checklist                                            | B3                                        | every item checked                                                               | pending |
| 32  | Per-ticket device checks                                                | B2, B3                                    | every item checked                                                               | pending |
| 33  | 120 Hz goal                                                             | B3 frames (gfxinfo), not desktop or tests | frame p90 ≤ 8.3 ms and few late frames on tabs, pushes, Now Playing, Queue       | pending |

## Correctness checklist (B3, by hand)

Each item: what to do, what must happen. Mark it checked or describe what went wrong.

- [ ] **Playback.** Play a Track from Library › Songs, an album and a playlist. Pause, resume, next,
      previous, seek with the scrubber (the time labels don't jump when the drag starts or ends),
      and from the notification and the lock screen. A counted play shows in Home's Recently and
      Most Played and in Stats after the refresh.
- [ ] **Shuffle.** Shuffle Library › Songs and a playlist: the order changes, the first song
      plays, nothing repeats before the Queue ends. Smart Shuffle on a playlist works as before.
- [ ] **Queue editing.** Drag a row three places down and back (it follows the finger; the other
      rows step aside), drag past the edge (auto-scroll), remove a row, Play Next and Add to Queue
      from a menu. Queue, player, Queue again: the scroll position stays and the rows show at once.
      A new play scrolls the Queue to the top. TalkBack's Move up / Move down / Remove still work.
- [ ] **Skip in a long Queue.** Library › Songs, play all, skip ten times: each skip plays the
      next entry, the notification follows.
- [ ] **Scanning.** Add a folder with new files: they appear, with artwork, and the Library counts
      move. Delete a file outside Wave, return after more than 60 s: it's gone from the lists and
      from playlists' counts. A rescan that finds nothing changes nothing on screen.
- [ ] **Playlists: order, counts, artwork.** A Library playlist and a YT Music one: entries in
      their saved order, the count and total length on Library › Playlists match the page, the
      mosaic shows four covers. Add, remove and reorder an entry: the list's count, length and
      mosaic follow. Import the fixture playlist: it fills in source order, nothing twice, the
      progress line and notification update about once a second, and cancelling stops it.
      Kill Wave mid-import and reopen: it resumes without losing more than about a second.
- [ ] **Search.** First tap on Search after a launch raises the keyboard. Type a song, an album,
      an artist and a playlist name: results group and rank as before. Recent searches, the YT
      Music section and "already in your Library" still show. During an import, results stay.
- [ ] **Favorites.** Star from a row, Now Playing and a menu; unstar. Home's Favorites and the
      favorites list follow at once, also for a screen that was hidden when the star changed.
- [ ] **Sync (Wave account).** Signed in: star a song, edit a playlist, play a song on this phone;
      another phone (or a reinstall) gets them back. Pulled plays count once. Signing out and in
      again doesn't duplicate plays or playlist entries.
- [ ] **Stats and artist pages.** An artist's stats block matches its plays (compare with the
      Stats screen), and refreshes after a play and after a scan.
- [ ] **Navigation and tabs.** A detail screen opened from Home, a section tab and the Library
      stack opens in the tab it was opened from. Rapid taps across tabs end on the last tab
      tapped. A tab's nested route and scroll survive repeated visits. Reduce motion only fades.
- [ ] **Glass.** Scrolling under the tab bar, Search pill and mini player, a tab switch, Now
      Playing over the glass, a dialog and a theme change look as before.

## Per-ticket device checks

Collected from each ticket's doc. Most are first-run confirmations the code relies on.

- **#302** (runner). `touchAt` is set on each step (the root view's `onTouchStart` sees touches
  under gesture handler); gfxinfo framestats and the `dumpsys` shapes parse on One UI, meminfo's
  Objects section included; `uiautomator dump` finds every target (tab labels, `Settings`, `Back`,
  `Albums`, `Songs`, `Artists`, the fixture's artist, `Developer`, `Now playing: …`, `Close Now
  Playing`, `Queue`, `Next track`, `Import`); the perf build's `console.log` reaches logcat and
  Expo inlined `EXPO_PUBLIC_WAVE_PERF` (the run's first line); `performance.now()` and the touch's
  timestamp share CLOCK_MONOTONIC. **Pending.**
- **#303.** Per-step render counts as expected (row 22). A detail screen opens in the tab it came
  from; Now Playing's artist link on and off an artist's page; Go to Artist on a streamed song on
  a YT Music artist page. **Pending.**
- **#304.** A tab taken off the bar after opening an album in it, put back and tapped, comes back
  with its route; nested route and scroll survive repeated visits with every hidden-tab choice;
  reduce motion only fades. **Pending.**
- **#305.** Queue to player to Queue keeps the scroll and shows rows at once; Legend List doesn't
  blank or jump on reveal; the player's artwork is full size at once after the Queue or Lyrics;
  RNGH's pan and reanimated's `useScrollOffset` re-attach after a few switches (drag a row,
  auto-scroll); TalkBack skips the hidden pane; listener counts drop with the sheet closed.
  **Pending.**
- **#306.** One `search.focus` per first tap (more means Android dropped the first focus); whether
  Android reports a dropped focus the way the retry assumes; `search.prepared` grows only by the
  playlists during an import. **Pending.**
- **#307.** The import's frames with a 5,000-song Spotify playlist (`import/import/during-import`).
  **Pending.**
- **#308.** `playlistWork.decoded.unrelated` and `summarized.unrelated` stay at their first-read
  values while the import runs. **Pending.**
- **#309.** Hidden screens don't read during bursts (`libraryQueries.paused` grows, `reads`
  doesn't); a screen comes back current after an edit made while it was hidden. **Pending.**
- **#310.** `songPages` in the flush (rows held stay at or under 450); spine drag by hand, how
  often placeholders show; `scroll-songs` frames. **Pending.**
- **#311.** `uiautomator` finds `Artists` and the artist as text nodes. **Pending.**
- **#312.** Home after skips with Home in sight (`skip` with Home shown): frames and
  `libraryQueries.reads`. **Pending.**
- **#313.** The `TextInput` time labels line up with the React labels; the empty path at the bar's
  ends; auto-scroll on Legend List's inner ScrollView; a drag started during a stall follows the
  finger before the lifted copy appears. **Pending.**
- **#314.** A single `Next track` on screen (the mini player's); `main` thread slices around
  `applySync` in the trace, long against short Queue. **Pending.**
- **#315.** `startup.contentAt` and React Native's `rnStartupTiming` share a clock; the root view's
  `onTouchEnd` fires for touches gesture handler or a scroll view takes (`forcedSlices` near 0
  idle); a full scan (new folder) under `--perfetto`: do the scanner's tag threads compete with
  the UI thread, and do batches pile up in JavaScript while a slice waits. **Pending.**
- **#316.** `--glass` shows the asked probe in the run's `Glass:` line; a fling's touch reaches
  `onTouchStart`; whether `(tabs)` stays attached and shown under pushed Library screens
  (`push-library` pre-draw, `live` against `off`); whether glass layers re-render on frames where
  only the chrome changed (RenderThread slices in a fling's trace). **Pending.**
- **#317.** The S24+'s Android version and the three sideload states for B0 and B3; `pm
  dump-profiles` output on One UI parses (counts in `profiles.json` against `profile device`).
  **Pending.**

## Experiments and their outcomes

What each ticket tried, and where it stands. Desktop results are labelled; none of them predicts
the phone. Every device column is pending until the runs above.

| Ticket | Experiment                                                                     | In the combined build  | Desktop outcome                                                                                           | Device outcome       |
| ------ | ------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------- | -------------------- |
| #302   | Runner, opt-in instrumentation, release baseline                               | yes (perf builds only) | runner validated on the simulated phone only                                                              | pending              |
| #303   | Route observers out of always-mounted components; memoized chrome              | yes                    | none (render counts are a phone measure)                                                                  | pending              |
| #303   | React Compiler                                                                 | no (off)               | 384 components compile, 9 skipped; 2 hooks would stop refreshing (stats)                                  | pending              |
| #304   | Rapid taps coalesce to the last tab; entry fades from 0.5, not 0               | yes                    | Core tests only                                                                                           | pending              |
| #304   | Hidden tabs: `attach`, `keep-layout`, `freeze`, `retain=3`                     | no (default unchanged) | none                                                                                                      | pending              |
| #305   | YT Music covers batched into the Queue                                         | yes                    | 2,000 covers: 2,000 store changes to 1, 241 ms to 5.9 ms (desktop)                                        | pending              |
| #305   | Spring handed over before the phase listeners                                  | yes                    | none                                                                                                      | pending              |
| #305   | Player and Queue kept warm under `Activity`                                    | yes                    | none                                                                                                      | pending              |
| #305   | Not done: UI-thread mini player tap, Queue prewarm, `recycleItems`             | no                     | left for the trace to justify                                                                             | pending              |
| #306   | Focus state machine; reads after the keyboard; index per source, in slices     | yes                    | 50,000 songs: first build in 9 ms steps instead of one 159 ms task; a playlist change 1.1 ms (desktop)    | pending              |
| #307   | Import planner keeps a tally                                                   | yes (also in B1)       | 10,000 songs: 23.1 s of Core CPU to 0.88 s (desktop)                                                      | pending              |
| #308   | Append by candidates, playlist revisions, summary cache, paced progress        | yes                    | Library › Playlists after a batch at 3,000 entries: 98 ms to 17 ms (desktop)                              | pending              |
| #308   | Playlist totals in SQL instead of JSON.parse in JavaScript                     | yes                    | **negative on desktop**: 17.1 ms SQL against 6.9 ms V8 JSON.parse; kept on reasoning about Hermes and JSI | pending (decision 4) |
| #309   | Shared Library queries; hidden screens pause                                   | yes                    | modelled reads −33% to −94% by session (desktop model)                                                    | pending              |
| #310   | Paged Songs list                                                               | yes                    | opening Songs: 122 ms to 20 ms, 107 MB to 1.5 MB allocated (desktop)                                      | pending              |
| #310   | Order as one row per Track                                                     | no                     | **rejected**: 21.7 MB allocated against 1.2 MB as one string (desktop)                                    | n/a                  |
| #310   | Index on `added_at`; ordered subquery under `group_concat`                     | no                     | **negative**: 11.7 against 10.2 ms; 1 ms saved but order not guaranteed (desktop)                         | n/a                  |
| #311   | Artist stats scoped to the artist                                              | yes                    | 300k plays: 628 ms to 4 ms (desktop)                                                                      | pending              |
| #311   | Credits joined as a `UNION ALL` subquery                                       | no                     | **rejected**: scanned both credit tables (plan test)                                                      | n/a                  |
| #312   | `play_totals` kept by triggers; Home's sections split                          | yes                    | refresh after a play at 300k plays: 6.5 s to 118 ms (desktop)                                             | pending              |
| #312   | Trigger cost on writes                                                         | yes                    | **cost**: an 18,000-play BlackPlayer import 12% slower (1,322 against 1,185 ms, desktop)                  | pending              |
| #312   | Forced table scan of `play_totals` (`+counted_plays`)                          | no                     | **negative**: no measurable difference, dropped                                                           | n/a                  |
| #313   | Scrub and Queue drag on the UI thread                                          | yes                    | worklet transform checked only                                                                            | pending              |
| #314   | Seek by the anchor's index; items only for keys JS didn't send                 | yes                    | 5,000-entry Queue: 110 µs to 0.06 µs per skip native, 328 to 51 µs JS (desktop)                           | pending              |
| #315   | Startup work after first content; free turns; sliced scan saves; quiet rescans | yes                    | 500 files: longest block 79 ms to 20 ms, total about 15% more (desktop)                                   | pending              |
| #315   | Not done: scanner thread priority, batch size                                  | no                     | left for a full-scan trace                                                                                | pending              |
| #316   | Hidden glass views skip their backdrop recording                               | yes                    | none                                                                                                      | pending              |
| #316   | `coalesced`: one shared backdrop recording                                     | no (probe only)        | none                                                                                                      | pending (decision 3) |
| #316   | Probes `blur`, `record`, `off`: where glass time goes                          | no (probes)            | none                                                                                                      | pending              |
| #317   | profileinstaller 1.4.1 (1.3.1 can't install on Android 15+)                    | yes                    | read from bytecode; packaging checked with stand-in profiles                                              | pending              |
| #317   | Wave's own Baseline and Startup Profiles                                       | after step 5           | none                                                                                                      | pending              |

## Open decisions that need device data

| #   | Decision                                       | Today                          | Runs that settle it                                                                                                                                                                                                                             | Settled when                                                                                                                                                                                                    | Result  |
| --- | ---------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | React Compiler on or off (#303)                | off                            | `318-compiler` (build C) against `318-B2`: `perf.ts compare perf-results/318-B2-*.jsonl perf-results/318-compiler-*.jsonl`                                                                                                                      | latencies or frames better beyond noise, and the checklist passes. Before shipping: fix `useStatsRead` and `useArtistStats` in `stats/hooks.ts` (read the value or `"use no memo"`)                             | pending |
| 2   | How hidden tabs are kept, how many (#304)      | `detach,display-none,retain=5` | `318-tabs-<choice>` against `318-B2`, scenarios `tab-first,tab-switch,rapid-tabs,soak-routes`; then `<best>,retain=3` with four tabs                                                                                                            | a choice beats the default on `tab-switch/idle/tab` (`tab.commit`, first frame, settle, p90, late frames) with `tab-first` and memory no worse; change `DEFAULT_TAB_SCREENS` in Core                            | pending |
| 3   | Glass coalescing (#316)                        | `live`                         | the ABBA loop in step 6: `perf.ts compare perf-results/318-glass-live-*.jsonl perf-results/318-glass-coalesced-*.jsonl`                                                                                                                         | `coalesced` cuts pre-draw and layout with the same miss rate or better, and looks the same; then the default in Core `glassLayers`. If `live` − `off` is small next to 8.3 ms, record that glass isn't material | pending |
| 4   | Playlist totals in SQLite or JavaScript (#308) | SQLite                         | **no runner command settles it yet**: the build has no switch for the JavaScript path. Needs a perf-only switch (e.g. `EXPO_PUBLIC_WAVE_PLAYLIST_TOTALS=js`) then `R --variant import --scenario import,tab-switch,push-library` on both builds | the JS path's `during-import` and Playlists-tab frames and long tasks beat SQLite's beyond noise                                                                                                                | pending |
| 5   | Now Playing spring before listeners (#305)     | spring first                   | `318-N0` against `318-N1`: `perf.ts compare perf-results/318-N0-*.jsonl perf-results/318-N1-*.jsonl` (`phasesMs`)                                                                                                                               | if `nowPlaying.notified` − `nowPlaying.step` is near zero on N0, the order is neutral: keep it, record the negative result                                                                                      | pending |

## Results

Fill in from the runs. Paste each `compare` and `summary` output under its heading, with the run
header, and link the results file under `results/`.

### Original baseline (B0) and the ti release (B3)

Pending.

### Instrumented baseline (B1) and the combined pass (B2)

Pending.

### After the import finished

Pending.

### Growth over the soaks

Pending.

### Stall builds (S0, S1)

Pending.

### Compile states and the sideload

Pending.

### Glass probes

Pending.

### Traces

Which stalls the B1 and B2 traces put on `mqt_v_js`, `main` or `RenderThread`. Pending.

## Follow-ups known now

- Set the fixture's `importLink` and `artist` (step 1 of "Before the session").
- Decision 4 needs a switch for the JavaScript totals before any run can settle it.
- No scenario opens a playlist's page; the filling playlist's page (#308) is measured only through
  the counters. A `push-playlist` scenario would need a fixture playlist name, like `artist`.
- The React Compiler's two hook fixes, if decision 1 says on.
- The runner has no spine-drag step (#310); check it by hand.
- Paging other Track lists (an artist's, a genre's, Favorites) waits for their phone numbers (#310).
- A lighter queue projection for Play on the whole list (#310: `songsByIds` reads 21 columns where
  the queue needs 7).

## Runner change in this ticket

- `soak-routes` and `soak-player` (by name, not in `all`), each reading memory six times over its
  cycles (`Scenario.memorySamples`; memory records carry `iteration`).
- meminfo's Objects section: `views`, `viewRoots`, `activities`, `appContexts`, `localBinders`,
  `proxyBinders`, `deathRecipients` in every memory record.
- Steps record `jsHeapUsed` from a perf build's flush.
- `summary` prints the growth table for soak scenarios; `compare` prints retained memory at each
  scenario's end side by side and both sides' growth tables (`scripts/perf/memory.ts`).
- Tests: `node --test scripts/perf/*.test.ts` (109 pass), `tsc -p scripts/perf` clean. Checked
  only on the simulated phone (`run --dry-run --scenario soak-routes,soak-player`); its numbers are
  made up and not recorded.
