# Launcher icon colours: cost and fidelity

Research note, 7 November 2026. Question from the owner: the coloured app icon was dropped because
it slowed the build and weighed on the phone; find a cheap way to bring the colours back. Narrowed
during the research: the owner's orange, `#ff5500`, comes out red on the icon. The real question is
how to get an icon that matches that orange without the build and phone costs going up.

Research only. No app code was changed. The scratch scripts behind the numbers are listed under
[Method](#method).

## Summary

- **The colours were never removed from `main`.** `app.config.ts` still applies `withLauncherIcons`
  and `withLaunchSplash`, and the published `v0.58.0-ti` APK holds 625 launcher aliases and 22,499
  splash styles. Details are under [Current state](#current-state-on-main).
- **Almost all of the cost comes from the splash styles, not the icons.** The 22,499 splash styles
  add ~20–33 s to `mergeReleaseResources` on every full build and 1.74 MB to `resources.arsc`. The
  625 icon aliases cost ~0.5 s and ~0.73 MB.
- **The splash list is also built on the phone.** The same 22,499 splash themes are computed in
  JavaScript every time Wave starts, because Core builds them eagerly at module load. That takes
  ~300–600 ms and leaves ~7 MB on the JS heap in a desktop interpreter. This is the most likely
  phone cost. It hasn't been measured on a device yet.
- **`#ff5500` gets red (`vivid29`, `#ff1a1d`) because the palette has no ink between hue 28° and
  hue 59°.** `#ff5500` sits at OKLCH hue 38.8°, nearer red than the amber `vivid59`, so changing the
  matcher's weights can't help.
- **Recommendation:** make the splash list lazy, add two orange inks (`vivid39` `#ff5600` and
  `vivid49` `#ff7600`), and stop making a splash style per ink pair. `#ff5500` then gets `vivid39`,
  ΔE 0.002, under the 0.02 just-noticeable difference. Compared with today, the APK is ~1.6 MB
  smaller, the build ~20 s faster and the startup work is gone. The cost is that the splash's waves
  no longer take the icon's inks.

## Current state on main

- `origin/main` at `1bb1246a` (Release Wave 0.58.0-ti) still applies
  `withLaunchSplash(withLauncherIcons(withShareShortcut(config)))`
  ([app.config.ts:143](../apps/mobile/app.config.ts#L143)). No branch, PR or issue removes them:
  every worktree's `app.config.ts` applies them too, and `gh issue list`/`gh pr list` for
  icon/alias/splash shows only the PRs that added them (#657, #670, #801).
- The published `wave-0.58.0-ti.apk` (79.7 MB) has 625 `activity-alias` entries in its manifest,
  23,774 styles in its resource table (22,499 of them are Wave's `Wl.*` splash styles), 630 mipmaps
  and 1,056 drawables (`aapt2 dump resources` / `dump xmltree`). Its `resources.arsc` is 4,287,336 B,
  stored uncompressed, and its binary `AndroidManifest.xml` is 408,124 B (40,870 B deflated).
- How it works ([docs/spec.md](spec.md), Theme paragraph): 25 inks, so 25 × 25 = 625 aliases, each
  an adaptive icon that layers one top-wave and one bottom-wave drawable
  ([launcherIcons.ts:43](../apps/mobile/plugins/launcherIcons.ts#L43),
  [:106](../apps/mobile/plugins/launcherIcons.ts#L106)). The splash has 36 background pairs × 625
  ink pairs (22,499 styles plus the manifest's), picked with `setSplashScreenTheme`
  ([launchSplashResources.ts:81](../apps/mobile/plugins/launchSplashResources.ts#L81),
  [LaunchThemeStore.kt:57](../apps/mobile/modules/wave-native/android/src/main/java/expo/modules/wavenative/launch/LaunchThemeStore.kt#L57)).
- Possible reasons the owner thinks the colours are gone (not verified): a fresh install defaults
  to white waves (#793), and after a **No** in the "Change the app icon too?" prompt the icon keeps
  its old colours (#792).

## Where the cost comes from

### Build time

| Measurement                                                                                              | Result                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local Gradle A/B, `:app:mergeReleaseResources --rerun`, 8-core machine, `--offline --profile`            | Everything: **21.5 s and 35.6 s**. Splash styles removed, icons kept: **2.1 s and 2.5 s**. Both removed: **1.9 s and 5.0 s** (a warm-up). `processReleaseResources`: 1.8–2.5 s against 1.2–1.6 s. |
| AAPT2 alone (`aapt2 compile` + `link` against `android-37.0`, minimal project with only these resources) | Splash styles: +0.8 s compile, +0.9 s link. Icons: +0.1 s compile, +0.3 s link.                                                                                                                   |
| CI, as PR #657 reported it (36 → 576 icons, 1,296 → 20,736 styles)                                       | "Build release APK" 4m56s → 6m14s (+1m18s), one run each.                                                                                                                                         |
| CI, `main` merge before (#652) and after (#670) the same change                                          | `BUILD SUCCESSFUL in 4m 47s` → `in 3m 59s`.                                                                                                                                                       |
| CI spread of "Build release APK" over 32 full builds on `main`, 23 Oct–6 Nov                             | 202 s to 688 s.                                                                                                                                                                                   |
| CI "Prebuild native project" (every Expo config plugin, including these)                                 | ~6 s.                                                                                                                                                                                             |

The splash styles account for nearly all of the build cost. Gradle's resource merger spends ~20–33 s
on the 5.4 MB `values/styles.xml`, while AAPT2 needs under 2 s for the same file. The icons add about
half a second. CI can't separate the cost from noise: a single before/after pair differs by more
than the cost itself, in either direction. JS-only changes repack the kept APK and compile no
resources (CLAUDE.md), so only full builds pay this.

Gradle's build cache doesn't remove it. The plugin output is deterministic, but any change to the
app's resources or manifest reruns the merge, and that is when a full build happens.

### APK size

From the AAPT2-only experiment (same resources, nothing else in the APK):

| Part                              | `resources.arsc` | Other                                          | APK bytes |
| --------------------------------- | ---------------- | ---------------------------------------------- | --------- |
| Baseline (one style, colours)     | 5.8 KB           | —                                              | 6.5 KB    |
| + 22,499 splash styles            | **1.74 MB**      | —                                              | +1.73 MB  |
| + 625 aliases and 1,250 icon XMLs | 0.16 MB          | manifest 291 KB (27 KB deflated), compiled XML | +0.73 MB  |

Together that's ~2.47 MB, in line with PR #657's measured +2.57 MB for the change to 576 icons. The
splash styles make up ~40% of the shipped 4.29 MB `resources.arsc`. Apps targeting API 30+ must
store `resources.arsc` uncompressed and 4-byte aligned so it can be memory-mapped
([Android 11 behavior changes, "Compressed resource files"](https://developer.android.com/about/versions/11/behavior-changes-11#compressed-resource-file)),
so every one of those bytes counts at full size in the download and on disk.

Unit costs, for sizing options:

- per splash style: ~77 B of `resources.arsc` (1,738,196 B / 22,499) and ~0.9–1.5 ms of
  `mergeReleaseResources`;
- per icon pair (alias, two XMLs, manifest entry with shortcut meta-data): ~1.17 KB of APK.

### On the phone

1. **JS startup work (new finding, needs a device measurement).** Core builds
   `LAUNCH_SPLASH_THEMES` as a top-level constant
   ([launchTheme.ts:152](../packages/core/src/launchTheme.ts#L152)): 36 × 625 calls to
   `paletteSplashThemeFor`, each one correcting colours per mode. Only the prebuild plugin needs that
   list. The app imports the same module for `launchTheme`, which `apply` calls on every start
   ([theme.ts:88](../apps/mobile/src/settings/theme.ts#L88)), so the list is built at every launch.
   Measured with Node `--jitless`, an interpreter on a desktop CPU and the closest local stand-in for
   Hermes:
   - Core's index evaluates in 404–739 ms with the list, against 60–121 ms with it replaced by `[]`;
   - building the list again in a loop takes 91–126 ms;
   - retained heap is +8.3 MB with the list, against +1.4 MB without it (`--expose-gc`).

   A mid-range phone running Hermes is likely slower than this desktop. The real figure needs a
   Hermes profile or `am start -W` on the emulator. The cost grows with 36 × inks².

2. **Resource table.** The 4.29 MB `resources.arsc` is memory-mapped, so only the pages a lookup
   touches are read. The splash is drawn by the system's shell, which builds a package context for
   Wave on each cold start
   ([SplashscreenContentDrawer.java:150-190](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/WindowManager/Shell/src/com/android/wm/shell/startingsurface/SplashscreenContentDrawer.java)).
   Not measured.
3. **Manifest.** The 408 KB binary manifest is parsed by PackageManager on install and update. Not
   measured. The alias switch itself is cheap after 0b274c54: the switcher remembers the alias it
   applied and does nothing when the target matches. An actual switch still checks the state of all
   625 aliases (`isEnabled` for each,
   [LauncherAliases.kt:28](../apps/mobile/modules/wave-native/android/src/main/java/expo/modules/wavenative/launcher/LauncherAliases.kt#L28)),
   up to two binder calls each, on a background worker.

## Why `#ff5500` comes out red

What the app shows for `#ff5500` (Core's `themeFor`, as primary or secondary): **`#ff5500` on every
dark background** (OKLCH L 0.676, C 0.217, h 38.8°) and **`#b93e00` in light mode** on Fog (L 0.534,
C 0.169, h 39.7°). The icon is on black, so it should match the dark tone, `#ff5500`. That is also
the colour the matcher compares ([inkPalette.ts:121](../packages/core/src/inkPalette.ts#L121)).

The rule ([inkPalette.ts:121-141](../packages/core/src/inkPalette.ts#L121)): white when L ≥ 0.9 and
C ≤ 0.06; otherwise the nearest of the other 24 inks by `inkDistance`, which gives hue full weight
and L and C half weight ([themeChoice.ts:370](../packages/core/src/themeChoice.ts#L370)), with only
presets considered below chroma 0.12. `#ff5500` has chroma 0.217, so every ink is a candidate.

| Ink                  | Colour on the icon             | Matcher distance | ΔEOK to `#ff5500` |
| -------------------- | ------------------------------ | ---------------- | ----------------- |
| **vivid29 (chosen)** | `#ff1a1d` L0.635 C0.251 h28.1° | **0.051**        | 0.069             |
| coral                | `#f5917e` L0.757 C0.125 h31.6° | 0.065            | 0.125             |
| vivid59              | `#ff8e00` L0.754 C0.178 h59.2° | 0.082            | 0.112             |
| rose                 | `#f08cb0` h357.6°              | 0.132            | 0.168             |
| ember                | `#f5b83d` L0.819 C0.150 h80.8° | 0.151            | 0.204             |
| vivid359             | `#ff008b`                      | 0.165            | 0.171             |
| gold                 | `#e8c454` L0.831 C0.135 h91.3° | 0.175            | 0.232             |

ΔEOK is plain Oklab distance. One just-noticeable difference is 0.02
([CSS Color 4, gamut mapping](https://www.w3.org/TR/css-color-4/#css-gamut-mapping)).

**Cause:** the palette has no vivid ink between 28° (pure red) and 59° (amber), and that is where
red turns into orange. Coral (31.6°) is a pastel. `#ff5500` is 10.7° from `vivid29` and 20.4° from
`vivid59`, so the hue-weighted distance and plain Oklab distance both pick red. No reweighting fixes
this.

The same happens to other oranges (sweep over named hexes and OKLCH hue 40–75° at L 0.65/0.72/0.80
and C 0.12/0.16/0.20):

- Red-oranges below ~43°, at high chroma, get **red** (`vivid29`): `#ff5500`, `#ff4500` (orangered),
  `#ff5722`, `#f4511e`, `#ff4f00`, `#ff3d00`, `#e65100`, `#ea580c` (Tailwind orange-600),
  `#ff5f1f`.
- At medium chroma or lightness they get **coral** (salmon, ΔE 0.05–0.12): `#ff6600`, `#ff7043`,
  `#ff7f50`, `#c2410c`, `#dc692e`.
- From ~44° to ~65° they get `vivid59` (`#ff8e00`), ΔE 0.02–0.06 for vivid tones, and up to 0.12 for
  dark, muted ones such as `#c97847`.
- From ~67° they get ember.
- Today the worst ΔE over full-saturation oranges from 32° to 70° is 0.111.

## What Android allows

- **A launcher icon can't take a colour at runtime.** Launchers load an app's icon through
  `PackageManager.getDrawable`, which calls `r.getDrawable(resId, null)` with no theme
  ([ApplicationPackageManager.java:1820-1840](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/ApplicationPackageManager.java)),
  so a `?attr/` colour in an adaptive icon or vector resolves to nothing. `<activity-alias>` has no
  `android:theme`; its attributes are `enabled`, `exported`, `icon`, `intentMatchingFlags`, `label`,
  `name`, `permission` and `targetActivity`
  ([activity-alias element](https://developer.android.com/guide/topics/manifest/activity-alias-element)).
  Resources are fixed at install.
- **Runtime resource overlays don't reach the launcher.** Since API 34 apps can register
  "self-targeting" fabricated overlays
  ([FabricatedOverlay](https://developer.android.com/reference/android/content/om/FabricatedOverlay),
  [OverlayManager](https://developer.android.com/reference/android/content/om/OverlayManager)). In
  AOSP a self-targeting commit never goes to the system service: it writes `.frro` files under the
  app's private `getDir(".self_target", MODE_PRIVATE)`
  ([OverlayManager.java:346-356](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/content/om/OverlayManager.java),
  [OverlayManagerImpl.java:146-179](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/com/android/internal/content/om/OverlayManagerImpl.java)).
  The launcher, in another process, never sees them. System-wide overlays need privileged
  permissions.
- **Themed icons are tinted by the system,** from "the coloring of the user's chosen wallpaper and
  theme" ([Adaptive icons](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive)).
  Wave can't choose that tint.
- **Pinned shortcuts can carry any bitmap.** `requestPinShortcut` sends the request to the default
  launcher, which "will … ask the user for approval"; only a foreground app can call it, and a `true`
  result doesn't mean the shortcut was pinned
  ([ShortcutManager.requestPinShortcut](<https://developer.android.com/reference/android/content/pm/ShortcutManager#requestPinShortcut(android.content.pm.ShortcutInfo,%20android.content.IntentSender)>)).
  `Icon.createWithAdaptiveBitmap` gives it the adaptive mask
  ([Adaptive icons](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive)).
  AOSP Launcher3 attaches the owning app's icon as badge info to shortcut icons
  ([IconCache.java:263](https://android.googlesource.com/platform/packages/apps/Launcher3/+/refs/heads/main/src/com/android/launcher3/icons/IconCache.java)).
  Whether a badge is drawn on Pixel or One UI is unverified.
- **Switching aliases and the home screen.** The spec records that the launcher drops the
  home-screen icon on a switch (seen on One UI). AOSP Launcher3 `main` handles a component removed in
  a package update by first pointing the home-screen item at the package's new launch intent, and
  only then removing items that still point at removed components
  ([PackageUpdatedTask.java:297-300, 406-411](https://android.googlesource.com/platform/packages/apps/Launcher3/+/refs/heads/main/src/com/android/launcher3/model/PackageUpdatedTask.java)).
  So a launcher built on current Launcher3 may keep the icon. This is unverified on a Pixel; One UI
  is closed source.
- **Splash.** `setSplashScreenTheme` takes a style resource and persists it by name
  ([SplashScreen.setSplashScreenTheme](<https://developer.android.com/reference/android/window/SplashScreen#setSplashScreenTheme(int)>)),
  so each colour combination on the splash needs a style. When `windowSplashScreenAnimatedIcon` isn't
  set, the splash shows the launching activity's icon: "The launcher icon is the default"
  ([Splash screens](https://developer.android.com/develop/ui/views/launch/splash-screen)), and in
  code the shell calls `mHighResIconProvider.getIcon(mActivityInfo, …)`
  ([SplashscreenContentDrawer.java:597-615](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/WindowManager/Shell/src/com/android/wm/shell/startingsurface/SplashscreenContentDrawer.java)).
  A launch through an alias should therefore show that alias's coloured icon with no per-ink style.
  This is unverified on a device.

## Options

Costs are against today (25 inks, 625 aliases, 22,499 splash styles). Each extra ink adds
2N + 1 pairs; the splash adds 36 styles per pair.

| #   | Option                                                                                    | `#ff5500` gets              | ΔEOK      | Build      | APK       | Phone                                                        | Home-screen icon             |
| --- | ----------------------------------------------------------------------------------------- | --------------------------- | --------- | ---------- | --------- | ------------------------------------------------------------ | ---------------------------- |
| 0   | Today                                                                                     | vivid29 `#ff1a1d` (red)     | 0.069     | —          | —         | ~0.3–0.6 s JS and ~7 MB heap per start (desktop interpreter) | dropped on switch (One UI)   |
| 1   | Build the splash list only in the plugin (make `LAUNCH_SPLASH_THEMES` lazy or a function) | unchanged                   | —         | 0          | 0         | removes the startup work and heap                            | unchanged                    |
| 2   | Matcher change only, e.g. don't cross into red above hue ~35°                             | vivid59 `#ff8e00` (amber)   | 0.112     | 0          | 0         | 0                                                            | unchanged                    |
| 3   | Add `vivid44` `#ff6800` (26 inks)                                                         | vivid44                     | 0.033     | +1.6–2.7 s | ~+0.20 MB | +51 aliases, +1,836 styles                                   | unchanged                    |
| 4   | Add `vivid39` `#ff5600` and `vivid49` `#ff7600` (27 inks)                                 | vivid39 `#ff5600`           | **0.002** | +3.2–5.6 s | ~+0.41 MB | +104 aliases, +3,744 styles                                  | unchanged                    |
| 5a  | Splash styles per background pair only (36), waves in a fixed colour                      | splash: fixed colour        | —         | ~−20–33 s  | ~−1.7 MB  | —                                                            | —                            |
| 5b  | Splash shows the alias icon (no animated icon), 36 styles                                 | splash: the icon's own inks | —         | ~−20–33 s  | ~−1.7 MB  | —                                                            | —                            |
| 6   | Pinned shortcut with a bitmap drawn at runtime, as an extra                               | exactly `#ff5500`           | 0         | 0          | ~0        | one bitmap                                                   | a shortcut, not the app icon |

Notes on each:

1. **Lazy splash list.** No visual change and no build change. The plugin keeps calling the same
   generator. Measure on a device before and after.
2. **Matcher change alone** can't fix `#ff5500`. The only non-red ink nearby is amber, 20° away and
   5.6 JNDs off.
3. **One extra ink, `vivid44`** (the nearest full-saturation sRGB colour to OKLCH 44°). The worst ΔE
   over full-saturation oranges from 32° to 70° drops from 0.111 to 0.053. `#ff4500` still gets
   `vivid29` (ΔE 0.045).
4. **Two extra inks, `vivid39` and `vivid49`.** Worst orange ΔE drops to 0.046. `#ff5500`, `#ff4500`
   (0.025), `#ff5722` (0.010), `#ff6600` (0.028) and `#ea580c` (0.039) get `vivid39`; `#f97316`
   (0.014), `#ff7a00` (0.008) and `#ff8000` (0.021) get `vivid49`. Append the inks after white, as
   #793 did for white: style names count palette places, and alias names use ink ids, so no existing
   name moves. Existing users keep their stored icon, since the icon only changes through the prompt
   (spec, Theme paragraph). A third ink (37°/44°/51°) brings no further gain.
5. **Decouple the splash from the ink pairs.** This removes ~97% of the splash styles and almost all
   of the build cost, and the splash list stops growing with inks².
   - **5a** keeps the moving logo, but its waves lose the icon's inks.
   - **5b** keeps the inks, but shows a still adaptive icon: a black disc with the waves on a Fog
     ground.

   Either way the splash work stops tying ink count to cost. 5b needs a device check that a launch
   through an alias shows that alias's icon.

6. **Pinned shortcut.** Exact colour, no build cost. The cost is UX: a confirmation dialog, possibly
   an app badge, the drawer icon still the alias, and nothing on launchers without pin support
   (`isRequestPinShortcutSupported`). Worth offering as "Add a home-screen icon in my exact colours",
   not as the main icon.

Not viable: `?attr/` colours or theme overlays in the icon (no theme when the launcher loads it),
self-targeting overlays (in-process only), themed icons (the system picks the tint), and recolouring
or swapping one of the existing 25 inks. That would silently change the icon for anyone already on
the ink, and an update that removes the enabled alias leaves Wave out of the drawer until it next
runs.

## Recommendation

Do 1, 4 and 5 together:

1. Build `LAUNCH_SPLASH_THEMES` only in the prebuild plugin. This is the phone fix and changes
   nothing visible.
2. Add `vivid39` (`#ff5600`) and `vivid49` (`#ff7600`) after white. `#ff5500` gets `#ff5600`,
   ΔE 0.002. The icon matches the orange, not red.
3. Cut the splash to one style per background pair: 36 instead of 22,499. Choose between 5a (moving
   logo, fixed colours) and 5b (the icon's inks, still) after the device check below.

Net effect against today:

- icons: 729 aliases, ~0.85 MB;
- splash: ~2.8 KB instead of 1.74 MB;
- APK: ~1.6 MB smaller;
- `mergeReleaseResources`: ~20–30 s faster;
- startup: no splash list.

The only loss is the splash's per-ink waves (5a) or their motion (5b).

If the owner wants the splash to keep per-ink waves and motion, do 1 and 4 only: +0.41 MB and
+3–6 s per full build. With step 1 done, phone cost stays flat, since the extra styles only cost
APK bytes.

Option 6 can come later as an extra for exact colours.

### Measure before adopting

- **Startup** (emulator, labelled as emulator results; phone if one is available): with and without
  the lazy list, `am start -W` cold `TotalTime` over ≥10 runs, a Hermes sampling profile of the first
  `apply`, and JS heap after start.
- **Splash 5b**: launch through a non-default alias on Android 13+ and confirm the splash shows that
  alias's icon. Check how it looks on the Fog ground.
- **Home-screen icon on a Pixel launcher**: does it survive a switch, as AOSP Launcher3 suggests?
- **Full build** on CI: three runs before and three after, comparing `BUILD SUCCESSFUL in`, since
  single runs vary by minutes. Locally, `mergeReleaseResources --rerun --profile` as below.
- **APK**: `resources.arsc` size and APK size from the CI "Measure the APK" step.

## Method

- Repo state: `git log origin/main`, `gh issue view 653 655 656 790 792 793`,
  `gh pr view 657 801`, plus a check of every worktree's `app.config.ts`.
- APK: `gh release download v0.58.0-ti`, then `aapt2 dump resources` and `aapt2 dump xmltree`
  (build-tools 37.0.0), and `unzip -lv`.
- AAPT2 microbenchmark: a minimal project with the generated `Wl.*` styles, colours, icon XMLs and
  aliases from `apps/mobile/android/` (shortcut meta-data stripped), compiled and linked against
  `android-37.0`, three runs per variant.
- Gradle A/B: `ANDROID_HOME=~/Android/Sdk ./gradlew :app:mergeReleaseResources --rerun
:app:processReleaseResources --rerun --offline --profile` in `apps/mobile/android/`. For the A/B,
  the generated `styles.xml`, icon files and manifest were removed temporarily and then restored;
  the restore was checked by checksum. `android/` is generated and gitignored.
- CI timings: `gh run list --workflow ci.yml --branch main` and the job logs of #652, #670 and
  #983.
- Colour numbers: scratch scripts calling Core's public `inkPairFor`, `themeFor`, `chooseCustomInk`
  and `INK_PALETTE`, plus `toOklch` and `inkDistance` from Core's source. A candidate ink is the
  nearest `#ff??00` colour to the target OKLCH hue, put through the same `chooseCustomInk` correction
  that `INK_PALETTE` applies to the vivid tones.
- JS cost: Core bundled with esbuild and run under `node --jitless` (an interpreter on a desktop CPU,
  not Hermes), with and without `LAUNCH_SPLASH_THEMES`; heap measured with `--expose-gc`.

Unverified: everything about a real phone (Hermes timing, `resources.arsc` load cost, manifest
parse time), Pixel and One UI home-screen behaviour on a switch, the splash using the alias icon,
and whether Launcher3 draws a badge on pinned shortcuts.
