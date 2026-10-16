# #316 Floating glass: what it costs a frame, and a controlled way to find out

Ticket: #316 (parent #301). Branch `feat/316-glass-frame-budget`, based on `perf/301-performance`
at 7dc8532.

## The work glass does per frame (7dc8532)

Code reading, not measurement. Each `WaveGlassView` (`modules/wave-glass`):

- **UI thread, every window pre-draw** (any frame the window draws, for any reason): finds its
  backdrop (cached), takes two `getLocationInWindow`, and records the whole backdrop view into its
  own `RenderNode` with `target.draw(canvas)`. The recording holds the backdrop's own drawing and
  references to its children's RenderNodes, not copies of them.
- **RenderThread and GPU, every frame drawn**: the node has a `RenderEffect` (24 dp blur, then on
  API 33+ the AGSL refraction), so HWUI renders it into an offscreen layer the size of the glass:
  it replays the backdrop clipped to the glass, blurs it, runs the shader, then draws tint and rim.

A tab screen has three glass views over `BACKDROP.tabs` (the tab bar pill, the Search pill and the
mini player). A pushed Library screen has one (the mini player over `BACKDROP.library`). Dialogs
and the toast add one each over `BACKDROP.root` while shown. So a scrolling tab screen does three
backdrop recordings and three blurred layers per frame. An idle screen draws no frames, and glass
schedules none itself.

What re-recording less could and couldn't save, from HWUI's source (unverified on the phone):
the glass node draws the backdrop's children a second time, beside their own place in the tree.
HWUI marks full damage on a RenderNode that it reaches twice in one frame, so every glass layer
re-renders on every frame the window draws, whether or not its own recording changed. Skipping
recordings therefore saves UI thread time (the "pre-draw and layout" part below) and nothing on
the RenderThread or GPU. Only drawing fewer or cheaper layers (smaller blur, no refraction, fewer
glass views) or reusing a still snapshot would cut the RenderThread side. All of those change the
look, or how live it is, so none ships without phone numbers.

## What this ticket built

**A controlled comparison, the glass probe.** Core `glassLayers(settings, probe)` decides what a
glass view draws. A perf build reads the probe from its launch intent (`--es wave.perf.glass
<probe>`, put there by the runner's `--glass`) and reports it with the glass settings in its first
flush. Every other build ignores it and draws the shipped glass.

| Probe       | Backdrop recorded | Blur | Refraction | Difference to the next row                    |
| ----------- | :---------------: | :--: | :--------: | --------------------------------------------- |
| `live`      |    every frame    | yes  |    yes     | `live` − `blur` = the refraction shader       |
| `blur`      |    every frame    | yes  |     no     | `blur` − `record` = the blur and its layer    |
| `record`    |    every frame    |  no  |     no     | `record` − `off` = recording and redrawing it |
| `off`       |        no         |  no  |     no     | the screen's own cost, plus tint and rim      |
| `coalesced` |  once, if dirty   | yes  |    yes     | `live` − `coalesced` = the redundant records  |

`coalesced` is the candidate change, built but not shipped. The glass views over one backdrop share
one recording of it (`SharedBackdrop.kt`), redone only when the backdrop is dirty or resized, and
each glass node re-records only its offset when it moves. It should look exactly like `live`. One
known difference: the shared recording is clipped to the backdrop's bounds, where `live` clips to
the glass. Every backdrop fills the screen and every glass sits inside it, so that should not
show.

**The runner** (`scripts/perf`, see the README):

- `--glass <probe>` launches every scenario with the probe and refuses to measure when the perf
  build reports a different one (or isn't a perf build), so a probe run can't silently measure the
  shipped glass. `compare` prints each side's probe and glass settings.
- Frame parts on every step, from gfxinfo framestats: pre-draw and layout (where glass records),
  draw, sync, issue (where the blur layers render) and GPU after the swap. These are the frame
  traces the attribution reads; `--perfetto` adds the full trace.
- Glass scenarios (`--scenario glass`): `scroll-home` and `scroll-songs` (flings with content moving
  under the glass) and `idle-home` (frames drawn on an untouched screen).

The FrameMetrics meter in `WaveGlassModule` (the spike screen's readout) wasn't wired into the
runner. gfxinfo framestats carries the same FrameInfo timestamps per frame, needs no perf build and
lines up with the touch on the same clock. The meter stays for the spike screen.

**Shipped default change, appearance-preserving:** a glass view that isn't shown (`isShown` false:
it or an ancestor not `VISIBLE`) no longer records its backdrop. It draws nothing that frame; when
it's shown again, the pre-draw before its first draw records first. How often glass is attached but
hidden in Wave hasn't been checked on the phone, so this saves something or nothing, never pixels.

## What was measured

Nothing on the phone: it wasn't attached during this work. There's no desktop benchmark either.
Glass cost is RenderThread and GPU work on the device, and a desktop number would say nothing
about it. Checked off the phone: the Kotlin compiles (`:wave-glass:compileReleaseKotlin`), the
runner's dry run covers the probe, the flings and the frame parts, and Core and the runner's tests
pass.

## Device: pending

One perf build of this branch serves every probe (build it as the README says). With the mini
player paused and the S24+ set up per the README:

```sh
# ABBA order, so thermal drift doesn't land on one probe
for probe in off record blur live coalesced live blur record off; do
  node scripts/perf/perf.ts run --scenario glass,tab-switch,push-library,now-playing \
    --glass $probe --label 316-$probe
done
node scripts/perf/perf.ts compare perf-results/316-off-….jsonl perf-results/316-live-….jsonl
```

Then, one comparison per pair in the table above. Look at:

- `scroll-*` fling steps: deadline-miss rate, frame p90/p99, and the parts. Glass recording shows
  in pre-draw and layout; blur and refraction in issue and GPU after swap.
- `idle-home`: frames rendered should be 0 under every probe. Anything else is idle rendering, and
  the probe that changes it says whether glass is involved.
- Navigation (`tab-switch`, `push-library`, `now-playing`): `live` against `off` says how much of
  the navigation stalls is glass at all.

For the shipped `isShown` skip, compare a perf build of 7dc8532 (run without `--glass`) with this
branch's `live`.

How to decide, once there are numbers:

- `live` − `off` small next to the 8.3 ms budget at 120 Hz (say under 1 ms p90 on every part, and
  no change in deadline misses): glass isn't material. Record that negative result and keep the
  glass as it is.
- `live` − `coalesced` shows in pre-draw and layout with the same miss rate or better: make
  `coalesced` the default (one line in Core's `glassLayers`), after a visual check of scrolling
  under the glass, a tab switch, Now Playing over it, a dialog and a theme change.
- `blur` − `record` or `live` − `blur` dominates: that's the RenderThread cost the
  re-recording can't touch. Options are a smaller blur or refraction default, refraction off on
  the pill-shaped Search glass, or snapshot reuse while idle. Each changes the look and needs the
  owner's call.

## Behavior kept

- Without a probe (every normal build, and perf builds launched without `--glass`) `glassLayers`
  returns the settings as they are: same blur, refraction, tint and rim (Core tests).
- `live`'s native path is unchanged apart from the hidden-view skip. `coalesced` is only reachable
  through a probe.
- The spike screen (`/dev/glass`) still uses the live view and its frame meter.

## Not measured, and negative results

- Every device number above: **pending**.
- Whether `(tabs)` stays attached and shown under pushed Library screens (if it does, its three
  glass views keep recording while covered and `isShown` doesn't catch it, since covered isn't
  hidden). The trace's pre-draw time on `push-library` with `live` against `off` will show it.
- The HWUI damage reasoning above comes from reading AOSP, not from a trace. A Perfetto trace of a
  fling (`--perfetto`, `RenderThread` slices) shows whether glass layers re-render on frames where
  only the chrome changed.
