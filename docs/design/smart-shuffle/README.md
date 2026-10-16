# Smart Shuffle icon review

Eight SVG candidates across the review rounds. These are design studies; the production icon stays unchanged until the owner chooses and refines a direction.

Tracked in [#320](https://github.com/LeoPerez8/wave/issues/320), one ticket covering the comparison, review rounds and final integration.

From the repository root:

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory docs/design/smart-shuffle
```

Open <http://127.0.0.1:4173>. Select a drawing to preview the Queue's 20 px control and a page's 24 px action. Each option also appears at 32 px and enlarged. Switch themes and tap the preview controls to compare on and off states. The selection and theme are shareable URL parameters, for example `?variant=3&theme=dark`.

The original spark (0°) and rotated spark (45°) stay side by side above the eight directions, including in narrow previews. Click either to see that orientation in the controls and change option 3's SVG download. Its angle is also shareable, for example `?variant=3&theme=dark&rotation=0`.

1. **Quiet brain.** An outline and central division; no arrows or interior marks.
2. **Guided brain.** A smaller brain with arrows outside its outline.
3. **Single spark.** Shuffle with a spark replacing one arrowhead, rotated 45 degrees in the owner's first refinement.
4. **Focus dot.** Shuffle with a single dot above the paths.
5. **Tuned mix.** Two arrows with adjustable lanes suggest balancing the mix.
6. **Flow loop.** An open, interwoven loop and one arrow suggest continuous mixing.
7. **Crossed mix.** Tuned mix's two adjustment points feed crossing paths, making the change of order visible.
8. **Mix junction.** One adjustment point sits at the crossing, combining tuning and shuffle in one shape.

The candidates use a 24 × 24 viewBox, 1.5 px strokes, rounded caps and `currentColor`, matching Wave's line icons. Each SVG can be downloaded from the page. No network assets, libraries, accounts or playback services are used.

`reference-current.svg` reproduces the Smart Shuffle icon at commit `2c53073ab94c63f69662ed01544d0107dc14eb9f`, the latest #299 pipeline inspected for this review. The comparison uses Wave's shipped light and dark colors from `apps/mobile/global.css`. The Real Shuffle reference uses the existing Tabler icon geometry.
