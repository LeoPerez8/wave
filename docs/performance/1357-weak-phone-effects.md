# #1357 Heavy effects get simpler on a weak phone

Ticket: #1357 (parent #1346). Branch `feat/1357-weak-phone-effects`, based on
`feat/1346-instant`.

## What changed

- **The weak-phone rule, in Core** (`packages/core/src/phoneEffects.ts`, `WEAK_PHONE_RULE`). The
  app's frame meter (`WaveGlassModule`'s FrameMetrics listener, which reports half-second windows
  with their frame count and p95 frame time) feeds `tallyFrames`. A window counts when it has at
  least 10 frames (something was animating), and it's slow when its p95 frame took over 25 ms, one
  and a half frames at 60 Hz. `judgeFrames` says nothing before 40 counted windows (20 s of
  animation), then `simple` when more than half were slow, else `full`. The line is absolute, not a
  share of the display's deadline, so a 120 Hz phone isn't judged by its 8.3 ms deadline: a strong
  phone that drops the odd frame at 120 Hz still gets the full effects.
- **A session holds its effects.** `sessionEffects` fixes this session's effects at start from the
  last kept verdict (`wave.phoneEffects.verdict` in the key-value store), so nothing changes look
  mid-session. No verdict, or a `full` one: the full effects, and this session measures again. A
  `simple` verdict: the simple effects, unmeasured, since frames drawn with the simple effects
  would make a weak phone look strong. After 14 days a weak phone gets one session with the full
  effects to be measured again. The meter starts once startup has settled (`afterFirstSettled`),
  so a cold start's busy frames don't count, and stops at the verdict.
- **One log line per start**, tag `WaveEffects`, for example
  `Phone effects: simple (30 of 40 animated windows over 25 ms, 3 days ago)`, and
  `Phone effects measured: …` when a session reaches its verdict. A perf build's run metadata
  carries `phoneEffects`, so a run says which effects drew it.
- **What the simple effects are.**
  - The glass (tab bar, Search pill, mini player, dialogs, toasts, Settings › Appearance's sample):
    Core's `glassLayers` takes the effects; `simple` blurs at half the radius (rounded up, 12 dp
    for the default 24) and drops the AGSL refraction, keeping the tint and rim. The backdrop is
    still live, so the glass still shows what scrolls under it.
  - Now Playing's ground (`nowPlaying/Background.tsx`, under the player, Related and the Queue):
    it changes colour on a track change straight away instead of the 700 ms crossfade, as it does
    with reduced motion. The gradient stays.
  - Shadows: Wave draws none (no `shadow*`, `elevation` or `boxShadow` in the app or the native
    module), so there are none to simplify.
- **A strong phone looks as before.** With `full` every input to the glass and the ground is what
  it was: `glassLayers(settings, probe, "full")` returns the same layers as before, which the
  existing glass probe tests and the new tests check. The meter's cost on a measuring session is a
  FrameMetrics listener on its own thread and one JS event per half second while frames draw,
  until the verdict.

One known clash: the dev glass screen's frame HUD (`dev/glass/FrameStatsHud.tsx`) starts and stops
the same native meter, so opening it during a measuring session ends that session's tally. That
session simply reaches no verdict, and the next one measures again.

## What was measured

Nothing on a device. Frame times are the phone's RenderThread and GPU work, which a desktop can't
stand in for, and an emulator's GPU says nothing about either phone's. Checked off the phone: Core's
tests (the rule, the session decision, the stored verdict, the log line and the simple glass
layers) and the mobile typecheck.

## Phone run: pending

On both phones, a perf build of this branch (or the `ti` release with it). The runner records
`phoneEffects` in each run's metadata.

**Reference phone (Xiaomi 25118PC98G).** Before: the release before this change. After: this one,
in two parts.

1. Install it, start Wave, and use it for half a minute of scrolling (Home's carousel, Songs, a
   playlist) and Now Playing. The app log must show
   `Phone effects: full (not measured yet; measuring this session)` and then
   `Phone effects measured: simple …`. If it says `full`, the rule doesn't call this phone weak: record the slow and counted numbers here and stop.
2. Start Wave again; the log must show `Phone effects: simple (…)`. Then:

```sh
# before = the previous release's perf build, after = this branch's, same queue and Library
node scripts/perf/perf.ts run --scenario glass,now-playing,queue,reference-taps --label 1357-before
node scripts/perf/perf.ts run --scenario glass,now-playing,queue,reference-taps --label 1357-after
node scripts/perf/perf.ts compare perf-results/1357-before-….jsonl perf-results/1357-after-….jsonl
```

Look at frame p90 against the frame deadline on `scroll-home` (Home's carousel and shelves under
the glass), `scroll-songs`, `scroll-queue`, and the Now Playing open, Related open and close and
Queue steps of `reference-taps`.

**S24+.** Same build. Use it as in step 1; the log must say `Phone effects measured: full …` and
every later start `Phone effects: full (…; measuring this session)`. Run the same scenarios with
the labels `1357-s24-before` and `1357-s24-after`; frame numbers should match within noise, and a
look at the glass over a scrolling tab, the mini player and a track change in Now Playing should
show no difference.

Record both phones' log lines (the slow and counted numbers) and the comparisons here. If the
reference phone's slow share sits near the line, or the S24+'s isn't far below it, the numbers in
`WEAK_PHONE_RULE` move, with the spec's Fluidity rule.
