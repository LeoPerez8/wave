# #1531 Every JS block in the log names what caused it

Ticket: #1531 (spec #1528). Branch `feat/1531-name-every-js-block`, based on the
`feat/1528-screens-show-at-once` integration branch.

## What logged as "no background work"

A block got a name only from a timed render (`useRenderCost`, `RenderCost`), a frozen tab shown
again (#1490), a background slice, a named work's window, or a startup step. Anything else wrote
`by no background work`.

The owner's exported log (Xiaomi 25118PC98G, Wave 0.93.2-ti) has 589 such blocks from 26 to 28
November, 49.8 s in all, median 72 ms, p90 107 ms, longest 458 ms. 400 were on Home, 124 on DJ,
46 on Settings, 12 on Playlists. That log can't say what ran in them, so the split below is by
what else the log wrote within 2 s of each one, and is a lead, not a cause:

| Written within 2 s                                    | Blocks | Time   |
| ----------------------------------------------------- | ------ | ------ |
| A named block (244 of them `Genre mix artist lookup`) | 311    | 23.9 s |
| Nothing at all                                        | 141    | 12.3 s |
| A tab switch, push, pop, Now Playing or Queue timing  | 61     | 5.6 s  |
| A slow Library read (`Read "…" held JS`)              | 42     | 4.9 s  |
| A song change (`WaveGain`, `WaveCrossfade`)           | 27     | 2.6 s  |
| A network line (`WaveNetwork`, `WaveYtAudio`)         | 6      | 0.4 s  |
| A scan                                                | 1      | 0.1 s  |

Other named blocks beside them: `rendering DjScreen` 72, `rendering PlayerView` 31, Library
writes about 60, `rendering tab:index` 21, `rendering (tabs)` 20, `rendering MiniPlayer` 20.
Around `Genre mix artist lookup` (16:25 on 27 November), every third or fourth block of the run
was unnamed: the lookup's work between its slices (a read's answer, Effect's turns), which ran
outside the slices that name it.

Reading the code for what runs on the JS thread outside every named span (#1447's items 2 to 4,
#1490's "Left over"):

1. **Renders no `RenderCost` covers**: a row, a sheet or a section that a store notification
   re-renders, and every render under an untimed parent. React commits them like any other.
2. **React's passive effects** (`useEffect`), which run in their own task after a render's
   commit unless the render was urgent.
3. **Timers and frame callbacks** (`setTimeout`, `setInterval`, `requestAnimationFrame`),
   including the ones the block log itself and the scheduler use.
4. **Effect's turns**: Effect yields through `setImmediate` (a microtask in bridgeless React
   Native), so a fiber's work after an `await` of a native answer runs there.
5. **Native events**: React Native's emitter (network answers, keyboard, app state) and Expo
   modules' listeners (`onJobsChanged`, `onSessionChanged`, timing frames, playback).
6. **Touches**: the handlers React runs for a touch.
7. **What JS can't see**: a TurboModule's promise or callback answer that no timer, event or
   render follows, and Hermes's garbage collection.

## What changed

- `reactCommitHook.js`, a Metro polyfill, gives React's production renderer a minimal
  `__REACT_DEVTOOLS_GLOBAL_HOOK__` before any module loads. The renderer then reports each
  commit (`onCommitFiberRoot`, after the layout effects) and each run of passive effects
  (`onPostCommitFiberRoot`). Release builds only; debug builds keep React DevTools' own hook. In
  a release bundle of this branch (`expo export:embed --dev false`) the hook is set at line 867,
  among the polyfills, and the renderer looks for it at line 18963.
- `lib/jsEntries.ts`, installed right after the app log (`index.ts`), wraps the ways into the JS
  thread: timers, frame callbacks, `setImmediate` (Effect), React Native's emitter and Expo's
  `EventEmitter` listeners. Each run of a millisecond or more is reported with its kind. Nothing
  is timed until the block log listens.
- Core's block log (`createJsBlockLog`) takes those runs (`entryRan`), React's commits
  (`committed`) and effect runs (`effectsRan`), and the root's touches (`touched`). When no
  timed render, slice, named work or startup step names a block, it says what held most of it:
  - `by rendering untimed components`: React rendered, from the latest run that ended before
    its commit (or the block's start) to the commit;
  - `by running effects after a render`: from the commit (or the latest run before) to the end
    of its passive effects;
  - `by running a timer`, `by running a frame callback`, `by running a setImmediate callback`
    (Effect's turns come this way, but so may anything else, so it doesn't name Effect),
    `by handling native event <name>`; a render committed inside a run's own call (a
    `flushSync`) is that run's;
  - else `by handling a touch` when a touch began or ended in the block;
  - else `by unseen work (a native callback or GC)`.

  No block says `by no background work`. The order is in `docs/spec.md` (Logging, the JS block
  line). Named work keeps its precedence, so no block that had a name before changes it.

## Tests

- Core: `jsBlocks.test.ts` has 10 new cases for the kinds and their order; the 7 that expected
  `no background work` now expect `unseen work (a native callback or GC)`.
- App: `lib/reactCommitHook.test.ts` loads the polyfill, then React's test renderer, and checks
  that a mount and an update reach the listeners as commits and effect runs; that the polyfill
  leaves an existing hook alone; and that Metro lists it last among a platform's polyfills.
  `lib/jsEntries.test.ts` covers each wrapper, arguments and `this`, errors, the 1 ms floor, and
  removing an Expo listener by itself or by its subscription.

## Emulator results (code review of #1539)

AVD `wave-run-903` (android-36 x86_64, SwiftShader), the reference seed (3,000 songs), network off,
perf build of `fix/1528-code-review` at `1b9227e36`, 28 November. One session, from the seed to the
end, read from `files/logs/wave.log`: `perf.ts emulator-check` (one iteration of the reference taps:
every tab, Settings and two of its pages, DJ, a Magic Queue, Library's pages, an album, an artist, a
playlist, Now Playing and the Queue), then `perf.ts run` with `tab-first` (6 cold launches, 12 first
visits), `tab-switch` (40 switches), `skip-library` (11 song changes) and `now-playing` (11 opens and
closes). It logged 190 `JS blocked` lines; none says `no background work`:

| Kind                                                                           | Blocks |
| ------------------------------------------------------------------------------ | -----: |
| `rendering <name>` (a timed screen or section)                                 |    130 |
| a named slice or work (`Home mix inputs` and so on)                            |     52 |
| `rendering untimed components`                                                 |      3 |
| `unseen work (a native callback or GC)`                                        |      3 |
| `startup …`                                                                    |      2 |
| a timer, frame callback, setImmediate callback, native event, effects or touch |      0 |

The named renders were Home's sections (77), `(tabs)` (22: eleven at launches on `/`, nine pushes
over the tabs and two on Library, see `1534-tab-switch-renders.md`), `PlayerView` (19, a song
change's closed Now Playing, #1547), `HomeScreen` and `HomeContent` (4 each), `UpNextList` and
`ArrangeablePlaylists` (2 each). So 3 of 190 blocks, under 2%, fell to `unseen work`, against 589
`no background work` lines in the owner's log before this ticket. The integration tip before the
review fixes (`b079ddac7`), measured the same way, logged 212 blocks with no `unseen work` and one
`rendering untimed components`.

The phone confirms the split from the owner's next exported log on the `ti` release, and whether
the timing wrappers cost anything visible there (two clock reads per timer, event or
`setImmediate` callback; nothing is written unless a long task happens).
