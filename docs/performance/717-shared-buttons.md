# Shared buttons and theme lookups (#717)

Parent: #712. Baseline source: `874fb3753b8a26efee5d22a4bd608374f9cbe23a`.

## What changed

`useThemeColor` accepts a token or a readonly array of tokens. A batch makes one
Uniwind array lookup and returns strings in the same order, with `transparent`
for a missing or non-string value. TrackRow, Artwork, the download progress ring and
every Now Playing component (including synced lyric lines, the cover, the scrubber and
sleep timer label) now make at most one lookup per function. Shared buttons resolve their ink, caption
and fill through one lookup each.

IconButton owns the target, glyph size, tone, caption, press depth and haptic.
TextButton owns text actions, pills, Stats segments and the plain list variant.
PlainTextButton delegates to that plain variant. It still uses Pressable and
pressed opacity, with no animated style registered for a Downloads row (#446).

Now Playing's song actions, transport, view toggles and title star, Up Next's
remove and queue toggles, selection actions, menu play cards and entries,
arrangement buttons, list actions, playlist-card actions and Settings choices
use these components. The star's custom animated face keeps its existing pop.
Swatches keep their existing circles and colour-picker artwork inside the shared
target. No screen is restyled. Now Playing's scrubber, lyric-line rendering,
cover gestures and sleep-timer internals keep their own `Press` and behaviour
(#718); only their two-colour reads became one batched read.

## Desktop checks

The new tests use the repo's Node test runner, react-test-renderer and module
hooks. No dependency was added. The hook test replaces the native Uniwind
boundary and verifies an ordered batch, transparent fallbacks, scalar callers,
readonly tuples, an empty batch and updates after a theme notification. A source
guard (`themeLookups.test.ts`) parses TrackRow, Artwork, both shared buttons and
every Now Playing component, and fails if any one function calls `useThemeColor`
more than once.

Button tests exercise the pure appearance and plain-press decisions consumed
by the components: targets and glyph sizes, tones, feedback, selected segment
and pill ink, disabled ink, plain opacity and disabled action suppression.
The existing test setup does not render TSX/native controls, so desktop tests
do not establish native layout, TalkBack output, haptic strength or menu anchoring.
Those checks remain in the phone scenario below.

```sh
pnpm --filter @wave/mobile typecheck
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test \
  apps/mobile/src/theme/useThemeColor.test.ts \
  apps/mobile/src/theme/themeLookups.test.ts \
  apps/mobile/src/components/buttonAppearance.test.ts
```

## S24+ scenario and budget

Follow #546's release-APK, fixture, compilation, thermal and repetition controls.
Use the same Library, queue and import fixture for baseline and candidate. Run
at least three repetitions of each. Keep the raw JSONL and APK source SHA with
the results; do not substitute desktop execution time for phone timings.

```sh
node scripts/perf/perf.ts doctor --serial <phone>
node scripts/perf/perf.ts run --serial <phone> --apk <release.apk> \
  --commit <source-sha> --compile baseline --variant idle,import \
  --scenario now-playing-first,now-playing,queue-first,queue,push-settings \
  --label 717-before-1
# Repeat with the candidate APK and label 717-after-1, and repetitions 2 and 3.
node scripts/perf/perf.ts summary <raw-run.jsonl>
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

Budgets come from Core's TIMING_BUDGETS and #318's 120 Hz target: Now Playing's
spring starts within 50 ms; Queue response and first frame stay within 100 ms;
Settings push/pop response stays within 100 ms and first frame within 150 ms.
For those transitions, frame p90 should be at most 8.3 ms at 120 Hz, with few
late frames. First use, warm use, JS long tasks, frame misses and memory must
not regress beyond baseline variability. Keep missing metrics missing.

Manually exercise all moved buttons in light/dark mode, custom colours, large
text, TalkBack and Remove animations. Check target bounds, glyph sizes and
strokes, captions, pressed depth, haptics, disabled actions and highlights while
cards stay open. Include Add to Playlist, all download states, Translate on/off,
previous/play/pause/next, the favorite pop, Queue switches and remove, selection
More/destructive actions, slide-to-choose cards, Stats periods, Settings choices
and swatches. Scroll hundreds of failed Downloads rows and confirm their plain
actions still dim and remain responsive.

## Measurements

Before: pending the owner's S24+ release run.
After: pending the same hardware and fixtures.
Visual, TalkBack and native-feedback comparison: pending the phone.
No phone performance result or improvement is claimed by this ticket's desktop checks.
