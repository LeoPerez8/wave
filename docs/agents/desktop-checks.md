# Checking desktop tickets without the owner

Drive the built app with Playwright's Electron support (`apps/desktop/e2e`): launch it, click,
read the page and take screenshots, on Windows and on Linux under WSLg. Label every result with
the system and the commit. Audio is checked by the engine's tests, not by ear.

## Commands

From the repo root:

```sh
pnpm --filter @wave/desktop typecheck
pnpm --filter @wave/desktop test       # node:test units in src/
pnpm --filter @wave/desktop lint
pnpm --filter @wave/desktop test:e2e   # builds out/, then runs the Playwright smoke test
pnpm --filter @wave/desktop dev        # the app with hot reload
```

`test:e2e` builds first, so it always drives the current code. Screenshots and failure traces go
to `apps/desktop/test-results/`, which git ignores; read the PNGs to check what the window
shows. Add a check as a test in `apps/desktop/e2e/` rather than a throwaway script, so CI runs
it too.

## The audio engine

The engine is Rust in `apps/desktop/native` (Symphonia decodes, cpal plays), loaded as a Node
addon by the audio utility process (`src/main/audio/process.ts`). It needs Rust (stable), CMake
(libopus builds from source) and, on Linux, ALSA's headers (`libasound2-dev`).

```sh
cargo test --manifest-path apps/desktop/native/Cargo.toml   # decoding and seeking golden tests
pnpm --filter @wave/desktop build:native                     # builds native/wave-audio.node
```

Build the addon before `test:e2e`: without it the app runs, but every player call fails with
`[unavailable]`. `WAVE_AUDIO_ADDON` points main at another build. `e2e/audio.spec.ts` plays each
fixture in `native/engine/tests/fixtures`; its `device` annotation (`--reporter=json`) names the
output that played it, or `none` when the engine kept time without one, as on CI.

## The JVM

The shared Kotlin (`packages/kotlin-shared`) runs in a JVM main starts with the app
(`src/main/kotlin/`), over JSON lines on stdio. `build:jvm` needs `JAVA_HOME` set to a JDK 21 for
the system you check on (CI uses Temurin 21).

```sh
pnpm --filter @wave/desktop build:jvm   # jvm/wave-kotlin.jar and jvm/runtime (jlink)
```

Build it before `test:e2e`: without it main keeps restarting a JVM that can't start, and every
Kotlin call fails with `[ERR_UNEXPECTED]`. `WAVE_JVM_RUNTIME` and `WAVE_KOTLIN_JAR` point main at
other builds. `e2e/kotlin.spec.ts` reads the tag fixtures the phone's tests read, kills the JVM
mid-call, and records its resident memory at rest as the `jvm-resident-mb` annotation.

## Data

`WAVE_DATA_DIR` points the app at a folder of its own instead of the user's data folder; the
Library is `wave.db` in it. Seed one before launching with `libraryLayer` from
`src/main/database.ts` and `addTrack` from `@wave/client/testing`, as `e2e/smoke.spec.ts` does.
Pass `--lang=en-US` (or `pt-BR`) to fix the app's language.

## Library scans

Main provides `DesktopLibrary` through `desktopLibraryLayer`, which consumes `Database` and
`Kotlin`. It starts an incremental scan immediately, using Electron's `app.getPath("music")`
for the system Music folder. `WAVE_MUSIC_DIR` overrides that first-run default for isolated
checks; an existing database keeps its chosen roots. First launch opens no permission dialog.

The service watches recursively from each root's parent on Windows and watches each directory
on Linux. It reconciles after 2 seconds without changes. Unavailable roots and failed watcher
registrations are retried every 10 seconds, followed by that quiet period. Handles are rebuilt
after a scan so a remounted directory's new inode is watched. Closing the service closes the
handles and waits for its current tag read before releasing the database.

`e2e/library.spec.ts` checks a 1,200-file first scan with the real JVM, progress, paging, live
file changes, root disappearance/recovery, F5, changes while closed and folder settings. The
folder-picker result is supplied by the test; checking the actual native dialog and physically
unplugging a drive remain owner checks. Screenshots are `library-progress.png`,
`library-scanned.png` and `library-unavailable.png` in `test-results/`.

The bridge adds `library.scanStatus`, `refresh`, `songs`, `roots`, `exclusions`, `addRoot`,
`exclude`, `removeRoot` and `include`. List calls take `(offset, limit)` and accept at most
200 rows. `addRoot` and `exclude` open the native picker; paths for removal/inclusion must
already belong to the stored settings. `player.load` and `player.play` reject unavailable
folders with `[folder-unavailable]`. `scanStatus.revision` changes after a saved batch and at
completion; views re-read their pages on that revision, while visible.

Core's `scanPath`, `scanPathKey`, `scanPathWithin` and `scanFileState` own desktop path and
availability decisions. Client's `db/desktopScan` reuses Core reconciliation and the phone's
saving, leaving-song, credit and playlist rules. `db/desktopFolders` applies the shared root
and exclusion plans with Windows identity. Canonical links inside selected roots are followed
once; targets outside those roots need their own root. Hidden files and folders are ignored,
and voice notes use Core's existing filter and Client's skipped-file index.

## Library layout checks

`e2e/layout.spec.ts` seeds 50,000 songs through SQLite and drives the real window. It checks
bounded rendered rows, scrolling (the `scroll-p95-ms` annotation), row selection and keyboard
movement, letter jumps, history, every Library page and hero, the 960×600 window, the 760 px
content breakpoint, search focus, Appearance and empty-library keyboard navigation.
Light and dark screenshots are `layout-<platform>-<scheme>-<page>.png` in `test-results/`.
Run it on Windows and WSLg and inspect the PNGs, including Settings and the heroes.

The `library.browse(scope, offset, limit)` bridge call returns `BrowsePage`: one `Page<BrowseRow>`
and an optional hero. Scopes are `songs`, `albums`, `artists`, `playlists`, `genres`, `favorites`,
`album`, `artist`, `playlist`, `genre` and `search`; detail scopes require a positive `id`, and
Search accepts `query` (up to 500 characters). Reads accept at most 200 rows. The table requests
100 at a time, retains at most seven pages, and renders the viewport plus overscan. It is one
tab stop, using `aria-activedescendant` for virtual rows. `library.letter(scope, letter)` returns
the row offset for a jump. Main registers Core's `sortKey` as SQLite's `wave_sort_key`.

`library.artwork(hash, large)` returns a cached data URL or null. It only accepts SHA-1 hashes
already in the artwork table. The shared JVM's `readTags` adds optional `artworkBase64` for covers
up to 8 MiB; the phone's metadata map stays unchanged. Desktop scans keep the original bytes,
300 px thumbnails and 640 px medium JPEGs, preserving aspect ratio. The cache is under
`%LOCALAPPDATA%/Wave/artwork` or `$XDG_CACHE_HOME/wave/artwork` (`~/.cache/wave` by default).
`WAVE_DATA_DIR` also isolates this cache for tests. Existing indexes get a tag reread once to
fill artwork; unavailable roots postpone completion of that upgrade.

`settings.appearance()` and `settings.setAppearance(system|light|dark)` persist in the
device-local `desktop_settings` table. Main applies the choice to Electron's `nativeTheme`,
including the Windows title bar overlay. The renderer uses Core's default theme derivation.
The other Settings sections and player controls are placeholders for their tickets. Row
activation is the `onOpen` callback on `VirtualTable`; the playback ticket connects song
activation and the hero's Play/Shuffle controls to a play context.

## Wave account

A build has Sign In only when its environment names the sync service and Google's Desktop OAuth
client: `MAIN_VITE_WAVE_SYNC_URL` and `MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_ID`, plus
`MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_SECRET` if Google asks the Desktop client for one
(`src/main/account/config.ts`). electron-vite puts them in main's bundle; the renderer never sees
them. Without them Settings › Accounts says accounts aren't set up. An unpackaged run may point
elsewhere with `WAVE_SYNC_URL`, `WAVE_GOOGLE_DESKTOP_CLIENT_ID` and
`WAVE_GOOGLE_DESKTOP_CLIENT_SECRET`, and only there may the service be `http://127.0.0.1`.
Never commit their values.

Main holds the session in `wave-session.bin` under the data folder, sealed by `safeStorage`. With
no keyring (Linux without a Secret Service, or `basic_text`) nothing is written: the session
lasts until Wave quits and Settings › Accounts says so. The window reads it all through
`wave.account.view()`, and Sign In, Cancel, Sign Out, Sign Out on All Devices and the
invitation's Not Now are the other `wave.account.*` calls.

The sync (`src/main/sync/desktopSync.ts`) pulls on opening, on focus after five minutes away and
every 15 minutes, and pushes after a scan, a play that ended or a star. `bridge.test.ts` signs in
through a fake browser against the real sync service in memory (`src/main/account/testAccount.ts`
and `apps/sync/src/testing.ts`); real Google sign-in needs the owner's client.

## The dev window

To look at `pnpm dev` from an agent, start it in the background with a debugging port and a
scratch data folder, then read the page over the Chrome DevTools Protocol
(`http://127.0.0.1:9333/json` lists the targets):

```sh
WAVE_DATA_DIR="$(mktemp -d)" pnpm --filter @wave/desktop exec electron-vite dev --remoteDebuggingPort 9333
```

Stop the Electron processes it started when done: a second launch only focuses the first
window (the single-instance lock), so a leftover one hides your new code.

## Linux under WSLg

Windows' `node_modules` can't run in WSL. Clone into WSL's own disk and install there (worktree
branches are in the main checkout's refs, so commit first):

```sh
git clone --branch <branch> /mnt/c/projects/wave ~/wave-check && cd ~/wave-check
pnpm install --frozen-lockfile --filter "@wave/desktop..."
pnpm --filter @wave/desktop test:e2e
```

WSLg provides the display (`DISPLAY=:0`) and a PulseAudio server (`RDP Sink`). That server has no
cookie in your home, so point `PULSE_COOKIE` at any 256-byte file
(`head -c 256 /dev/zero > ~/pulse-cookie`); without it the engine finds no device and plays
silently. Without sudo, unpack `libasound2-dev` with `dpkg -x` and point `PKG_CONFIG_PATH` at its
`alsa.pc`. Electron's binary downloads on the first run. CI runs
the same set on `ubuntu-22.04` under `xvfb-run` and on `windows-latest` (the Desktop jobs in
`.github/workflows/ci.yml`).
