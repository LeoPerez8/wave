# #1536 A tab's slide starts once its first frame is drawn

Ticket #1536, part of spec #1528. Branch `feat/1536-slide-after-first-frame`, based on
`feat/1528-screens-show-at-once` at `5747b9c20` (with #1534 and #1535).

**Every number below is an emulator result** (AVD `wave-run-903`: android-36 google_apis x86_64,
pixel_7, 4 GB RAM, rendering through SwiftShader; perf builds of `f108283fa`, x86_64, ART filter
`speed`), not a phone measurement. No phone was connected. The reference phone confirms it from
the owner's next exported log on the `ti` release ("What the phone log should show", below).

## Result

The slide now starts on the UI frame after the tab's first frame is drawn, and the app log says
what the slide itself missed (`…; its motion missed N (longest gap … ms)`).

**On the emulator the slide still misses about 4 UI frames on every switch, before and after the
change.** The acceptance criterion "a switch to a kept tab logs no missed UI frame during the
slide" is not met there, and no start for the slide could meet it on this AVD: every frame that
changes pixels takes 60 to 100 ms to draw, all of it on the render thread and the (software) GPU,
not on the UI thread. Only 19 of the 1,677 frames drawn over the old start's warm switches, and
24 of 1,704 over the new start's, were drawn within 16 ms. The phone, with a real GPU, is where
the 1 to 4 frames lost at the slide's start (spec #1528's report) were seen, and where the new
log line can show whether they went.

## Numbers

Medians / p90 over every step of every run, in ms. "Before" is this branch's build with the slide
started in the commit that shows the tab, as before #1536, its frames counted from its first frame
(a measurement-only bundle: same native code, `tabEntry.ts` patched); "after" is the branch. Each
step's UI frames are from the app log's `Tab to … missed N frames (…; UI); its motion missed M (…)`
line after its touch; a switch with no line missed none. "Runs" is `perf.ts run` invocations, two
a session, sessions alternating before, after, before, after.

**Full effects** (the glass's blur and refraction, what a fresh install draws):

| Slide starts                  | Scenario     | Runs | Steps | `tab.commit` |  Response | First frame |     Settle | UI frames missed | Slide's UI frames missed | Slide's longest UI gap |
| ----------------------------- | ------------ | ---: | ----: | -----------: | --------: | ----------: | ---------: | ---------------: | -----------------------: | ---------------------: |
| in the commit (before)        | `tab-switch` |    4 |   108 |      31 / 42 |   53 / 75 |   136 / 192 |  633 / 688 |            5 / 6 |                    4 / 5 |               83 / 133 |
| after the first frame (after) | `tab-switch` |    4 |   108 |      32 / 43 |   57 / 87 |   130 / 191 |  658 / 703 |            5 / 6 |                    4 / 5 |               83 / 117 |
| in the commit (before)        | `tab-first`  |    4 |    40 |    100 / 124 | 118 / 156 |   248 / 263 |  703 / 769 |            4 / 5 |                    3 / 4 |              133 / 167 |
| after the first frame (after) | `tab-first`  |    4 |    40 |    103 / 130 | 121 / 162 |   243 / 280 |  690 / 808 |            4 / 6 |                    4 / 5 |              133 / 167 |
| in the commit (before)        | `rapid-tabs` |    4 |    20 |            – | 196 / 309 |     31 / 89 |  838 / 947 |            5 / 6 |                    4 / 4 |              100 / 133 |
| after the first frame (after) | `rapid-tabs` |    4 |    20 |            – | 203 / 313 |     33 / 83 | 894 / 1066 |            6 / 7 |                    4 / 5 |              100 / 117 |

Every warm switch of both builds missed UI frames in its slide (108 of 108 each).

**Simple effects** (a weak verdict written before the runs, so no blur), `tab-switch`, one session
of two runs each:

| Slide starts          | Runs | Steps | First frame |    Settle | UI frames missed | Slide's UI frames missed | Slide's longest UI gap |
| --------------------- | ---: | ----: | ----------: | --------: | ---------------: | -----------------------: | ---------------------: |
| in the commit         |    2 |    54 |     44 / 67 | 535 / 601 |            5 / 7 |                    4 / 5 |               83 / 117 |
| after the first frame |    2 |    54 |     44 / 57 | 559 / 609 |            6 / 7 |                    5 / 5 |               83 / 100 |

**Where a warm switch's frames go** (gfxinfo's per-frame parts, median of each step's mean, ms):

| Effects | Slide starts          | UI traversal | UI draw | Render thread issue |  GPU | Frames within 16 ms |
| ------- | --------------------- | -----------: | ------: | ------------------: | ---: | ------------------: |
| full    | in the commit         |          0.1 |     0.9 |                51.0 | 35.5 |         19 of 1,677 |
| full    | after the first frame |          0.1 |     1.1 |                52.3 | 35.2 |         24 of 1,704 |
| simple  | in the commit         |          0.1 |     0.7 |                25.3 | 37.6 |           67 of 966 |
| simple  | after the first frame |          0.1 |     0.7 |                27.5 | 38.6 |           70 of 983 |

## What the numbers say

- **On this AVD every moving frame is slow, so the slide's start can't save frames there.** The
  UI thread spends about a millisecond on each frame; the render thread's issue (25 to 52 ms) and
  the GPU (35 to 39 ms) take the rest. The emulator draws through SwiftShader, a CPU renderer, so a
  full-screen frame that changes costs that much whatever moves it. The slide is 280 ms long, so it
  spans about four such frames, and about four are what it misses, with either start and either
  effects. The frames the old start shared with the tab's attach are a small part of that here.
- **The glass's blur isn't it either.** Without it the render thread's issue halves (51 to 25 ms)
  and the tab's first frame comes 90 ms sooner (136 to 44 ms), but the GPU time stays, and so do
  the slide's missed frames.
- **What the later start costs.** The slide ends two UI frames later, so the switch settles later:
  25 ms on a warm switch (633 to 658 ms), 56 ms after ten rapid taps (838 to 894 ms; each tap's
  entry waits for its tab's first frame). On a 60 Hz phone two frames are 33 ms. The tab's first
  frame, `tab.commit` and the response didn't move beyond run-to-run noise.
- **The host's GPU couldn't be used instead.** The PC has an Intel UHD and a GTX 1650; the AVD
  started with `-gpu host` booted and then crashed ("Your GPU cannot be used for hardware
  rendering"), so no run measured the slide with a hardware GPU.

## What changed

- `apps/mobile/src/chrome/tabEntry.ts`: `enter` runs on the UI thread. It sets the slide's start
  (half opaque, offset towards the tapped tab's side; under reduce motion, no offset), waits one
  UI frame (the one that mounts, attaches and draws the tab: `enter` runs from the layout effect of
  the commit showing it, so that commit's mount items are queued before the frame), then starts the
  280 ms timing on the next one, once the first is drawn. A newer tap's entry takes over one still
  waiting. The slide's finish callback still ends the tab switch's timing. Test:
  `chrome/tabEntry.test.ts`, with fake UI frames.
- The native UI frame counter (`modules/wave-native`, `log/TransitionFrames.kt`) takes a mark,
  `markTimingFrames(id, atMs)`, at the UI frame the slide starts on (Reanimated's frame timestamp,
  Choreographer's clock as the counter's own), and counts apart the gaps that began at or after it.
  JVM tests in `TransitionFramesTest.kt`; JS in `lib/timing.ts` (`timingMotionStarted`).
- Core's `missedFramesLine` (`packages/core/src/timing.ts`) adds `; its motion missed N (longest
gap …)` when a transition's motion was marked. Test in `frameTiming.test.ts`.
- `docs/spec.md`, the frame-lane paragraph.

## How the numbers were taken

Two perf APKs from one native build (`EXPO_PUBLIC_WAVE_PERF=1`,
`assembleRelease -PreactNativeArchitectures=x86_64`); only their JS bundle differs (checked by
hash). Each session, under the PC's emulator lock: install, seed the reference Library
(`node scripts/perf/seed.ts`: 3,000 songs, 60 playlists), turn the network off, then

```sh
node scripts/perf/perf.ts run --serial emulator-5554 --scenario tab-first,tab-switch,rapid-tabs \
  --compile speed --label 1536-<before|after>-r<n> --commit f108283fa
```

twice, then the app log's `WaveTiming` lines and the emulator's clock. The simple-effects runs
wrote `wave.phoneEffects.verdict` (`simple`) into Wave's key-value store after the seed and ran
`tab-switch` only; every launch in them logged `Phone effects: simple`. Each step's UI line is
matched by the step's touch time (the emulator's uptime) against the log's wall clock, within 4 s.

## What the phone log should show

On the first `ti` release with this change, the owner's exported log (WaveTiming):

- `Tab to /library missed N frames (longest gap … ms; UI); its motion missed M (longest gap … ms)`:
  the criterion is M = 0, that is no such line, or lines whose motion missed 0, on switches to a
  tab already visited. N can stay above 0: it counts the whole switch, the tab's first frame
  included. Spec #1528's report had the slide losing 1 to 4 frames at its start.
- `Speed since …`: the tab kind's settle a frame or two later (the slide ends later); its first
  frame and response unchanged.
- If M stays at 1 or more on the phone, the slide's own frames are too costly there as well, and
  the next step is what each slide frame draws (the moving tab under the glass), not when it
  starts.
