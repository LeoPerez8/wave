# Palette splash handoff (#656)

Base: local `feat/653-custom-colour-icon` at `a8b277d7` (includes #654).
Implementation branch: `feat/656-palette-splash`.

`LAUNCH_SPLASH_THEMES` now enumerates all 36 background pairs and 576 palette
ink pairs. The manifest supplies the default, leaving 20,735 named styles.
`launchTheme` selects through `paletteSplashThemeFor` while retaining the
app's actual custom colours in its `light` and `dark` values.

Style names encode the four catalog positions in base 36, e.g. `Wl.0.0.i.c`
for Fog, True black, vivid cyan and vivid red. Each is ten characters long.
The plugin shares a colour resource whenever both mode tones match, including
between the two waves. All styles inherit the same animated logo drawable
and set its existing two theme attributes. The manifest default retains the
shipped app colours. Animation and Remove animations behavior are unchanged.

Core reuses a palette ink's correction for each mode and background across
the catalog. This avoids deriving a full app theme for every ink pair.
Launcher icon generation, settings and native launcher code were not edited.

## Local cost measurements

Measured on 24 October 2026 with Node v26.8.2 and cached workspace dependencies.
The baseline source was archived from `a8b277d7` into a temporary directory
with its own Core workspace link. Both versions ran the same harness:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/scripts/measure-launch-splash.ts
```

The harness invokes `withLaunchSplash` through Expo's `compileModsAsync` in a
temporary Android project. It includes the actual XML reads, formatting,
resource merges, drawable generation and file writes. Each run restores the
same input resources. One first run precedes seven measured warm runs.
Other prebuild plugins are excluded. Local timings vary with machine load.

- `values/styles.xml`: 463,398 bytes before; 5,128,216 after (+4,664,818).
- `values/colors.xml`: 30,620 bytes before; 3,084 after (-27,536).
- `values-night/colors.xml`: 30,620 bytes before; 3,084 after (-27,536).
- Total source XML: 524,638 bytes before; 5,134,384 after (+4,609,746).
- Named palette styles: 1,295 before; 20,735 after. The measured styles file
  also includes the manifest splash and AppTheme.
- Generated colour resources per mode: 470 before; 80 after. The measured
  colours files also contain one pre-existing splash background.
- Median warm plugin mods: 39.3 ms before; 552.8 ms after (+513.5 ms).
  Warm runs ranged from 35.1 to 55.4 ms before and 357.9 to 607.4 ms after.
- Plugin module import, including Core initialization: 512.8 ms before;
  436.5 ms after. First mods run: 91.5 ms before; 521.1 ms after.

These measurements cover source resources and prebuild. APK size and full
Android build deltas still need CI verification against the +5 MB and
+2 minute limits in #653/#656. The baseline `:app:assembleRelease` attempt
failed during configuration with `SDK location not found` after 4m 31s;
there is no successful baseline APK or full build duration to compare.

## Verification

The cyan/red regression failed first with `teal` instead of `vivid209`, then
passed with dark splash inks `#00e5ff` and `#ff1a1d`. The light splash uses
`#007380` and `#d20003`. The app's launch colours still carry the actual
custom inks `#00e9ff` and `#ff1f13` in dark mode.

Core tests cover catalog uniqueness and completeness, runtime selection,
compact style names, defaults, presets and readability. Mobile tests resolve
every generated style in both modes, check colour deduplication and repeat
runs, and retain the single drawable and handoff checks.

Both typechecks and Android prebuild pass. The initial Core suite had one
timing failure in the existing 50,000-song search test while Gradle and both
test suites competed for CPU; it passed 3,473 of 3,474 tests. The serial rerun
passed all 3,474 tests. Mobile passed 837 tests, with one benchmark variant
skipped because `WAVE_BENCH_BEFORE` was unset.

```sh
pnpm --filter @wave/core test --test-concurrency=1
pnpm --filter @wave/mobile test
pnpm --filter @wave/core typecheck
pnpm --filter @wave/mobile typecheck
pnpm --filter @wave/mobile prebuild --no-install
```

Formatting, lint for the implementation files, and `git diff --check` pass.

The Android 13+ phone cold-start check with cyan/red, animation and Remove
animations remains manual. This environment has no Android SDK.
