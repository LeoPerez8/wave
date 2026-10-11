# Spike: glass material on Android (#4)

Status: **technique A in use by the tab bar and mini player (#8), waiting for measurements
on the S24+.** The decision below is confirmed once the table has numbers.

The spec calls glass on Android "the main technical risk": the tab bar, mini player and
Now Playing controls need a material with backdrop blur, edge refraction and a specular
highlight, at 120 Hz, over native views that React Native Skia cannot sample directly.

## How to run it

1. Install the PR's APK and open **Home → Developer: glass spike** (or `wave://dev/glass`).
2. Pick a technique with the chips at the top. The glass tab bar sits at the bottom over
   colourful rows with black/white stripes and thin text (good for judging refraction).
3. Turn on **Auto-scroll** (scrolls at a constant 1,400 dp/s and bounces) and wait ~5 s.
4. Copy the **5 s** line of the readout into the table below. Repeat with a manual fling.

The readout comes from Android's `FrameMetrics` for the window, so it measures the full
frame (UI thread, RenderThread and GPU), which is where blur and shader cost shows up.
"Late" counts frames that finished after their deadline (dropped or delayed frames).

## Techniques

### A · Native RenderEffect + AGSL refraction (`modules/wave-glass`)

`WaveGlassView` is a native view placed over the content. Before every frame it records
the backdrop view (found by its `nativeID`) into a `RenderNode`, offset so the part under
the glass lines up. Recording only references the backdrop's existing display lists, so it
is cheap. The node gets a `RenderEffect`: a Gaussian blur chained into an AGSL
`RuntimeShader` (API 33+) that bends the backdrop near the rounded edge, like the curved
rim of a lens, and adds a specular highlight lit from the top left. A tint and a 1 dp
gradient rim stroke are drawn on top. Everything runs on the RenderThread.

- Live: anything behind the glass — images loading, animations, video — shows through.
- Needs API 31 for blur and API 33 for the shader (the S24+ is on Android 14+).
- Spike shortcut: the view invalidates itself on every pre-draw, so it renders frames even
  when nothing moves. A production version should only re-record when the backdrop
  changes (scroll events, or the backdrop's own invalidations).

### Fallback · Blur + tint + rim

Technique A with the shader off (`refraction = 0`): Gaussian blur, tint and the rim stroke.
This is the spec's fallback if refraction costs too much.

### B · Skia snapshot (`@shopify/react-native-skia`)

Skia can't read native views, so the scroll content is snapshotted once with
`makeImageFromView` and drawn inside a Skia `Canvas` behind the glass, offset by the
scroll position on the UI thread (a Reanimated shared value). Blur is a Skia `Blur`
image filter and refraction is the same maths as A, in SkSL as a `RuntimeShader` image
filter. The readout also shows the snapshot size and how long it took.

- Works on any API level Skia supports.
- The snapshot is a still: it goes stale whenever the content changes (artwork loading,
  list updates, theme) and must be retaken, which costs time and memory proportional to
  the content height. Long lists would need per-screen or per-tile snapshots.

### Baseline · No blur

An opaque-ish rounded surface, no effects. Shows what the device does without glass, so
the other rows can be read as overhead.

## Measurements (S24+, 120 Hz)

Fill in from the 5 s line of the readout. "Look" is a quick note on visual quality:
smoothness of the blur, whether the edge refraction reads as glass, artefacts.

| Technique                    | Auto-scroll fps | Avg ms | p95 ms | Late frames | Fling feel | Look |
| ---------------------------- | --------------- | ------ | ------ | ----------- | ---------- | ---- |
| A · Native refraction        |                 |        |        |             |            |      |
| Fallback · Blur + tint + rim |                 |        |        |             |            |      |
| B · Skia snapshot            |                 |        |        |             |            |      |
| Baseline · No blur           |                 |        |        |             |            |      |

Snapshot cost for B (from the readout): ___ × ___ px in ___ ms.

## Decision

**Technique A, chosen for #8 pending on-device numbers.** The tab bar, the Search pill and
the mini player use `WaveGlassView` with a 24 dp blur and 12 dp edge refraction
(`GLASS` in `apps/mobile/src/glass/Glass.tsx`). A was the expected winner going in: it is
live (B is a still that goes stale), it runs entirely on the RenderThread, and its
fallback is the same view with the shader off. B stays in the spike screen only.

- **Fallback is one line:** set `refraction: 0` in `GLASS` to get blur + tint + rim. Below
  API 33 the view already drops the shader by itself.
- **Production change from the spike:** the view no longer invalidates itself on every
  pre-draw. It re-records the backdrop whenever the window draws a frame anyway (a scroll,
  an image loading) and lets the RenderThread pick the new recording up, so an idle
  screen renders no frames. The spike screen's readout still works while scrolling.
- **Backdrop rule:** the glass records a backdrop found by `nativeID`, so the backdrop
  must be a sibling of the glass, never an ancestor (the glass would draw itself). The
  tab screens and the pushed Library stack each sit in such a backdrop view.

Still to do on the S24+: fill in the table above, then confirm or switch to the fallback
(or B) here.
