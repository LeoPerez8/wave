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
