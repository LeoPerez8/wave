# #728 React Compiler: the hooks it would break, and the comparison build

Ticket: #728 (parent #712). Branch `feat/728-react-compiler`, based on
`origin/feat/712-faster-lighter` at a6333827.

**The compiler is on (#1433).** This ticket made the compiler safe to turn on and made the build
that measures it. #1433 ran the comparison on the emulator and turned the compiler on by default
(see "On the emulator (#1433)"). The phone numbers are still pending: the owner runs them on the
`ti` release (see "On the reference phone (#1355)"). Nothing in this doc is a phone measurement.

## What changed

- **Memos read what they depend on.** The React Compiler replaces `useMemo` and `useCallback` with
  its own memos, keyed on what the function reads. A dependency listed only to say "make it again
  when this changes" is dropped, and the compiled value goes stale. #303 found two; the code has
  since grown two more. All four now read it:
  - `stats/hooks.ts` `useStatsRead`: listed the play-history version (`plays`) to read Stats again
    after a play. The reading now keeps the version and sources it reflects.
  - `stats/hooks.ts` `useArtistStats`: listed the artist page's `songs` to read again after a scan.
    It passes them to `useStatsRead` as the reading's sources.
  - `settings/searchOnline.ts` `useSearchOnlineAlways`: listed the `visit` to read the network
    again as typing starts in an empty Search field. The compiler also caches a call on its
    arguments alone, so even a memo that read `visit` kept the first `onMobileData()`. The hook now
    keeps the reading with the preference and visit it was made for, and the render that brings a
    new one reads again (the "adjust state while rendering" pattern).
  - `library/GenreSongList.tsx` `target`: listed the shown order to be made again as the whole
    order arrives, and read `load.current()` instead. It now reads the load's whole order as
    rendered (`useWholeOrder`'s new `current`).
- **A guard keeps it so.** `perf/memoDependencies.test.ts` fails when a `useMemo` or `useCallback`
  lists a dependency its function doesn't read (`unreadMemoDependencies` in
  `perf/sourceAudit.mjs`). One memo is allowed: `useWholeOrder`'s `[key]`, which the compiler
  can't preserve and leaves as written. Effects keep their arrays as written (checked in the
  compiled output) and aren't checked.
- **Tests run the hooks both ways.** `perf/reactCompilerBuilds.ts` loads a module as written and
  as the compiler builds it (babel-preset-expo's compiler, `target: "19"`, failing on any function
  it can't build). `stats/hooks.test.ts` and `settings/searchOnline.test.ts` run each case on
  both builds. Before the fixes the compiled ones failed: no re-read after a play, a scan or a new
  Search visit.
- **The flag is one inlined variable.** `EXPO_PUBLIC_WAVE_REACT_COMPILER` at bundle time sets
  `app.config.ts`'s `experiments.reactCompiler` (#303's `WAVE_REACT_COMPILER` is gone). #728 left
  it off unless the variable was `1`; since #1433 it is on unless the variable is `0`
  (`plugins/reactCompiler.ts`). The bundle inlines the same variable, so a perf build reports
  `reactCompiler` in its run metadata, `perf.ts run` prints it on the run's first line, and `perf.ts compare` says
  "React Compiler: off, then on." when the two runs differ (builds from before #728 don't say, and
  count as off).

No dependency was added: `babel-plugin-react-compiler` 1.0.0 comes with babel-preset-expo 58.

## Desktop checks

- `EXPO_PUBLIC_WAVE_REACT_COMPILER=1 npx expo config --json` has `experiments.reactCompiler: true`;
  without it the key is absent.
- The bundle step of a release build, `npx expo export:embed --platform android --dev false` with
  `EXPO_PUBLIC_WAVE_REACT_COMPILER=1 EXPO_PUBLIC_WAVE_PERF=1`, bundles 9,560 modules with 651 compiled memo
  caches and `REACT_COMPILER = true` in the perf module. No Gradle build was run.
- Compiler survey over `apps/mobile/src` (624 files, release options): 662 components and hooks
  compile; 13 functions are left as written. Nine can't be lowered (Effect generators in
  `nowPlaying/hooks.ts`, `settings/accountSignIn.ts`, `stats/recapMusic.ts` and
  `PlaylistRecommendations.tsx`; `??=` in `library/sharedQueries.ts`; `++` on a module variable in
  `motion/Press.tsx`; `try`/`finally` in `share/useImageShare.ts`; a value block in a `try` in
  `settings/waveAccount.ts`; a `for` without a test in `nowPlaying/useLyricsSearch.ts`). Four can't
  preserve a hand-written memo (`catalog/rowDrag.ts`, `nowPlaying/Scrubber.tsx` and
  `GenreSongList.tsx`'s `useGenreOpening` and `useWholeOrder`).

## The comparison

On the S24+, set up as `README.md`'s Fixture says, with the same scenarios and settings as the
712 baseline (`712-budgets.md`, Runs). Build both APKs from the same commit, after the #712
tickets are merged, so the compiler is judged on what it adds to them:

```sh
cd apps/mobile/android
rm -rf app/build/generated/assets/react "$TMPDIR/metro-cache"
EXPO_PUBLIC_WAVE_REACT_COMPILER=0 EXPO_PUBLIC_WAVE_PERF=1 EXPO_PUBLIC_WAVE_COMMIT=$(git rev-parse --short HEAD) \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# install, then the off runs:
node scripts/perf/perf.ts run --scenario all,glass --variant idle,import \
  --playlist "<visible playlist>" --artist "<visible artist>" --compile baseline --label 728-off-1

rm -rf app/build/generated/assets/react "$TMPDIR/metro-cache"
EXPO_PUBLIC_WAVE_REACT_COMPILER=1 EXPO_PUBLIC_WAVE_PERF=1 EXPO_PUBLIC_WAVE_COMMIT=$(git rev-parse --short HEAD) \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# install, then the on runs:
node scripts/perf/perf.ts run --scenario all,glass --variant idle,import \
  --playlist "<visible playlist>" --artist "<visible artist>" --compile baseline --label 728-on-1

node scripts/perf/perf.ts compare perf-results/<728-off-1>.jsonl perf-results/<728-on-1>.jsonl
```

Three runs of each (`-2`, `-3`) before reading noise; check each run's first line says the build
you meant (`perf build (React Compiler on)`). Add the screen-off soak (`--scenario
screen-off,screen-off-lyrics`) to both if the frame and latency runs favour the compiler: memo
caches cost memory and the soak is where a woken JS thread shows.

**Adopt it** if latencies (`responseMs`, `firstFrameMs`, `settleMs`), frames or render counts
improve beyond run-to-run noise, no `712-budgets.md` budget gets worse, and the behaviour checks
below pass. Otherwise it stays off and the spec says why.

| Measure                                  | Off         | On          | Change |
| ---------------------------------------- | ----------- | ----------- | ------ |
| every `all,glass` step, render counts    | **pending** | **pending** | —      |
| every `all,glass` step, latency, frames  | **pending** | **pending** | —      |
| screen-off soaks, JS wake-ups per minute | **pending** | **pending** | —      |
| Hermes bundle size                       | **pending** | **pending** | —      |

## On the emulator (#1433)

The `wave-marquee` AVD (x86_64, Android 15, read-only instance, `-no-audio`), seeded with
`node scripts/perf/seed.ts` (3,000 songs, 60 playlists, 12,000 plays), on mobile data only so Magic
Queue and Related show and Wi-Fi pre-download stays off. Both APKs are the kept x86_64 release APK
with a fresh perf bundle from commit 88c8a39ed (`repack-js.sh`, `EXPO_PUBLIC_WAVE_PERF=1`, and
`EXPO_PUBLIC_WAVE_REACT_COMPILER=0` or `=1`); `adb install -r` swapped them over the same Library,
and every run used here says on its first line which build it was.

**`reference-taps`** (`perf.ts emulator-check --iterations 3`), three runs of each, alternating
installs. First frame p90 in ms, by tap kind:

| Tap kind                 | Off (3 runs)    | Off median | On (3 runs)   | On median | Change |
| ------------------------ | --------------- | ---------- | ------------- | --------- | ------ |
| tab                      | 175, 220, 256   | 220        | 200, 165, 164 | 165       | −25%   |
| push                     | 446, 1,000, 279 | 446        | 298, 226, 205 | 226       | −49%   |
| pop                      | 347, 405, 160   | 347        | 188, 108, 127 | 127       | −63%   |
| Now Playing open (1 tap) | 143, 83, 60     | 83         | 69, 106, 73   | 73        | −12%   |
| Queue (1 tap)            | 246, 130, 91    | 130        | 123, 77, 92   | 92        | −29%   |
| JS blocks over 50 ms     | 64, 57, 52      | 57         | 50, 45, 49    | 49        | −14%   |

The scenario stops at its first `queue-close` on the seeded emulator (the Queue view there has no
"Queue" control), so each run times only its warm-up pass: 5 tabs, 10 pushes, 10 pops and one of
each sheet. Every on run beats the off median for tabs, pushes, pops and JS blocks.

**Step scenarios** (`perf.ts run --variant idle --iterations 3 --compile baseline`, the `all` set
without `push-empty`, whose "Developer" row the seeded emulator doesn't show). One valid run of
each; another off run lost its first metrics flush to a launch over 10 s and recorded frames only,
and the emulator was shut down before the second on run. The table holds the steps both runs
recorded: `push-playlist` failed in the off run, `search-first-tap` in the on run, and the off run
stopped before `scroll-songs`. Medians per step, off → on:

| Step                 | Renders/step | First frame ms | Settle ms     | Frame p90 ms | Missed frames |
| -------------------- | ------------ | -------------- | ------------- | ------------ | ------------- |
| tab-first            | 10 → 7.5     | 162 → 174      | 651 → 630     | 77 → 150     | 0.3 → 0.4     |
| tab-switch           | 5.1 → 4.5    | 64 → 61        | 496 → 453     | 53 → 48      | 0.3 → 0.2     |
| rapid-tabs           | 16.3 → 16    | 9 → 22         | 769 → 656     | 48 → 65      | 0.3 → 0.4     |
| push-settings push   | 7 → 6.3      | 60 → 76        | 723 → 725     | 61 → 61      | 0.4 → 0.4     |
| push-settings pop    | 4.3 → 3      | 88 → 107       | 673 → 672     | 61 → 61      | 0.5 → 0.5     |
| push-library push    | 4 → 4        | 41 → 30        | 1,037 → 730   | 109 → 57     | 0.5 → 0.3     |
| push-library pop     | 2.7 → 2.7    | 165 → 106      | 809 → 636     | 121 → 48     | 0.6 → 0.2     |
| push-tracklist push  | 37 → 36      | 25 → 26        | 1,219 → 893   | 77 → 69      | 0.6 → 0.4     |
| push-tracklist pop   | 4.7 → 2.7    | 128 → 106      | 693 → 675     | 57 → 48      | 0.4 → 0.2     |
| push-artist push     | 17 → 14.7    | 60 → 60        | 693 → 666     | 48 → 48      | 0.3 → 0.3     |
| push-artist pop      | 4 → 2.3      | 130 → 97       | 622 → 597     | 46 → 36      | 0.2 → 0.1     |
| now-playing open     | 14 → 9       | 107 → 71       | 827 → 776     | 65 → 61      | 0.7 → 0.5     |
| now-playing close    | 8 → 5        | 111 → 81       | 749 → 731     | 73 → 48      | 0.5 → 0.3     |
| search-typing        | 28.3 → 30    | 13 → 10        | 645 → 459     | 48 → 57      | 0.5 → 0.4     |
| scroll-playlist up   | 20.3 → 21.3  | 63 → 54        | 1,550 → 1,605 | 61 → 48      | 0.4 → 0.2     |
| scroll-playlist down | 12.3 → 13.3  | 62 → 77        | 1,483 → 1,495 | 53 → 61      | 0.3 → 0.3     |
| scroll-home up       | 0 → 0        | 100 → 66       | 2,318 → 1,516 | 250 → 57     | 0.9 → 0.4     |
| scroll-home down     | 0 → 0        | 71 → 78        | 2,604 → 930   | 250 → 85     | 0.9 → 0.5     |

Renders summed over the steps: 195 → 178 (−9%). Missed frames are the share of frames over budget.

| Measure (emulator)                         | Off                   | On           | Change                      |
| ------------------------------------------ | --------------------- | ------------ | --------------------------- |
| `reference-taps` first frame p90, tap kind | table above           | table above  | −12% to −63%                |
| step render counts, summed                 | 195                   | 178          | −9%                         |
| step settle, of 18 steps                   | table above           | table above  | 14 better, 4 equal or worse |
| step frame p90, of 18 steps                | table above           | table above  | 11 better, 3 equal, 4 worse |
| screen-off soaks, JS wake-ups per minute   | not run               | not run      | —                           |
| Hermes bundle size                         | 21,671,640 B          | 22,077,540 B | +405,900 B (+1.9%)          |
| compiled memo caches in the bundle         | 2 (from dependencies) | 826          | —                           |

Screen-off soaks weren't run: the emulator plays the seed's silent placeholder files with no audio
device, so it has no playback whose wake-ups would mean anything. They stay with the phone run.

**Decision: on by default.** Taps, renders and JS blocks improve beyond run-to-run noise and the
behaviour checks below pass on the compiled build. The one step that got worse in its single run,
`tab-first`'s frame p90 (77 → 150 ms, 6 taps), is the first tab tap after a cold launch; the
`reference-taps` tab tap kind, which includes it, went the other way in all three runs. The phone
run checks it.

## On the reference phone (#1355)

#1346 moved the decision to the reference phone (Xiaomi 25118PC98G, Android 15; `docs/spec.md` ›
Fluidity), and #1355 runs it on its own commit, so the compiler is judged against the cheap first
frames it would otherwise replace by hand. #1433 turned the compiler on from the emulator run
above; this run confirms it on the phone, or makes off the default again if it hurts there.
#1380 (Home and Now Playing) takes its decision from here.

`scripts/perf/react-compiler-apks.sh` builds both perf APKs from the checked-out commit (arm64,
each with a fresh bundle) into `perf-results/apks/`. Then, with the phone set up as #1347's run
says (YouTube Music on, Home showing the Magic Queue carousel and the DJ card):

```sh
scripts/perf/react-compiler-apks.sh
adb install -r perf-results/apks/wave-<commit>-compiler-off.apk
node scripts/perf/perf.ts run --scenario reference-taps --label 728-ref-off-1 \
  --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
  --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on its Similar artists row>"
adb install -r perf-results/apks/wave-<commit>-compiler-on.apk
node scripts/perf/perf.ts run --scenario reference-taps --label 728-ref-on-1 \
  --artist "<same>" --playlist "<same>" --album "<same>" --yt-artist "<same>"
node scripts/perf/perf.ts compare perf-results/728-ref-off-1-<time>.jsonl perf-results/728-ref-on-1-<time>.jsonl
```

Run each three times (`-2`, `-3`), alternating the installs, and check each run's first line says
the build meant (`perf build (React Compiler on)`). `adb install -r` keeps the Library between
them: both APKs carry the same signature. The rule to adopt it is the one above, with the tap
kinds' first-frame p90 against the 50 ms budget as the deciding numbers, plus the behaviour checks
below on the compiled build. If it's adopted, `app.config.ts` turns it on by default and the spec's
React Compiler paragraph says so; otherwise the spec says why it stays off.

### Phone run: pending

| Measure (reference phone, `reference-taps`) | Off         | On          | Change |
| ------------------------------------------- | ----------- | ----------- | ------ |
| first frame p90, each tap kind              | **pending** | **pending** | —      |
| response p90, each tap kind                 | **pending** | **pending** | —      |
| JS blocks over 50 ms during the run         | **pending** | **pending** | —      |
| PSS after the run                           | **pending** | **pending** | —      |
| Hermes bundle size                          | **pending** | **pending** | —      |

Decision on the phone: **pending**, run by the owner on the `ti` release. The compiler is on from
the emulator run (#1433).

## Behaviour checks on the compiled build

- Stats: play a song past the counting point with Stats open; its rankings update. Open an
  artist page, rescan after adding one of their songs; the stats block reads again.
- Search online set to Always on Wi-Fi: on mobile data, empty Search, type; Online isn't
  selected. Switch to Wi-Fi, clear the field, type again; it is.
- A genre: select a song, Select All before the whole order arrives; the selection bar's actions
  show once it does.
- The flows #303 listed (detail screens from Home, a section tab and the Library stack; Now
  Playing's artist link; Go to Artist on a streamed song).

On the emulator (#1433), with the default build after the merge (compiler on, seeded library):

- Search online: on mobile data, typing into an empty field leaves Library selected. On Wi-Fi,
  after clearing and typing, Online is selected. Back on mobile data it goes back to Library.
  Pass.
- Genre (Jazz): Select All about four seconds after opening showed 266 selected with every row
  checked, and the bar showed Play Next, Add to Queue, Add to Playlist and Delete. Pass, but the
  whole order had probably arrived before the tap, so the early-press path isn't proven here.
- The #303 flows: Library › Artists › artist › album; Now Playing's artist link; Playlists ›
  playlist; Home › album › Go to Artist; Go to Artist on a song found online. All pass.
- Stats: not checked. The seeded files are silent placeholders that don't play, so no play passes
  the counting point. The desktop tests in `hooks.test.ts` cover the compiled hooks; the phone run
  checks it.

## Not covered, and risks

- **Render-time reads of mutable values.** The compiler caches a call on its arguments, so a
  component that reads a module value or a native answer during render (not through
  `useSyncExternalStore` or state) keeps the first answer. `useSearchOnlineAlways` was one; the
  survey can't find the rest, and the behaviour checks are the test. Reads in effects and event
  handlers are unaffected.
- The guard checks names: a memo that reads `a.b` passes with `a` listed, even when `a` is listed
  to mean "when `a.c` changes". The compiler would key that memo on `a.b` alone.
- Now that the compiler is on, hand-written `useMemo`/`useCallback` it covers can go in later
  tickets; the Performance rules still apply either way.
- The emulator run measured the warm-up pass of `reference-taps` only, one valid step run per
  build, and no screen-off soak; the phone run covers all three.
