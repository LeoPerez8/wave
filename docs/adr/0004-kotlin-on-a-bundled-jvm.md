# ADR 0004: The phone's Kotlin runs on desktop in a bundled JVM

Date: 2026-11-18. Status: accepted. Spec: `docs/spec-desktop.md`.

## Context

The phone's YouTube Music client (innertubex), Soulseek, downloads and tag reading and writing
(jaudiotagger) are Kotlin in the Expo module. The desktop needs all of them. Rewriting them in
TypeScript means two clients to fix every time YouTube changes something, and two tag readers
that can read different fields from the same file. A recording key built from different fields
breaks matching between devices.

## Decision

- The Kotlin moves to `packages/kotlin-shared`, a plain Kotlin/JVM Gradle module. The Android
  module consumes it; the desktop ships it as a JAR.
- The desktop bundles a jlink-trimmed Java runtime and runs that JAR as one child process of
  Electron's main process, speaking JSON lines over stdio, with requests both ways and the
  phone's error codes. Main supervises it and restarts it after a crash.
- The scanner reads tags through it too, so the JVM is required even with YT Music off.
- Both apps move to innertubex 0.11.9 or later, which needs no QuickJS natives on the JVM.
- The Kotlin resolves stream addresses only. The Rust engine fetches the bytes and keeps the
  audio cache, so audio never crosses the pipe.

## Consequences

- One fix to the YouTube client or the tag reader reaches both apps.
- The installer grows by about 17 MB, and the JVM takes about 60 MB of memory at rest
  (measured 2026-11-18, 128 MB heap cap). It is ready in under 300 ms, hidden by the app's start.
- Proof-of-origin tokens and YouTube sign-in stay per platform: on desktop a hidden Electron
  window runs the phone's `wave_po_token.html`, and a visible one shows YouTube's sign-in.
- The phone's move to innertubex 0.11.9 is a prerequisite and ships as a phone release first.
