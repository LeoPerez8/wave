# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

One person: the owner, on a Samsung Galaxy S24+ (120 Hz). Wave is sideloaded and not distributed;
nobody else is expected to install it. First-run and empty states only need to work for someone who
knows what the app is for.

## Product Purpose

Wave is a local-file music player for Android. It plays the music folders the owner chooses with a
BlackPlayer-grade engine (folder-based library, gapless playback, lyrics, sleep timer; equalizer and
tag editor in v2), and records every play so listening statistics can be built later. It exists
because no Android player pairs that engine with an interface the owner enjoys using. Success means
it replaces BlackPlayer as the daily player.

## Positioning

A player built for exactly one library and one phone: offline, no accounts, no streaming, full
play-history capture from day one (counted-play rule compatible with Last.fm scrobbling). Apple Music
(iOS 26) is the reference for feel, not a template to copy: Wave develops its own visual identity.

## Operating Context

Two primary listening scenes:

- **On the go with headphones.** One-handed, quick glances, frequent control from the lock screen,
  notification and headset/Bluetooth buttons.
- **In the car on Android Auto.** In v1 the car shows only what Media3 provides for free (now playing,
  transport, queue). A browsable Android Auto library is a known gap deferred to v2.

Libraries reach tens of thousands of tracks; scanning, list virtualisation and scrolling are designed
for that size.

## Capabilities and Constraints

- v1 scope, glossary and user stories: `docs/spec.md` (repo root). v2 features are listed there under
  Out of Scope.
- Android only, minimum API 31, sideloaded APK, `MANAGE_EXTERNAL_STORAGE` acceptable. No backend,
  network features or localisation; all UI copy is in English.
- Stack: Expo / React Native, Expo Router, uniwind, Effect, Reanimated, Gesture Handler, React Native
  Skia, Media3 native module. Decision-heavy logic lives in `packages/core` (zero runtime dependencies).
- **Tap animations with adjustable speed.** Touch interactions animate, and the owner can set the
  animation duration in milliseconds in Settings. (New requirement, not yet in the spec.)
- Haptic feedback on key interactions (play/pause, favorite, long-press, end of scrub).
- Theme follows the system light/dark setting.
- **Open for the design round** (previously in the spec, no longer binding): the teal/gold palette,
  glass materials, the Inter typeface and Apple Music's exact tab/mini-player/Now Playing structure.
  The scaffold currently ships all four.

## Brand Commitments

- Name **Wave**, application id `dev.leoperez.wave` (permanent).
- Apple Music is a reference for feel only; the identity is Wave's own.

## Evidence on Hand

- `docs/spec.md`: the full v1 spec.
- `apps/mobile/assets/`: an app icon, adaptive icon layers (background `#0D6B62`) and a splash icon
  from the scaffold.
- No real library data, screenshots or artwork are committed. Demo content must be labelled synthetic.

## Product Principles

1. **The library is the owner's own.** Folders, tags and play history are the source of truth, and
   moves or renames never lose history.
2. **Playback is always one gesture away**, in the app, on the lock screen and in the car.
3. **Fast at scale.** Tens of thousands of tracks scroll at 120 Hz, and browsing starts before the
   scan finishes.
4. **Feel is a feature.** Motion, haptics and touch response are first-class and tunable (animation
   speed in ms).
5. **Capture now, analyse later.** Every play is recorded in full, even though v1 shows no statistics
   screens.
