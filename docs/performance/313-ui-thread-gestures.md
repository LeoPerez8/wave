# #313 Seeking and Queue dragging on the UI thread: frames and JavaScript calls per gesture

Ticket: #313 (parent #301). Branch `feat/313-ui-thread-gestures`, based on `perf/301-performance`
at 761375e.

## What was measured

Two scenarios were added to the runner for this ticket (see the [README](README.md)):

- `scrub`: Now Playing's scrubber dragged 240 dp forward, then back, a second each (`forward`,
  `back`).
- `queue-drag`: the first Up Next row dragged three rows down by its handle, then back up (`down`,
  `up`). The queue needs four songs up next.

Both use the new `drag` action (`input swipe`, in dp from a target's centre). A drag has no
response mark. What matters is the window's frames (how many rendered, how many missed their
deadline), the first frame after the touch, and how much the gesture asked of JavaScript:

- `renders Scrubber`, `renders UpNextRow`, `renders UpNextList`;
- `renders js:<name>`, one per call a gesture made to JavaScript (`perfCount`): `js:scrub.move`,
  `js:scrub.release`, `js:upNext.start`, `js:upNext.move`, `js:upNext.target`, `js:upNext.end`.

Three conditions, each before and after:

1. **Idle** perf build: `--variant idle`.
2. **Under import load**: `--variant import` (needs the fixture's `importLink`).
3. **Controlled JavaScript stall**: a perf build bundled with `EXPO_PUBLIC_WAVE_PERF_STALL_MS=1500`
   blocks the JS thread for 1.5 s on every touch, longer than each drag. Before, the scrubber and
   the lifted row can't move until the stall ends. After, they should follow the finger all the
   way through it: frames keep rendering during the stall, and the first frame comes about one
   refresh after the touch.

Builds:

- **Before**: commit d2997e2. It has the runner changes and the counters on the old gestures, and
  nothing else of this ticket.
- **After**: commit f5a44e5, this ticket's change on the same base. The branch head also merges
  other #301 tickets (#303, #311, #314), which would muddle the comparison.

```sh
node scripts/perf/perf.ts run --scenario scrub,queue-drag --variant idle,import --label 313-before
node scripts/perf/perf.ts run --scenario scrub,queue-drag --variant idle --label 313-before-stall   # stall build
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

## Before (d2997e2)

**Pending.** No phone was attached, so there are no device numbers. From the code:

- **Scrubber:** the pan ran on JavaScript (`runOnJS: true`). Every move called JavaScript and set
  React state, so the scrubber re-rendered and rebuilt the elapsed wave's SVG path each time: one
  `js:scrub.move` and one Scrubber render per touch event, plus one `js:scrub.release`.
- **Queue drag:** the handle's pan moved the lifted copy on the UI thread, but every move also went
  to JavaScript (`scheduleOnRN(move)`). There, JavaScript worked out the drop target and moved the
  other rows with `withTiming`. Auto-scroll was a `requestAnimationFrame` loop on JavaScript that
  called `scrollToOffset`. That's one `js:upNext.move` per touch event, plus the scroll loop's frames.
  When JavaScript was busy, the copy still moved but the rows didn't step aside, and the list
  didn't auto-scroll.

## After (f5a44e5)

**Pending**, as above. What the code now does:

- **Scrubber:** the pan callbacks are worklets. The finger's position is a shared value. The line
  and the wave are `Path`s whose `d` and `strokeWidth` are animated props. The elapsed and remaining
  times are `TextInput`s whose `text` is an animated prop, shown over the React labels only while a
  finger or a release is on the bar. Per drag, JavaScript gets one `js:scrub.release`, which seeks.
  The scrubber renders once more, to let go of the release once the seek shows. None of this
  happens per move.
- **Queue drag** (`apps/mobile/src/nowPlaying/upNextDrag.ts`): on the UI thread, the drop target
  (`reorderTarget`), the other rows stepping aside (a reaction per row on the shared drop target,
  `reorderShift`), the edge auto-scroll (`useFrameCallback` + `scrollTo`, speed from Core's new
  `reorderScrollSpeed`) and the drop settling into its slot. JavaScript gets one `js:upNext.start`
  (the lifted copy, a haptic), one `js:upNext.target` per new drop target (a haptic) and one
  `js:upNext.end` (the move). Until JavaScript has drawn the lifted copy, the dragged row follows
  the finger itself, so a drag that starts during a stall moves at once.

Expected on the phone: per drag, `js:*` counts go from one per touch event (about 120 a second on a
120 Hz panel) to one per release, or start + targets + end. Scrubber renders per drag drop from
one per move to two or three. In the stall build, the first frame should come about a refresh
after the touch instead of after the stall. Record the real numbers here.

## Behavior kept

- **Seek limits:** `scrubPosition` still clamps to 0..duration. The bar shows
  `min(position, duration)`.
- **Cancel:** a cancelled scrub seeks nothing and the bar returns to the playhead. A cancelled Up
  Next drag (another gesture took the touch) settles back into its own slot and moves nothing.
- **Interruptions and simultaneous changes:**
  - A scrub released after the playing entry changed (a skip, the queue moving on) doesn't seek
    the new song. The check is by queue entry key, on JavaScript at release.
  - A queue change under an Up Next drag moves the dragged entry's index (`from`). The drop target
    stays the slot under the finger, so the gap moves with the list.
  - A count change re-clamps the target.
  - An entry that leaves Up Next while dragged (it started playing, or was removed) ends the drag
    without a move.
  - A handle touched while a drop is still landing waits until the new order is rendered, as
    before.
  - Drops are still named by their neighbours (`upNextMove`) and kept on screen until the queue
    has them (`withPendingMoves`).
- **Edge auto-scroll:** same edge (one row) and speed (12 rows a second at the edge). Now on the UI
  thread. It's active only while JavaScript knows a row is lifted, so an idle Queue runs no frame
  callback.
- **Hit testing:** same handle and scrubber views and gesture configs (`minDistance: 0`).
- **Haptics:** light impact on drag start and on a seek, selection on each new drop target. They
  still go through JavaScript (`expo-haptics`), so a busy JS thread delays them.
- **Screen readers:** the scrubber's adjustable role, value and ±10 s actions, and the rows' Move
  up / Move down / Remove actions, are unchanged. The UI-thread time labels are hidden from
  accessibility. The React labels stay in the tree.
- **Reduced motion:** both gestures animate only through `withTiming`, which follows the system's
  reduce-motion setting by default (`ReduceMotion.System`): rows jump aside and a drop lands at
  once, as before.
- **Tests:**
  - Core: `reorderScrollSpeed` (`reorder.test.ts`) and a check that every Core function the app
    calls from a worklet starts with the `"worklet"` directive (`worklets.test.ts`). Full suite:
    1,771 pass.
  - App: 281 pass.
  - Runner: the new drag action and scenarios on the simulated phone, and `parseDensity`. 47 pass.
  - Typecheck: app, Core and `scripts/perf`.
- **Worklet transform (desktop check):** every changed file went through the app's Babel preset
  (`babel-preset-expo`, which adds `react-native-worklets/plugin`). Every function marked as a
  worklet came out workletized: 14 in `Scrubber.tsx`, 24 in `upNextDrag.ts`, and all of them in
  Core's `time.ts`, `reorder.ts`, `elapsedWave.ts`, `wavyUnderline.ts` and `position.ts`. This
  doesn't replace running the app.

## Not measured, and what to check on the phone

- **Device numbers: pending.** Nothing was run on the phone and no APK was built: no phone was
  attached, and other Gradle builds were running. Run the commands above with the before and
  after builds, then record the tables here.
- **Not seen running yet.** A first manual check on the phone should cover:
  - the time labels: the `TextInput` overlay lines up with the React `Text` (font padding,
    baseline), and nothing jumps when a scrub starts or ends;
  - the empty `d` (`""`) the line and wave get at the bar's ends;
  - auto-scroll through `refScrollView` on Legend List's inner ScrollView (`scrollTo` and
    `useScrollOffset` with Legend List's own JS `onScroll` at the same time);
  - a drag started during a JS stall: the row follows the finger before the lifted copy appears.
    It may draw under the rows below until then, because Legend List stacks rows in order.
- **Limit of the stall build:** it stalls at touch-down, so it shows what happens when JavaScript
  is busy for the whole gesture. Stalls in the middle of a gesture come from the import variant.
