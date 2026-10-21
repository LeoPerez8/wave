# Android Back and exit confirmation (#536)

Back dismisses the top card, including consuming presses during its closing
animation, before screen handlers. Now Playing closes before the underlying
screen leaves. Pushed screens retain normal navigator Back behavior. At the
navigation root, the first Back says “Press Back again within 2 seconds to exit”.
A second press strictly less than 2,000 ms later uses Android's existing default
exit behavior. Expiry, navigation, app activity changes, cards, selection changes
and Now Playing phase changes cancel the earlier attempt. Playback services and
their background policy are unchanged.

Predictive Back is disabled in Expo's Android configuration so Back continues
through React Native's hardwareBackPress handlers. This configuration change
requires a native rebuild; a JavaScript-only update does not apply it.

The long-press delay remains configurable from 50 to 500 ms in 10 ms steps, with
a 500 ms default. Its persisted setting, Touch settings slider and Press's live
subscription are unchanged.

## Automated evidence (2026-10-21)

- `pnpm typecheck`: passed across the workspace and scripts.
- Core tests with `node --test --test-concurrency=1 src/*.test.ts`: 3,286 passed.
  The initial parallel workspace run exceeded two existing search timing budgets
  while native compilation was running; the serial rerun passed both.
- `pnpm --filter @wave/mobile test`: 489 passed.
- `pnpm --filter @wave/sync test`: 47 passed.
- CI and performance script tests: 252 passed.
- Exit confirmation and existing long-press delay tests: 10 passed together.
- Changed TypeScript files: Prettier and targeted oxlint passed.
- Standards review: no findings. Spec review: no concrete implementation findings;
  device-specific acceptance still requires the evidence below.

## Device evidence

The native debug APK built successfully for x86_64 after Expo prebuild, with
`android:enableOnBackInvokedCallback="false"` in the generated manifest. A local
copy with an embedded production JavaScript bundle was installed for testing
(the unbundled debug copy could not load its script from Metro).

On the API 36 emulator, using agent-device system Back and accessibility snapshots:

- Opening Sleep timer over Now Playing, then Back, removed only the timer card.
- The next Back removed Now Playing and left Home and its mini player visible.
- First root Back showed the exit hint while Home remained visible.
- A later Back after expiry kept Home visible and showed a fresh hint.
- A second Back immediately after that hint returned to the Android launcher.
- Relaunch restored Home. Back from Appearance returned to Settings, and the next
  Back returned to Home normally.

Only the `wave_s24` emulator, Android API 36, is available locally. No Samsung
SM-G985F or Android API 33 system image is attached. The required Samsung/API 33
gesture and button navigation checks remain unverified.

Before closing the device acceptance criterion, use a rebuilt APK and verify:

1. Back from Now Playing leaves Wave visible; a card over it closes first.
2. Lyrics selection/share and list selection consume Back in their existing order.
3. Pushed details and Settings pages return normally, including from another tab.
4. First root Back hints; a second within two seconds leaves the activity.
5. Waiting two seconds requires a new first Back. Backgrounding/resuming or
   opening/closing a card or player also requires a new first Back.
6. Keyboard Back dismisses the keyboard first; rapid Back during a card's closing
   animation does not leave the app.
7. Repeat with gesture and three-button navigation and confirm existing background
   playback behavior after the confirmed exit.
8. Change the long-press delay at both ends of its range and confirm menus still
   follow the chosen delay, including after relaunch.
