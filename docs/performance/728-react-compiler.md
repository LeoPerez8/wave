# #728 React Compiler: the hooks it would break, and the comparison build

Ticket: #728 (parent #712). Branch `feat/728-react-compiler`, based on
`origin/feat/712-faster-lighter` at a6333827.

**The phone numbers are pending.** This ticket makes the compiler safe to turn on and makes the
build that measures it. The decision waits for the owner's runs on the reference phone (see "On the
reference phone (#1355)"). Nothing in this doc is a phone measurement.

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
- **The flag is one inlined variable.** `EXPO_PUBLIC_WAVE_REACT_COMPILER=1` at bundle time turns the
  compiler on (`app.config.ts`, `experiments.reactCompiler`; #303's `WAVE_REACT_COMPILER` is gone).
  Off by default. The bundle inlines the same variable, so a perf build reports `reactCompiler` in
  its run metadata, `perf.ts run` prints it on the run's first line, and `perf.ts compare` says
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
EXPO_PUBLIC_WAVE_PERF=1 EXPO_PUBLIC_WAVE_COMMIT=$(git rev-parse --short HEAD) \
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

## On the reference phone (#1355)

#1346 moved the decision to the reference phone (Xiaomi 25118PC98G, Android 15; `docs/spec.md` ›
Fluidity), and #1355 runs it on its own commit, so the compiler is judged against the cheap first
frames it would otherwise replace by hand. The compiler stays off until this run says otherwise.
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

Decision: **pending**; the compiler is off.

## Behaviour checks on the compiled build

- Stats: play a song past the counting point with Stats open; its rankings update. Open an
  artist page, rescan after adding one of their songs; the stats block reads again.
- Search online set to Always on Wi-Fi: on mobile data, empty Search, type; Online isn't
  selected. Switch to Wi-Fi, clear the field, type again; it is.
- A genre: select a song, Select All before the whole order arrives; the selection bar's actions
  show once it does.
- The flows #303 listed (detail screens from Home, a section tab and the Library stack; Now
  Playing's artist link; Go to Artist on a streamed song).

## Not covered, and risks

- **Render-time reads of mutable values.** The compiler caches a call on its arguments, so a
  component that reads a module value or a native answer during render (not through
  `useSyncExternalStore` or state) keeps the first answer. `useSearchOnlineAlways` was one; the
  survey can't find the rest, and the behaviour checks are the test. Reads in effects and event
  handlers are unaffected.
- The guard checks names: a memo that reads `a.b` passes with `a` listed, even when `a` is listed
  to mean "when `a.c` changes". The compiler would key that memo on `a.b` alone.
- If the compiler is adopted, hand-written `useMemo`/`useCallback` it covers can go in later
  tickets; the Performance rules still apply either way.
