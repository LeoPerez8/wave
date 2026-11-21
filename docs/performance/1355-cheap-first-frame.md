# #1355 Settings and pushed screens: a cheap first frame

Ticket: #1355 (parent #1346). Branch `feat/1355-cheap-first-frame`, based on `feat/1346-instant`
after #1348. Home and Now Playing belong to #1380.

**The phone numbers are pending.** Nothing in this doc is a phone or emulator measurement. The
budget is the Fluidity one: a push's first frame within 50 ms at the p90 from the native touch
(`TIMING_BUDGETS`, #1347), with the screen's data in memory.

## What changed

- **Sections mount a screen at a time.** Core's `stagedMounts` takes each section's estimated
  height and the viewport, and gives how many sections are mounted in each frame: the first frame
  holds those that start on screen, and each later frame mounts those starting within a viewport
  below what's there. Every frame mounts at least one more, so a tall section can't stall the rest.
  `components/StagedSections.tsx` applies it to its children (`lib/stagedCount.ts` steps one stage
  per animation frame and never takes a stage back). Estimates err short, so a first frame never
  leaves the bottom of the screen empty. A push slides in for about 300 ms, so the frames that
  mount the rest pass during the slide, and a scroll finds them there.
- **Where.** Every `SettingsPageScreen` page (its sections, and a list it renders as an array,
  such as Version History's releases), Settings' own rows, Followed artists' list, Stats' sections,
  DJ's grid, and the artist pages' Similar artists row and album shelves (`CoverRow staged`,
  measured against the window's width). Lists already in a `LegendList` (the song lists, Disliked
  songs, Downloads, Library's lists) virtualise and are unchanged.
- **A tap redraws what it changes.** Settings' rows are memoized and take primitives, so a summary
  that changes (a download finishing, a scan) redraws its own row. DJ's tiles are memoized with one
  stable `onToggle`, so a tap redraws the tiles whose selection changed, not the grid.
- **Drags call JS only when their outcome changes (Performance rule 7).** The arrangement editors
  (`RowReorder`), Settings › Downloads' reorder and its autoscroll, a playlist's and the Playlists
  list's reorder (`listDrag`), and Settings' sliders now find the landing place, or the step under
  the finger, on the UI thread, and call JS only when it changes. They used to call JS on every
  frame of the drag. Core's `sliderValueAt` and `snapSliderValue` became worklets for this, as
  `reorderTarget` already was. Settings › Appearance's colour picker still runs on JS: its colour
  changes every frame of a drag.

Examples from `stagedMounts` on an 800 dp tall, 411 dp wide window:

| Screen              | Sections    | Mounted per frame        |
| ------------------- | ----------- | ------------------------ |
| Settings            | 14 rows     | 14 (fits)                |
| Version History     | 40 releases | 6, then 6 more a frame   |
| Followed artists    | 200 artists | 15, then 15 more a frame |
| DJ (3 tiles a row)  | 60 tiles    | 17, 34, 51, 60           |
| Similar artists row | 20 artists  | 3, then 3 more a frame   |

Settings itself fits on one screen, so its first frame is its rows. What it gained is the memoized
rows, and #1348's reads off the JS thread, which the reference log's 0.8 s to 3 s for its content
waited behind.

## Desktop checks

Run on the development PC (Windows), not the emulator or a phone.

| Check                                                                                  | Result  |
| -------------------------------------------------------------------------------------- | ------- |
| Core `stagedMounts.test.ts` and the whole Core suite                                   | pass    |
| App `lib/stagedCount.test.ts`                                                          | pass    |
| App `perf/performanceGuards`, `memoDependencies`, `startupGuards`, `sourceAudit` tests | pass    |
| App `untranslatedText.test.ts`                                                         | pass    |
| `tsc --noEmit` in `apps/mobile`                                                        | pass    |
| Emulator or phone run                                                                  | not run |

## Phone run: pending

On the reference phone (Xiaomi 25118PC98G, Android 15), set up as #1347's run says, first with the
release before this ticket (the baseline) and then with the one that carries it:

```sh
node scripts/perf/perf.ts run --scenario reference-taps --label 1355-before \
  --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
  --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on that artist's Similar artists row>"
# install the release with #1355, then:
node scripts/perf/perf.ts run --scenario reference-taps --label 1355-after \
  --artist "<same>" --playlist "<same>" --album "<same>" --yt-artist "<same>"
node scripts/perf/perf.ts compare perf-results/1355-before-<time>.jsonl perf-results/1355-after-<time>.jsonl
```

Record here each push step's first-frame median and p90 (Settings, its pages, Disliked songs,
Version History, DJ, the artist pages, Stats), and the app log's "Speed since" line. Then scroll
Version History, Followed artists and DJ's grid at once after opening: no section may appear after
the scroll reaches it. Drag a row in Settings › Layout and a song in a playlist: the app log shows
no JS block during the drag.

The React Compiler comparison runs on the same phone with this ticket's commit
(`728-react-compiler.md`); #1380 uses its decision.
