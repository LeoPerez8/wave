# #714 Core song row view and swipe directions

Ticket: #714 (parent #712). Branch `feat/714-song-row-view`, based on
`origin/feat/712-faster-lighter` at `874fb3753b8a26efee5d22a4bd608374f9cbe23a`.

## What was measured

Desktop correctness checks cover the exported `songRowView` and
`songRowSwipeDirections` functions. The row view preserves each source's text,
badges, selection state and spoken label. The swipe tables compare every pair
of the eleven swipe choices with the existing menu planners, including downloads
and route exclusions. These tests do not measure Android rendering performance.

This ticket adds Core APIs without wiring them into the app. There is no expected
phone performance change until #715 and #716 adopt them. The structural budget is
zero menu constructions for swipe planning and zero store reads, subscriptions,
I/O or timers in either function. Work depends on one row's metadata and artists,
never the length of its list.

For the owner's S24+ comparison, use the same perf-build settings and fixture on
both commits, including a 12,000-song Library and the same playlist. Run:

```sh
node scripts/perf/perf.ts run --scenario scroll-songs,push-tracklist,push-playlist,queue --variant idle,import --label 714-before
node scripts/perf/perf.ts run --scenario scroll-songs,push-tracklist,push-playlist,queue --variant idle,import --label 714-after
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

Frame budget: 8.33 ms at 120 Hz. Dropped-frame rate, navigation response and Queue
response must not regress against the paired baseline. #713's measured scenario
budgets take precedence once available. Neither #546 nor this ticket establishes
a physical-phone baseline.

## Before (874fb375)

Pending the owner's S24+ run. Record APK hash, source SHA, Android version,
refresh rate, compiler filter, Library size and results-file path here.

## After (this branch)

Pending the owner's S24+ run. Record the same metadata, the comparison output
and any comparison warnings here. No before/after numbers have been collected.

## Behavior kept

Public Core tests cover all eight song sources, loading rows and disc headers;
playing and starred rows; every selection state; missing-song download phases;
file not found; explicit and downloaded badges; each leading cell; counted plays;
trailing overrides; artwork choice; stable keys; and the existing spoken order.
Queue labels retain their shorter form, and history uses its saved title and credit.
`trackRowTrailing`, `trackRowDownloaded` and menu APIs remain available to callers.

## Not measured, and negative results

Phone, Hermes, visual, gesture and TalkBack checks remain pending. The implementer
brief reserves the phone run for the owner. No APK was built or native code changed.
The existing app rows still perform their current work; the new Core module alone
does not reduce app renders. No speedup is claimed.
