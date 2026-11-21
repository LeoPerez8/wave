# #1380 Home and Now Playing: only what fits in the first frame

Ticket: #1380 (parent #1346). Branch `feat/1380-first-frame-home-np`, based on `feat/1346-instant`.
It applies #1355's approach (`StagedSections`, Core's `stagedMounts`, `useStagedCount`) to Home,
and the same idea to the carousel's pages and Now Playing's other screens.

**The phone numbers are pending.** Nothing in this doc is a phone or emulator measurement. The
budget is the Fluidity one: Home's first frame, Now Playing open and close, the Queue a swipe away
and Related open and close within 50 ms at the p90 from the native touch (`TIMING_BUDGETS`,
#1347). The reference log had Home's first frame at about 640 ms, of which 39 ms were reads.

## What changed

- **Home mounts the sections that start on screen.** `HomeContent` puts Home's items in
  `StagedSections`, with each item's height from `homeItemEstimate` (`home/homeOpening.ts`): a
  section's heading over the room `HomeSectionSpace` keeps for it, Discover's heading over the
  Magic Queue's grid. New releases, Upcoming shows and Community playlists often draw nothing, so
  they count no height and never push a section that shows out of the first frame. The estimates
  err short, so the bottom of the screen is never empty. The rest mounts a screen a frame. The DJ
  card (#1387) sits in Discover, which is always in the first frame. #1353's snapshot, `homeReady`
  and `HomeSectionSpace` are unchanged: the first frame draws the snapshot's sections, fewer of
  them.
- **The carousel mounts the page in sight first.** Core's new `pagerMounts` gives the order a
  pager's pages mount in, from the one in sight outwards, one step a frame: three pages opening on
  the second mount as [1], then [1, 0, 2]. `MagicQueueCarousel` keeps an unmounted page's slot at
  its width, so offsets and the snapshot's page (#1353) hold.
- **A swipe on the carousel calls JS only when the page changes.** Its `ScrollView` had a JS
  `onScroll` at a 16 ms throttle, which ran JS on every frame of a swipe. It is now an
  `Animated.ScrollView` whose scroll handler finds the page on the UI thread and calls
  `scheduleOnRN(onIndex)` only when it changes (Performance rule 7).
- **A swipe redraws the dots, not the tiles.** The carousel's pages are a memoized
  `MagicQueuePage` that takes the page's seed array, which keeps its identity across a swipe, so
  `setKept` redraws the row's label, dots and wrapper.
- **Now Playing's other screens are drawn before they are needed.** Once the sheet has settled
  open, the Queue and Related's panel mount in a hidden `Activity`, which React renders at low
  priority with no effects. The first swipe to the Queue and the first rise of Related then show
  what is already drawn, as later ones did before. The Queue stays mounted as before. Related's
  panel gets a new key each time it finishes leaving, so it still opens fresh at its first page,
  and its songs are read only once it shows: `usePlayingVideoId` still waits for Related to show.
- **A desktop guard for rule 7.** `gestureJsCalls` (`perf/sourceAudit.mjs`, test
  `perf/gestureJsCalls.test.ts`) fails on a `scheduleOnRN` or `runOnJS` that a gesture's
  `onUpdate` or `onChange`, an animated scroll handler or an animated reaction makes on every
  frame. A call under an `if`, `?:`, `&&`, `||`, after an early return, or in a callback of its
  own passes. Every gesture in the app passes it. Taking the guard out of the carousel's handler
  or `PullRefreshRow`'s arm check makes it fail. It doesn't follow a handler into a worklet it
  calls (`AlphabetSpine`'s `moveOnUI` is checked by reading), and a JS `onScroll` prop isn't a
  gesture handler, so it isn't checked.

Home's stages from `stagedMounts`, on an 800 dp tall, 411 dp wide window, with the default
arrangement (13 items):

| Text size | Mounted per frame   | First frame                                           |
| --------- | ------------------- | ----------------------------------------------------- |
| 1         | 4, 8, 10, 12, 13    | New releases, Upcoming shows, Discover, In your orbit |
| 1.3       | 3, 4, 8, 10, 12, 13 | New releases, Upcoming shows, Discover                |
| 2         | 3, 4, 8, 10, 12, 13 | New releases, Upcoming shows, Discover                |

The rest of Home is mounted by the fifth or sixth frame, about 100 ms, before a scroll can reach
it. Before this ticket the first frame mounted all 13.

**React Compiler.** Off, as #1355 left it, pending the phone comparison in `728-react-compiler.md`.
The new memos (`MagicQueuePage`) are hand-written and pass the `memoDependencies` guard.

## Desktop checks

Run on the development PC (Windows). No emulator or phone was attached (`adb devices` listed
none), so nothing here is a timing.

| Check                                                                                                  | Result  |
| ------------------------------------------------------------------------------------------------------ | ------- |
| Core `stagedMounts.test.ts` (with `pagerMounts`)                                                       | pass    |
| App `home/homeStaging.test.ts`, `lib/stagedCount.test.ts`                                              | pass    |
| App `perf/gestureJsCalls`, `performanceGuards`, `memoDependencies`, `sourceAudit` tests                | pass    |
| App `untranslatedText`, `nowPlaying/linkClose`, `nowPlaying/linkReveal`, `performance/nowPlayingLinks` | pass    |
| `tsc --noEmit` in `apps/mobile`                                                                        | pass    |
| Emulator or phone run                                                                                  | not run |

## Phone run: pending

On the reference phone (Xiaomi 25118PC98G, Android 15), set up as #1347's run says, first with the
release before this ticket (the baseline) and then with the one that carries it:

```sh
node scripts/perf/perf.ts run --scenario reference-taps --label 1380-before \
  --artist "<Library artist on Artists' first screen>" --playlist "<playlist on Playlists' first screen>" \
  --album "<album on Albums' first screen>" --yt-artist "<non-Library artist on that artist's Similar artists row>"
# install the release with #1380, then:
node scripts/perf/perf.ts run --scenario reference-taps --label 1380-after \
  --artist "<same>" --playlist "<same>" --album "<same>" --yt-artist "<same>"
node scripts/perf/perf.ts compare perf-results/1380-before-<time>.jsonl perf-results/1380-after-<time>.jsonl
```

Between phone runs, on an emulator with the release APK:

```sh
node scripts/perf/perf.ts emulator-check --apk <release APK> --artist "<same>" --playlist "<same>" \
  --album "<same>" --yt-artist "<same>"
```

Record here the median and p90 of Home's first frame, Now Playing open and close, the Queue swipe
and Related open and close, and the app log's "Speed since" line. Then, by hand:

- Open Home and scroll to its end at once: no section appears after the scroll reaches it.
- Swipe the Magic Queue carousel to its other pages right after Home opens: they are drawn when
  they slide in, with no pop-in, and the app log shows no JS block during the swipe.
- Open Now Playing and, after it settles, swipe to the Queue and raise Related for the first time:
  each shows drawn in its first frame. Close Related, swipe its carousel to page 2, close and open
  it again: it opens on page 1.
