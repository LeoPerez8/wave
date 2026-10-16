# #317 App-specific ART profiles: the pipeline, a sideload finding, the measurement plan

Ticket: #317 (parent #301). Branch `feat/317-android-profiles`, based on `perf/301-performance` at
761375e.

**Generation and every device measurement are pending.** No phone was attached while the ticket
was built (`adb devices` listed none on 2026-10-16), so `apps/mobile/profiles/` doesn't exist yet
and the APK still ships only its libraries' profiles. No device numbers are recorded here, and
none were invented. What this branch does ship on its own is the profileinstaller fix below.

## What the APK ships today

`perf.ts profile check-apk` on a local release build of main (2026-10-13, R8 on, with its
`mapping.txt`):

```
ok   assets/dexopt/baseline.prof is in the APK
ok   assets/dexopt/baseline.profm (needed on Android 12+) is in the APK
     291 classes, 637 methods (562 hot, 562 startup, 637 post-startup)
     classes by origin: androidx 172, other 38, media3 27, kotlin 25, react 23, expo 5, wave 1
```

These are the AndroidX library profiles (1,387 rules before R8, 928 after), rewritten by R8.
Nothing covers Wave's own code paths: the React Native bridge and Fabric classes it uses, the
Expo modules, wave-native, Media3 playback. There is no startup profile, so R8 lays out
classes.dex without knowing what launch loads.

## Finding: on current Android the shipped profile was never installed

A sideloaded APK gets no profile from a store. `androidx.profileinstaller` fills that gap: once
the app has started, it writes `assets/dexopt/baseline.prof` into ART's current profile, and the
phone's idle compile (charging, screen off) then compiles those methods ahead of time.

Wave got profileinstaller 1.3.1 through its libraries. Its `DeviceProfileWriter.desiredVersion()`
returns nothing above API 34 (read from the 1.3.1 bytecode with `javap`), which ends the install
with `UNSUPPORTED_ART_VERSION`. On Android 15 and 16, the APK's profile was therefore dead
weight. 1.4.1 has no ceiling: from API 31 up it writes the S format. `withArtProfiles` pins
`androidx.profileinstaller:profileinstaller:1.4.1` in `app/build.gradle`. This fix doesn't depend
on generating anything, and it also makes the AndroidX profile reach the phone.

Still to confirm on the S24+ with `perf.ts profile device`: its Android version, and the state a
sideload reaches (below).

## What was built

- **`apps/mobile/plugins/withArtProfiles.ts`** (pure part and tests in `artProfiles.ts`). At
  prebuild it copies `apps/mobile/profiles/baseline-prof.txt` and `startup-prof.txt` into
  `app/src/main/baselineProfiles/`, the source folder AGP 9.2 reads. AGP merges every file there
  except `startup-prof.txt` into the baseline profile it packages in `assets/dexopt/`, and gives
  `startup-prof.txt` to R8 and dex merging for the layout. Since the startup file never joins the
  baseline, the plugin fails prebuild when the startup profile has a rule the baseline lacks, or
  when a line isn't a rule (a merge conflict marker, say). Without the files it copies nothing.
  It also adds the profileinstaller dependency. Prebuild was run with sample profiles to check
  the output: the files land in place and `dependencies {` gets the line once.
- **`perf.ts profile generate`** (`scripts/perf/profileDevice.ts`) captures the profiles on the
  phone. It does what Jetpack Macrobenchmark's `BaselineProfileRule` does on a phone without
  root, with no Gradle test module:
  1. profileinstaller's receiver writes its skip file, so the APK's own (AndroidX) profile
     doesn't end up in the capture; then `cmd package compile --reset` clears ART's profile;
  2. three cold launches, each saved before the next kill (`SAVE_PROFILE` makes the app flush
     what ART recorded; a kill loses anything unsaved); `pm dump-profiles
--dump-classes-and-methods` then gives the **startup profile**;
  3. three journeys, each from a cold launch: every tab, Library › Songs scrolled (a Track list),
     Back, the mini player to Now Playing, Queue scrolled and closed, Close Now Playing, Home ›
     Settings and Back, Search and the keyboard. Their dump, joined with the startup profile, is
     the **baseline profile**;
  4. writes both to `apps/mobile/profiles/` with `profiles.json` (commit, APK hash, phone,
     counts, any journey target it didn't find).

  It refuses an APK that R8 minified: its class names won't match the next build's. Profile an
  unminified release build, which is otherwise what CI ships (same Hermes `-O` bundle, same
  signing). That is the generation variant AGP's Baseline Profile plugin calls
  `nonMinifiedRelease`. CI's release build keeps R8 and Hermes `-O` as they are, and R8 rewrites
  the profile's names to the shipped ones.

- **`perf.ts profile check-apk <apk> [--mapping mapping.txt]`** reads `baseline.prof` and the
  dex files from the APK itself. It decodes the binary profile (the format profileinstaller
  reads), names its classes and methods from the dex, and maps R8's names back with the mapping.
  It then reports how many of the classes in Wave's checked-in baseline that R8 kept are in the
  shipped profile. Below `--min-coverage` (90%) it fails, and so does an APK without
  `baseline.prof` or `baseline.profm`. Checked against real data: decoding that APK's profile
  gives exactly AGP's own text for it (928 rules), and with AGP's pre-R8 profile standing in for
  Wave's, 136 of 136 kept classes are found.
- **CI** runs `check-apk` after every full release build (`Check the APK's ART profile`). A
  repack keeps the kept build's dex and profile, so there is nothing new to check there.
- **`perf.ts profile device [--install]`** prints the compiler filter, its reason and the size of
  the profile ART holds for Wave. `--install` first puts the phone in the comparable state (next
  item).
- **`perf.ts run --compile baseline`** clears the profile, has profileinstaller install the
  APK's own, and compiles `speed-profile`. The run records profileinstaller's result and the
  profile's size as `artProfile`. When the install fails, the APK is compiled with no profile,
  which is also what its sideload gets: a main APK on Android 15+ records
  `UNSUPPORTED_ART_VERSION` and 0 rules. Check `artProfile` in both runs before reading a
  comparison.
- **The `warm-start` scenario**: Home, then Wave's launcher intent while its process lives,
  timed by `am start -W`. The summary reports cold and warm medians apart.
- **`perf.ts profile status`**: when the profiles were generated, and the native changes since.

## Decisions

- **adb capture, not a Macrobenchmark module.** The Gradle route needs a generated
  `com.android.test` module, the `androidx.baselineprofile` plugin on AGP 9.2 and a bundle
  handoff for a second variant in CI. Its output would still have to be checked in, because
  prebuild `--clean` deletes `android/`. The adb route needs only an unminified build and the
  phone. It reuses the runner's target finding, runs on the owner's real Library, and is the
  same mechanism `BaselineProfileRule` uses on API 33+.
- **The profiles are checked in and copied at prebuild.** They're part of the generated
  project, so a change to them changes the native key (`scripts/ci/repack.ts` hashes
  `android/`) and gets a full APK build. A repack can't ship a profile that doesn't match its
  dex.
- **The baseline holds the startup profile.** AGP 9.2 reads `startup-prof.txt` for layout only
  (`BaselineProfiles.shouldBeMergedIntoArtProfile` leaves it out).
- **Dex files are matched by their CRC-32.** The profile keys each dex by the zip entry's
  CRC-32, not the Adler-32 in the dex header (found against the real APK).

## Generating the profiles (pending: needs the phone)

```sh
# 1. An unminified release build of this branch (local build notes; one Gradle build at a time).
cd apps/mobile && npx expo prebuild --clean --platform android --no-install && cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a -Pandroid.enableMinifyInReleaseBuilds=false
cp app/build/outputs/apk/release/app-release.apk /tmp/wave-unminified.apk

# 2. On the S24+, with something in the queue (the journey opens Now Playing).
node scripts/perf/perf.ts profile generate --apk /tmp/wave-unminified.apk --commit $(git rev-parse --short HEAD)

# 3. Commit apps/mobile/profiles/, rebuild the normal release APK, and check what it ships.
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
node scripts/perf/perf.ts profile check-apk app/build/outputs/apk/release/app-release.apk \
  --mapping app/build/outputs/mapping/release/mapping.txt

# 4. Put the owner's ti build back (same signature: data stays).
adb install -r wave-ti.apk
```

`profile generate` installs the unminified APK over the installed app (same signature, data
kept). Check the journey ran: `profiles.json` lists any target it didn't find, and a missed
`Now playing:` means the queue was empty.

## Verifying the sideload (pending: needs the phone)

The ti distribution is an APK downloaded from GitHub and opened with the package installer.
To check, without assuming Play Store behavior:

```sh
adb install -r wave-ti.apk                     # as a sideload: no .dm file, no cloud profile
node scripts/perf/perf.ts profile device       # 1. right after install
#   open Wave, wait 15 s, close it
node scripts/perf/perf.ts profile device       # 2. after profileinstaller ran
#   leave the phone charging and idle overnight, or force the idle compile:
adb shell cmd package bg-dexopt-job
node scripts/perf/perf.ts profile device       # 3. after the idle compile
```

Expected with this branch, to be confirmed: (1) `verify` or `speed-profile` with reason
`install`, little or no profile; (2) a profile about the size of the shipped one; (3)
`speed-profile` with reason `bg-dexopt`. With profileinstaller 1.3.1 on Android 15+, (2) should
stay empty: run the same steps on a main APK to record the before. Record the three states for
both APKs here.

AGP also writes `.dm` files next to the APK (`outputs/apk/release/baselineProfiles/`).
`adb install-multiple app-release.apk app-release.dm` would compile with the profile at install
time, but the owner installs from the package installer, so the `.dm` route doesn't describe
ti.

## Measuring (pending: needs the phone)

Before: a perf build of `perf/301-performance` without this ticket, which ships AndroidX's profile
and profileinstaller 1.3.1. After: a perf build with the generated profiles. Same phone, fixture
and refresh rate, both installed with `adb install -r`.

```sh
for state in baseline verify speed; do
  node scripts/perf/perf.ts run --apk wave-before.apk --compile $state --label 317-before-$state \
    --scenario startup,warm-start,tab-switch,push-tracklist,now-playing,queue
  node scripts/perf/perf.ts run --apk wave-after.apk --compile $state --label 317-after-$state \
    --scenario startup,warm-start,tab-switch,push-tracklist,now-playing,queue
done
node scripts/perf/perf.ts compare perf-results/317-before-baseline-*.jsonl perf-results/317-after-baseline-*.jsonl
```

- `baseline` is the comparison that matters: each APK compiled with only the profile it ships.
- `verify` (no ahead-of-time code) and `speed` (all of it) are controls. Neither depends on the
  profile, so before and after should match there. If they don't, something other than the
  profile changed between the APKs.
- Native ART against Hermes: a profile only changes how ART runs Java and Kotlin. Hermes runs
  precompiled bytecode. In the perf build, React Native's startup timings (`appStartup`) split
  launch into native startup and the JS bundle's run. One `--perfetto` pass per APK (`--compile
baseline`) shows the main thread (`bindApplication`, `activityStart`, `Choreographer#doFrame`)
  apart from the JS thread (`mqt_v_js`). A profile gain should shrink main-thread and binder
  slices, and leave `mqt_v_js` slices and the JS share of `appStartup` unchanged.

Record the headers, the `compare` tables for all three states, the trace attribution and the
results files (`docs/performance/results/`) here.

## When to refresh the profiles

A profile names classes and methods. When they change, the rules for them stop matching and AGP
drops them silently. `check-apk` in CI then reports a falling share, and fails below 90%.
Regenerate after:

- a React Native, Expo, Media3 or other native dependency upgrade (`pnpm-lock.yaml`,
  `apps/mobile/package.json`);
- a change to wave-native or wave-glass Kotlin code that launch or the journey runs;
- a change to what launch or the journey does: a new tab, a new native view on those screens;
- the CI check failing on coverage.

`node scripts/perf/perf.ts profile status` lists the native changes since the profiles' commit.
JS-only changes don't need a refresh unless they change which native code those screens use.

## Behavior kept

- R8 stays on (`android.enableMinifyInReleaseBuilds`) and Hermes keeps `-O`. Generation turns R8
  off only for the build it profiles, from the command line.
- The native-key and full-build policy is unchanged. The plugin's output lives in the generated
  project, which the key hashes, so new profiles mean a full build.
- Tests: `node --test "scripts/perf/*.test.ts" "scripts/ci/*.test.ts"` (68 perf tests, among them
  the profile decoder against AGP's real profile and generation, `--compile baseline` and warm
  launch on the simulated phone). In `apps/mobile`, the plugin's tests (`plugins/artProfiles.test.ts`).
  Typecheck of the app, `scripts/perf` and `scripts/ci`.

## Not measured, and limits

- Everything on the phone: generation, the sideload states, launch and navigation timings.
  **Pending.**
- The packaging path was checked with a local release build (R8 on, arm64) and stand-in profiles,
  not generated ones: six hand-written rules for `MainActivity`, `MainApplication`,
  `WaveNativeModule` and `WaveNativePackage`, three of them in the startup profile. The release
  classpath resolved `profileinstaller:1.4.1` and nothing older. `check-apk` reported
  318 classes and 650 methods, against 291 and 637 before, with Wave's own classes up from 1
  to 6. All 4 stand-in classes R8 kept were in the shipped profile, and both kept startup
  classes were in classes.dex. The stand-ins weren't committed. This shows that the plugin, AGP
  and R8 carry a checked-in profile into the APK. It says nothing about speed.
- `pm dump-profiles` output was read from what Macrobenchmark parses, not yet seen from One UI.
  If it holds lines the parser rejects, `generate` drops them. Check the counts in
  `profiles.json` against `profile device` on the first run.
- The coverage check counts classes, not methods. Method names change under R8 in ways the class
  mapping doesn't cover.
