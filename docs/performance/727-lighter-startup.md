# #727 Lighter startup: load on first use, no Skia in Now Playing, cached connectivity, async scan start

Ticket: #727 (parent #712). Branch `feat/727-lighter-startup`, based on
`origin/feat/712-faster-lighter` at a0bbabd3.

## What changed

- **Inline requires.** `metro.config.js` turns Metro's `inlineRequires` on (Expo's default
  leaves it off). An import now loads where its binding is first read, so a module the first
  screen never touches isn't evaluated at launch. Side-effect-only imports (`global.css`,
  `@/settings/theme`, `startAppLog`) still load in place.
- **Hosts load their screens on first use.** The root layout mounts three light hosts:
  `share/SongShareLayer.tsx`, `library/PhotoCropperHost.tsx` and
  `library/YtLibraryPickerHost.tsx`. Each holds its store, its opener and the host; the screen
  (`SongSharePreview` with its Skia card, `PhotoCropper`, `YtLibraryPicker`) loads the first
  time it opens. Now Playing stays mounted at launch, as #305 decided; its lyrics card host
  (`share/LyricCardLayer.tsx`) likewise loads `LyricCardPreview` and its Skia card only when a
  lyrics card opens.
- **Services are built on first use.** `lib/lazyService.ts` gives a layer whose implementation is
  built at the first read of one of its members, behind the same `Context.Service` interface.
  Spotify (`spotify/spotifyLive.ts`, its error in `spotify/SpotifyError.ts`), Stats and Recap (`stats/statsLive.ts`) and Wave account
  sync (`sync/waveSyncLive.ts`) use it. Signed out, `startSync` doesn't build `WaveSync` at
  all (it waits for a signed-in session), so `waveSyncLive` and the sync cycle never load. Lyrics translation needed no change: its storage
  and request already sit in closures that run only while translation is on, so inline requires
  load them on first use.
- **Now Playing's gradient without Skia.** `nowPlaying/Background.tsx` draws the ground as two
  views with React Native's `backgroundImage` linear gradient: an opaque base and the incoming
  colours fading in over it (opacity on the UI thread). Core's `crossfadeGround` decides the
  layers. A change mid-fade starts from the colours on screen: the two layers blended where they
  are, which is itself a two-stop gradient. Each change mounts the incoming layer anew at opacity
  0 in the same commit as its colours, so no frame shows new colours at an old opacity. The
  Queue's sticky bar draws the same layers. Skia stays for the share cards and Settings' colour
  picker; the startup path reads none of its bindings, so inline requires never load it there.
- **Connectivity is cached natively.** `net/Connectivity.kt`'s `AndroidConnectivity` keeps one
  process-wide `ConnectivityCache`, updated by a default-network callback. Every native check
  (YT Music, Soulseek, Spotify, the Wave account, pre-downloads) reads it instead of asking
  `ConnectivityManager`. JS reads it once (`WaveNative.connectivity()`), then follows
  `onConnectivityChanged` in `native/connectivityStore.ts`. `online()` and `onMobileData()` read
  that store and never cross to native.
- **`startScan` is async.** JS numbers its scans and passes the number in, so events that arrive
  before the start resolves already belong to the scan. Native indexes the known-file lists off
  the JS thread. `ScanSlot` lets only the newest scan run: a start that arrives late never
  replaces a newer one. A cancel waits for its scan's start to resolve. The scanner's batch is
  the JS save slice, 100 files (Core's `SCAN_SAVE_SLICE`, `LibraryScanner.SAVE_SLICE`), so
  each batch is one save transaction. #726's medium covers are made in the same batch pass as
  before.
- **`respondAuto` is async.** An Android Auto answer can list a whole shelf. It now crosses to
  native off the JS thread; a failure to deliver it falls back to `failAuto`.

No blocking native call left in this ticket's scope carries a collection. `saveQueue` and
`savedQueue` belong to #720.

## Budgets and scenarios

- **Cold launch:** `startup` (`am start -W` TotalTime, startup frames, retained memory) and
  `now-playing-first`. Budget: no regression against #546's cold launch on the same S24+, and
  the startup JS bundle evaluation (Perfetto `--perfetto`, the `RunJSBundle` slice) shorter than
  before. #713 sets the spec's launch budget; once it lands, compare against that.
- **First share, first crop:** within the existing 100 ms card budget (`TIMING_BUDGETS`) to the
  first frame, on the first open after a launch. No `scripts/perf` scenario drives them yet:
  record a perf build with `--perfetto` on a hand run (Share in Now Playing; Library › a
  playlist › Change Image) and compare the first open before and after.
- **Gradient:** a screen recording of three quick skips with Now Playing open, before and after,
  compared frame by frame. At rest the colours must be identical. Mid-fade, a crossfade of two
  layers blends in sRGB, while the old Skia path interpolated with Reanimated's
  `interpolateColor`. Compare the mid-fade frames.
- **Scan:** `rescan-return` (the launch rescan with a tap during it), plus `push-tracklist` with
  `--variant import`, for the 100-file batches.

```sh
node scripts/perf/perf.ts run --scenario startup,warm-start,now-playing-first,rescan-return --label 727-before --perfetto
node scripts/perf/perf.ts run --scenario startup,warm-start,now-playing-first,rescan-return --label 727-after --perfetto
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

Use `--compile baseline` on both runs: inline requires change which code runs at launch, so
the ART profile's coverage can differ.

## Before (a0bbabd3)

**Pending the owner's S24+ run.** Record the APK, SHA, fixture, refresh rate, compiler filter,
raw JSONL and summary here.

## After

**Pending the owner's S24+ run.** Record the same metadata, raw JSONL and comparison here.

## Desktop evidence

- Core: `groundCrossfade.test.ts` (settled, finished, mid-fade and instant changes), with
  `palette.test.ts`.
- App: `perf/startupGuards.test.ts` (Metro's inline requires on; the root layout imports no
  share, cropper or picker screen; `nowPlaying/` imports neither Skia nor the lyrics card's
  preview), `lib/lazyService.test.ts` (the
  runtime starts without building a lazy service; the first use builds it once, with its
  dependencies, behind the same interface), `native/connectivityStore.test.ts` (one native read,
  then pushes; listeners; the fallback without a module). The sync, Stats, startup-job,
  theme-lookup and performance-guard suites pass. The whole-Library exception for
  `readListeningPages` moved with it to `statsLive.ts`.
- Kotlin: `ConnectivityCacheTest`, `ScanSlotTest` and a `LibraryScannerTest` case for the
  default 100-file batches. **These were written but not compiled or run**: this worktree has no
  Android SDK. Compile them on the owner's build machine or CI.

## Not done, and why

- **Android resource shrinking was not tried.** AGP shrinks resources only with R8
  minification on, which the release build doesn't use yet. Turning it on needs keep rules
  checked for the Expo modules, Kotlin reflection and the YT Music client, and an APK build to
  run the release checks against. Neither is possible here. Try it in a separate run on a
  machine that can build the release APK.
- **No phone checks.** The gradient's look, Now Playing's open, the first share and crop, Android
  Auto browsing and scans on a large Library are unverified on the S24+. Inline requires change
  module evaluation order. A module whose side effects something else relied on at launch would
  show up there, as a missing listener or registration.
