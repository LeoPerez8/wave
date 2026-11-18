# ADR 0001: Wave desktop runs on Electron with a Rust audio engine

Date: 2026-11-17. Status: accepted. Spec: `docs/spec-desktop.md`.

## Decision

- Electron for the app, on Windows x64 and Linux x64. React UI in the renderer; `packages/core`,
  Effect and Drizzle with better-sqlite3 run in Node unchanged.
- An own audio engine in Rust (Symphonia decoding, cpal output) that applies the phone's
  gapless, crossfade and per-song gain rules one to one. Opus through libopus. ALAC is not in v1.
- The engine is a napi-rs addon loaded in an Electron `utilityProcess`, so a stall or panic in
  audio never takes the window down, and playback continues with the window closed. CI builds
  the prebuilt binaries per OS and arch. Rust is added elsewhere only where it earns its place.
- The phone's Kotlin YouTube Music client runs on a Java runtime bundled in the installer,
  if an experiment (installer size, memory, start time, sign-in) passes. Otherwise the client is
  rewritten in TypeScript.

## Considered

- Tauri + Rust: smaller installer, but Core runs only in the webview, SQLite goes through a
  proxy, and Linux uses the distro's WebKitGTK, whose differences the owner can only see in WSLg.
- Electron with TypeScript only: Web Audio costs about 106 MB decoded per 5-minute song for real
  gapless and plays no ALAC; libmpv has no two-voice crossfade.
- libmpv and libVLC as engines: no Wave crossfade ready; libVLC weakest on gapless.
- Addon in the main process (a panic kills the app) and a sidecar binary (one more process to
  package and sign, with its own protocol).

## Consequences

- Wave keeps Rust code and a Rust toolchain in CI, beside the Kotlin of the phone.
- Two experiments come before the stack is final in practice: AAC-in-M4A gapless through
  Symphonia, and the Kotlin client on a bundled JVM.
- Installer is Electron (~120–150 MB) plus the engine plus, if kept, a Java runtime.
