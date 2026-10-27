# #712 Budgets: what "faster and lighter" is measured against

Ticket: #713 (parent #712). Branch `feat/713-perf-rules`, merged with `feat/712-faster-lighter` at 96286144.

The Performance rules in `docs/spec.md` say a performance change states its budget and its
before and after phone runs. This doc holds the budgets for #712's work, each tied to a
`scripts/perf` scenario step (`<scenario>/<variant>/<measure>`, as `perf.ts summary` keys
them). Each #712 ticket's doc (`docs/performance/714-*.md` onwards) records its own before and
after against them.

Perf runs never block a release. They are acceptance evidence for the tickets, not CI gates.

## Where the numbers come from

#712 asked for budgets from the #546 baseline. #546 has no phone numbers: its only device was an
emulator running a debug 0.15.0-ti build, and its doc says so (`546-current-release-baseline.md`).
No #301 or #545 doc holds an S24+ run either. So:

- A budget fixed elsewhere is used as is: the app's own tap budgets (Core's `TIMING_BUDGETS`, which
  the in-app timing log already enforces) and the 120 Hz frame deadline.
- A **structural** budget (a count that must be zero, or one per event) needs no baseline.
- Every other budget reads **set from the first run**: the owner's first S24+ run on
  `feat/712-faster-lighter` before the #712 changes (the "712 baseline" below) records the value,
  and this doc is updated with it. After that, a ticket's after run must not be worse than the
  baseline by more than the run-to-run noise #546 asks for (three repetitions).

Nothing in this doc is a phone measurement.

## Runs

On the S24+, set up as `README.md`'s Fixture says (120 Hz, 1x animations, the owner's Library of
about 12,000 songs, a perf build, `--compile baseline`, a playlist visible on Library › Playlists):

```sh
node scripts/perf/perf.ts run --scenario all,glass --variant idle,import \
  --playlist "<visible playlist>" --artist "<visible artist>" --compile baseline --label 712-baseline-1
node scripts/perf/perf.ts run --scenario screen-off,screen-off-lyrics --compile baseline \
  --label 712-screen-off-1
node scripts/perf/perf.ts summary perf-results/<file>.jsonl
```

Repeat each three times (`-2`, `-3`) before reading noise. `all` runs `skip-library` after
`skip`, so from there on the queue is the whole Library, and the glass group's `scroll-queue`,
which runs after `all`, scrolls a 12,000-song Up Next. The screen-off soaks need a song with synced lyrics at the head of the queue, the player
paused, and a lock screen without a PIN (the runner unlocks with `wm dismiss-keyguard`). They take
about 20 minutes each (one warm-up and three five-minute windows); for #723's 30-minute check pass
`--iterations 6`.

## Budgets

### Scrolling (frames)

At 120 Hz a frame has 8.33 ms. Flings render more frames than gfxinfo keeps, so their first frame
and settle stay empty; frames, deadline misses and frame parts are what they measure.

| Scenario step                                                                 | Metric                        | Budget                 |
| ----------------------------------------------------------------------------- | ----------------------------- | ---------------------- |
| `scroll-songs/idle/fling-up`, `fling-down` (glass group)                      | frame p90                     | within 8.33 ms         |
|                                                                               | deadline-miss rate, frame p99 | set from the first run |
| `scroll-playlist/idle/fling-up`, `fling-down`                                 | frame p90                     | within 8.33 ms         |
|                                                                               | deadline-miss rate, frame p99 | set from the first run |
| `scroll-queue/idle/fling-up`, `fling-down` (glass group, 12,000-song Up Next) | frame p90                     | within 8.33 ms         |
|                                                                               | deadline-miss rate, frame p99 | set from the first run |
| each of the above, `import` variant                                           | deadline-miss rate            | set from the first run |

### Navigation (tap to first frame)

From `TIMING_BUDGETS` (`packages/core/src/timing.ts`), as medians. The p90s are set from the first
run.

| Scenario step                                                                                        | Response | First frame |
| ---------------------------------------------------------------------------------------------------- | -------: | ----------: |
| `tab-switch/*/tab`, `tab-first/*/first`                                                              |   100 ms |      150 ms |
| `push-settings`, `push-library`, `push-playlist`, `push-empty` (`*/push`, `*/pop`)                   |   100 ms |      150 ms |
| `push-tracklist/*/push`, `push-artist/*/push` (their content marks, `songs.rows` and `artist.stats`) |   400 ms |      150 ms |
| `push-tracklist/*/pop`, `push-artist/*/pop`                                                          |   100 ms |      150 ms |
| `queue/*/open`, `queue-first/*/open`                                                                 |   100 ms |      100 ms |

`rapid-tabs/*/burst` (settle on the last tab) is set from the first run. The 400 ms is
`TIMING_BUDGETS.screen.contentMs`, the app's budget for a screen's first content.

### Launch and Now Playing

| Scenario step              | Metric                                                 | Budget                        |
| -------------------------- | ------------------------------------------------------ | ----------------------------- |
| `startup/*/cold`           | `am start -W` TotalTime, median                        | set from the first run        |
| `warm-start/*/warm`        | TotalTime, median                                      | set from the first run        |
| `now-playing/*/open`       | `nowPlaying.spring` phase (the spring started), median | 50 ms (`nowPlayingOpen`)      |
|                            | response (`nowPlaying.shown`), deadline-miss rate      | set from the first run        |
| `now-playing/*/close`      | `nowPlaying.spring` phase, median                      | 50 ms (`nowPlayingClose`)     |
|                            | response (`nowPlaying.hidden`)                         | set from the first run        |
| `now-playing-first/*/open` | response, first frame                                  | set from the first run        |
| `scrub/*/forward`, `back`  | deadline-miss rate                                     | set from the first run        |
|                            | `Scrubber` renders per drag                            | no time-driven renders (#718) |

### Skip with a 12,000-song queue

| Scenario step         | Metric                                             | Budget                                         |
| --------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `skip-library/*/next` | response (`queue.synced`), median and p90          | set from the first run                         |
|                       | long tasks in the window                           | set from the first run                         |
|                       | `SongRow` renders per skip (Library › Songs shown) | 2: the rows that stop and start playing (#715) |
| `skip/*/next`         | response, median                                   | set from the first run                         |

`queue.synced`'s detail carries the queue's length, so a run can show the queue really was the
whole Library. #720's budget (a skip serialises no queue) is structural and checked by its tests;
the run shows its effect in long tasks and frames after the settle.

### Screen off (JS wake-ups)

`screen-off` plays music with Now Playing closed; `screen-off-lyrics` leaves Now Playing open on
synced lyrics with a 60-minute sleep timer. Each window is five minutes with the screen off. The
runner reads every thread's voluntary context switches from `/proc` before and after (any APK);
a perf build adds what rendered while away, as `away:<name>` renders (see README, Screen-off
soaks).

| Scenario step                                                     | Metric                                                       | Budget                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `screen-off/idle/screen-off`, `screen-off-lyrics/idle/screen-off` | JS wake-ups per minute, median                               | set from the first run                   |
|                                                                   | process wake-ups per minute, median                          | set from the first run                   |
|                                                                   | `away:` renders of any component                             | 0 (rule 1, Unseen is idle)               |
|                                                                   | `away:js:player.positionReport`                              | 0 (#719: no reports without a consumer)  |
|                                                                   | `away:js:sync.run`                                           | at most 1 per minute of play ends (#723) |
| `screen-off-lyrics/idle/screen-off`                               | `away:SyncedLyrics`, `away:SleepTimerLabel`, `away:Scrubber` | 0 (#718)                                 |

End of track isn't scripted: the timer stops the music inside the window. Check it by hand with
`now-playing` steps: `SleepTimerLabel` must not count per second with End of track set.

### Render counters

The counters #712 asked for are in place, each counting with `useRenderCount` (an empty function
outside perf builds):

| Counter           | Where                                       | Added by | What a run should show                                                                      |
| ----------------- | ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `SongRow`         | `apps/mobile/src/songs/SongRow.tsx`         | #715     | a song change renders the rows whose playing flag flipped; a star renders one row           |
| `SyncedLyrics`    | `apps/mobile/src/nowPlaying/LyricsView.tsx` | #718     | one render per current-line change while shown; none while away                             |
| `SleepTimerLabel` | `apps/mobile/src/nowPlaying/SleepTimer.tsx` | #718     | at most one render a second for a deadline timer while shown; none for End of track or away |

#713 adds none of its own: #715 and #718 added these three while it was waiting, and a second copy
would double-count. The counts tickets added for their own evidence are listed in README's
Instrumentation section (`js:player.*` from #719, `js:sync.run` from #723).

## Scenarios the #712 tickets' docs use

Every scenario a ticket doc names exists in `scripts/perf/scenarios.ts`:

| Ticket doc                       | Scenarios                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `714-song-row-view.md`           | `scroll-songs`, `push-tracklist`, `push-playlist`, `queue`                                    |
| `715-library-song-list.md`       | `scroll-songs`, `push-tracklist`, `push-artist`                                               |
| `717-shared-buttons.md`          | `now-playing-first`, `now-playing`, `queue-first`, `queue`, `push-settings`                   |
| `718-ui-playhead.md`             | `now-playing`, `now-playing-first`, `scrub`, `soak-player`, `screen-off-lyrics`, `screen-off` |
| `719-position-on-demand.md`      | `now-playing`, `now-playing-first`, `scrub`, `soak-player`, `screen-off`, `screen-off-lyrics` |
| `720-queue-persistence.md`       | `skip`, `queue-drag`, `soak-player` (and `skip-library` for the 12,000-song skip)             |
| `721-glass-under-now-playing.md` | `scroll-queue`, `now-playing`, `soak-player`                                                  |
| `723-sync-batching.md`           | `soak-player`, `screen-off`                                                                   |
| `724-repeated-work.md`           | `startup`, `tab-switch`, `queue`, `push-playlist`                                             |
| `725-database-settings.md`       | `skip`, `startup`, `rescan-return`                                                            |
| `726-medium-covers.md`           | `push-library`, `push-playlist`, `tab-switch`, `now-playing`, `soak-routes`                   |

`scroll-songs` (#316) and `scroll-queue` (#721) are in the glass group (`--scenario glass`), so
their glass probes can be compared; name them or the group when a ticket needs them.
`scroll-playlist` is in `all`.

## App size

CI measures every APK build, not the phone (#729, `docs/performance/729-perf-guards.md`): the APK
and its Hermes bundle against the v0.33.5 release's sizes plus 5% (80.87 MB and 17.68 MB), in
the Android APK job's sticky comment and run summary. Over budget warns; it never fails a build.

## Not measured

- Every number: **pending** the owner's S24+ runs. No dry-run number is a measurement.
- To confirm on the first run: that adb's shell can read Wave's `/proc/<pid>/task/*/status` (it
  can on stock Android; the run stops the scenario with an error if not), that the JS thread is
  named `mqt_v_js`, that `KEYCODE_SLEEP` puts Wave in the background and `wm dismiss-keyguard`
  brings it back, and the labels the new scenarios tap: Songs' `Play`, Now Playing's `Play`,
  `Lyrics`, `Sleep timer` and its `60 Minutes`.
