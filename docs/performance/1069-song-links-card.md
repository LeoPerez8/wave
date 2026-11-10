# Song-links welcome card (#1069)

Card 2 uses the existing first-run subscriptions only while the tour is due. It reads Android's
small song-link state before offering the card, without a library query, network request, timer
or polling. Answered phones start no first-run subscriptions.

Turn On saves the answer immediately, releasing the first-run subscriptions when the tour ends.
A separate AppState listener follows the Android settings visit until Wave returns, the card
is dismissed or opening settings fails. It then removes itself, closes the card and, on return
or failure, reads the current link state once for the toast. The card uses shared CardEntries
and TextButton components, including their scrolling, touch targets and reduced-motion behavior.

Before/after S24+ timings and visual checks are unverified: `adb devices` returned no devices,
and the documented T3 emulator tools were unavailable. Phone runs do not block release. Check
a fresh install after either answer to card 1, all links already on, each dismissal path,
an unanswered relaunch, and return from Android settings with all, some or no links on. Check
English and pt-BR, large fonts, light/dark themes and TalkBack on the phone.

Validation on Windows with Node 24.19.0:

- Core: 5,080 tests passed, including the rerun after fetching and merging the integration
  branch (already up to date).
- Mobile: 1,642 tests passed, one skipped. The package test script's single-quoted globs
  selected zero tests on Windows; its equivalent Node command with double-quoted globs ran
  the full suite. The affected runner tests and untranslated-text check passed all 15 tests.
- Workspace typecheck, `scripts/check-guards.sh`, changed-file formatting and
  `git diff --check` passed. The guards include the untranslated-text check.

`showSongLinks` can also present the card for #1070; `readSongLinkHandling` is shared with
Settings for #1071. This ticket adds neither the updating-phone offer nor the per-app steps.
