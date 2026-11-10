# Bring your music (#1068)

The first-run runner listens only while the invitation or tour is due. It stops its AppState,
Now Playing, overlay and account subscriptions when the sequence finishes. The card's YT Music
setting subscription exists only while the card is mounted. Sign-in and picker work begins on a
source button press; the tour adds no library query, polling, timer or network request.

The source buttons reuse the existing library imports, including their background work. The
runner stays paused until sign-in or the picker closes, and Core waits for the foreground, Now
Playing and other cards before reopening the tour.

Before/after S24+ timings and visual checks are unverified: no device was connected in this
session (`adb devices` returned an empty list), and the documented T3 emulator tools were not
available. Phone checks do not block release. Check a fresh install through both source pickers,
with YT Music on and off, interruption before an answer, dismissal, and the answered relaunch;
also confirm that an updating phone skips this card.

Validation on Windows with Node 24.19.0:

- Core: 5,078 tests passed, including the rerun after fetching and merging the integration
  branch (already up to date).
- Mobile: 1,636 tests passed, one skipped. The package test script's single-quoted globs
  selected zero tests on Windows; running its Node command from `apps/mobile` with
  double-quoted globs ran the suite. The runner and picker tests also passed all 15 tests
  after adding the final sign-in cancellation case.
- Workspace typecheck, `scripts/check-guards.sh`, changed TypeScript/TSX formatting and
  `git diff --check` passed. The guards include the untranslated-text check.
