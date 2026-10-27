# #719 Position reports on demand: report counts and playback listener work

Ticket: #719 (parent #712). Branch `feat/719-position-on-demand`, based on
`origin/feat/712-faster-lighter` at 87abbab7.

## What was measured

Desktop tests exercise the separate playback and position stores, position subscription
ownership, Now Playing's visibility and AppState gate, Android Auto's connected-car Lyrics
toggle, and the play-history checkpoint clock. Core's play-tracking regressions cover
listening from event-only reports, including long gaps, pauses, buffering, seeks, short
songs, repeats and crossfades. No Core classifier or counted-play rule changed.

Validation: 225 focused tests pass across mobile playback, Now Playing, Android Auto,
Core play events, position, player sync and playback restore. Mobile and Core typechecks,
formatting and whitespace checks pass. Oxlint has no errors; its three warnings are in
unchanged lines of Queue and Core's existing play-event tests.

The work-count test attaches 15 playback listeners. A position report wakes **zero** and
leaves the playback snapshot unchanged. Event reports keep the position snapshot current
with no subscribers. A seek made in JS updates that store immediately too.

Use the existing phone scenarios on comparable perf builds:

```sh
node scripts/perf/perf.ts run --scenario now-playing,now-playing-first,scrub,soak-player --variant idle --label 719-before
node scripts/perf/perf.ts run --scenario now-playing,now-playing-first,scrub,soak-player --variant idle --label 719-after
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

Repeat `now-playing,now-playing-first,scrub` with `--variant import`. The screen-off soaks
came with #713, after this ticket's starting commit: `--scenario screen-off,screen-off-lyrics`
plays with Now Playing closed, then left open on synced lyrics; `away:js:player.positionReport`
counts reports while the screen is off. Return to the app and confirm an immediate position correction.
Repeat with Auto disconnected, with a connected car's Lyrics toggle off, and with it on.

Perf builds count `js:player.positionReport`, `js:player.playbackState`,
`js:player.positionDemand.start` and `js:player.positionDemand.stop`. The listener metadata
also reports `listeners.position`. These counters use the existing perf recorder; they
start no additional timers. Compare settled windows after demand changes, since a report
already crossing the bridge can still arrive after release.

Budgets:

- Zero periodic native position reports without a position consumer. Playback events still
  carry position on play, pause, seek, song change and buffering.
- Zero playback-store listener notifications for any position-only report, including an
  optimistic seek made in JS.
- One native 500 ms reporting loop shared by all position consumers while playing. The
  first subscriber acquires it; the last release cancels it. Acquisition refreshes the
  native position immediately, including while paused; pauses stop periodic reports.
- No reporting demand from hidden or inactive Now Playing. Car lyrics acquire demand only
  with their toggle on and a connected car, independently of the app's foreground state.
- Ongoing play-history progress still saves every 15 seconds while playing and on pauses,
  app departure and teardown. That required persistence clock is separate from reports;
  it does not subscribe to positions or change listening-time classification. The queue's
  resume position has its own 5-second clock while playing (`playback/queueSaves.ts`), so a
  kill loses at most about 5 seconds of place whether or not Now Playing is open.
- Keep the existing 50 ms Now Playing spring-start budget and compare frame misses and
  scrub latency against #546 on the same S24+. This ticket makes no new phone latency or
  battery claim without measurements.

## Before (87abbab7)

**Pending owner's S24+ run.** Record the APK, SHA, fixture, refresh rate, compiler filter,
raw JSONL and summary here. The native controller reports every 500 ms while playing,
regardless of visibility. Each report updates the full playback store.

## After

**Pending owner's S24+ run.** Record the same metadata, raw JSONL and comparison here.

Position reports update `positionState`; playback listeners follow `playbackState` for
state and item changes. The #718 UI-thread playhead consumes the new position store under
its existing visibility gate. Car lyrics release their subscription when disabled or
disconnected. Native reporting demand controls only the Expo module's report scheduler.
The MediaSession clock, lock-screen and notification playback, Bluetooth controls, native
resume saves and crossfade engine retain their existing paths.

## Behavior kept

Desktop coverage checks play classification, event snapshots without subscribers,
optimistic seek snapshots, report subscription cleanup, foreground return, Auto lyrics,
and play-history checkpoints. Existing seek, repeat, restore and crossfade tests also run.

On the S24+, verify the lock-screen and notification position after a long screen-off
listen, Bluetooth play/pause/seek, Android Auto progress and lyrics with the phone locked,
seeks from Wave and from system controls, buffering and song transitions, and process-kill
resume. Compare counted plays and listening history for paused and buffered listens,
short songs, repeats and crossfades. Check TalkBack's scrub actions and the initial lyric
and sleep-menu positions after returning to the app. No visible design changed.

## Not measured, and negative results

No phone measurements, visual checks, TalkBack checks or Android Auto drive were run.
Before/after numbers remain pending and do not block integration.

There is no usable Android SDK or generated Gradle project in this worktree. The native
reporting gate and its four JUnit tests were written but were not compiled or executed.
The tests cover no-demand playback, immediate acquisition, release and already-queued
callbacks, pause/resume, duplicate requests and destruction. Android compilation remains
required on the owner's build machine or CI.

Queue serialization and native resume persistence belong to #720 and were not changed.
Whole-app screen-off wake-ups include play-history checkpoints and other services; this
ticket's report budget does not claim those services are idle.
