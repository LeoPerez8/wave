# #1423 — Generic render costs

The reference phone (Xiaomi 25118PC98G, Android 15) is slow across the app. This part of #1423
covers the generic levers: what every screen pays for its primitives, for store subscriptions,
for props that defeat `memo`, and for work done out of sight. Screen-specific costs, scan save
slices and Profiler attribution are on `fix/1423-xiaomi-freezes`.

Everything here was measured in the app's node tests (`react-test-renderer`, with the counting
Reanimated stub in `src/perf/renderHarness.ts`). In node a shared value or an animated style costs
almost nothing, so node mount times are noisy (the same mount ran from 27 to 140 ms between runs)
and only the counts are reliable. On a phone, each shared value and each animated style is a
registration with the UI thread. Phone runs are still to do (see What's left).

## 1. Primitives' per-instance cost

| 150 instances                          | Before                                                       | After                                                      |
| -------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| `Press` (through `CardTile`/`CardRow`) | 300 shared values, 150 animated styles                       | 0 shared values, 0 animated styles                         |
| `SwipeableRow`                         | 450 shared values, 450 animated styles, 300 uncovered labels | 450 shared values, 150 animated styles, 0 uncovered labels |

- **`Press`** (`motion/Press.tsx`) makes its two shared values and its animated style in a
  `PressMotion` child that mounts on the first touch (or at mount when it's shown
  `highlighted`). A press-in that comes before the touch starts is replayed once the child is
  ready, and the dim and scale look the same as before. `motion/pressMountCost.test.ts` checks
  that 150 targets make nothing at mount, that touching one makes 2 shared values and 1 style and
  dims it, and that a highlighted press animates from its first frame.
- **`SwipeableRow`** (`catalog/SwipeableRow.tsx`) draws its edges (the two uncovered labels and
  their animated styles) in an `Edges` child that mounts on the row's first touch, or when the
  swipe demo moves it. `catalog/swipeRowMountCost.test.ts` checks the counts above, that a touch
  draws both labels and adds 2 styles, and that a demo draws them.
- `Artwork` has no animation. `RowReorder`/the reorder handle appear only in the arrangement
  editor's short lists. `IconButton` and `TextButton` are not `memo`, and their callers pass
  inline closures, so `memo` alone wouldn't help (see What's left).

## 2. Subscription fan-out

There is now a shared `useStoreSelector(store, select, equals)` (`lib/storeSelector.ts`), along
with `useSightedSelector` (`lib/screenSight.ts`) for subscriptions that pause out of sight. Each
returns the previous slice while the store is unchanged or the new slice is equal, so a store
change that leaves a component's view equal doesn't re-render it. `equalToDepth(n)` and
`shallowEqual` compare structure to a depth, with leaves compared by identity.

| Change                             | Re-rendered before                                                                                              | Re-rendered after                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A download's progress tick         | Every album page, playlist actions menu, Discover mix actions and Settings' missing songs following the journal | Only views whose list changed phase or membership         |
| A queue change (position, entries) | Now Playing's shuffle and repeat buttons, the Queue header                                                      | Only what shows shuffle, repeat, the count or the context |
| An incremental scan finding files  | The scan banner (which then drew nothing)                                                                       | Nothing until the banner has something to show            |

- `lib/storeSelector.test.ts`: 10 position ticks re-render a shuffle view once (as against 11
  for a view that follows the whole state); a derived up-next list re-renders only when its songs
  change; an album's download view re-renders once across 9 progress ticks and again when a second
  song joins. The same render count holds for the React Compiler's build of the hook.
- `ytmusic/YtDownloads.ts`: `useYtAlbumDownload`, `useYtPlaylistDownload` and
  `useMissingSongsDownload` select their list's jobs, compared to depth 3.
- `playback/hooks.ts`: `useQueueShuffle`, `useQueueRepeat`, `useUpNextCount` and
  `useQueueContext`, used by `SlotButtons` and the Queue's header and up-next bar.
- `library/scanBanner.ts` (Core-style pure function, tested): the banner follows `scanState`
  through `scanBannerScan`, which is null whenever the banner draws nothing.
- Playback position never reaches React. The scrubber, lyrics and sleep timer read the
  `playhead` shared values on the UI thread.

## 3. Stable props into memoized children

- **Home**: `useHomeSelection` spread its memoized selection into a new object on every render,
  and the cold-start merge in `useHomeScreenContent` built a new `home` object each time, so any
  Home render redrew every section. Both now keep their identity until what they hold changes,
  and `HomeSection` is `memo`. `selection/homeSelectionIdentity.test.ts` checks that an unrelated
  Home render keeps the same selection and that starting a selection gives a new one.
- **Song lists**: `useSongRows` reads `onPlay`, `onMenu` and the swipe through a latest-value
  ref, so the inline closures Search and others pass don't reach the rows. No change.
- **Library grids**: their `renderItem`s are `useCallback`s. No change.
- **Settings**: `SettingsIndexRow` is memoized on primitives; its inner `onPress` closure runs
  only when that row re-renders. No change.

## 4. Off-screen work

- **Stacks freeze what's under a push.** The root stack, the Library stack and each section tab's
  stack take `useStackScreenOptions()` (`chrome/tabScreens.tsx`), which sets `freezeOnBlur` as the
  tabs already did. A covered screen renders nothing until it shows again. A memory guard in
  `perf/memoryGuards.test.ts` checks that every `<Stack>` takes those options.
- **Below the fold** already mounts lazily: Home's sections and cover rows through
  `StagedSections`, the Magic Queue carousel's pages through Core's `pagerMounts` (#1355, #1380).
- **Hidden screens and fast stores**: kept tabs already pause through `useSightedStore`. A
  frozen screen under a push no longer renders on a store change; its subscription still
  receives the change and catches up once when it shows.

## 5. React Compiler readiness

The compiler stays off. With this branch:

- `EXPO_PUBLIC_WAVE_REACT_COMPILER=1 npx expo config --json` has `experiments.reactCompiler:
true`, and without the variable the key is absent.
- `npx expo export:embed --platform android --dev false` with `EXPO_PUBLIC_WAVE_REACT_COMPILER=1
EXPO_PUBLIC_WAVE_PERF=1` bundles 10,222 modules with 833 compiled memo caches, and the perf
  meta says `reactCompiler: true`. Run it with its own `TEMP`: `--reset-cache` fails while other
  checkouts are using the shared Metro cache.
- Every file this branch changed compiles with the release options. Two files keep functions as
  written, both already that way before this branch: `motion/Press.tsx`'s `Press` (`++` on a
  module variable; the new `PressMotion` compiles) and `app/_layout.tsx` (dynamic `import()`).
  `memo(function HomeSection…)` was left as written because the function named itself, so its
  body is now a declaration wrapped apart, and it compiles.
- The existing compiled-versus-as-written tests pass (47 tests).

## 6. Download ticks and queue changes (#1441)

| Change                               | Re-rendered before                          | Re-rendered after                          |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------ |
| 4 progress ticks of 1 of 4 downloads | The downloads list 4 times, the ticking row | The ticking row only (the list 0 times)    |
| A download tick, Downloads settings  | The section, through `useQualityOffer`      | Only when the quality offer itself changes |
| The next song plays (9 Up Next rows) | 9 rows                                      | 2 (the song gone to History, the new top)  |
| A song removed from the middle       | 8 rows                                      | 0                                          |
| The last song moved to the top       | 8 rows                                      | 3 (rows whose move buttons changed)        |

- **Downloads**: `ytmusic/downloadingRows.ts`'s `useDownloadingList` selects the list from the
  journal and compares it with Core's `sameDownloadingList`, which ignores progress. Each row
  reads its own line through `useQueuedDownloadLine`, from a map Core's `queuedDownloadLines`
  builds once per journal change. `settings/downloadTickRenders.test.ts` checks it.
- **Queue**: `UpNextRow` is `memo` and ignores its index. The drag learns a row's new index
  through `placeRow` (`catalog/rowDrag.ts`), on the UI thread, without a render. The song-list
  model's row cache also compared the queue entry by identity, so every rebuilt queue redrew
  every row; it now compares plain-object sources field by field.
  `nowPlaying/queueMoveRenders.test.ts` checks it, including that a drag lifted after two
  unrendered moves starts from the row's new place.
- **Swipeable rows**, measured on #1409's `SwipeableRow` (edges drawn from mount): 150 rows make
  450 shared values, 150 animated styles and 300 backdrop icons, and mount in about 90 ms in
  node. Each row holds `offsetX`, `width` and `armed`. `width` and `armed` could share one shared
  value (300 for 150 rows); left until the integration branch carries #1409's file.

## What's left

- **A phone run.** The counts above are node counts; the effect on the reference phone's taps and
  freezes needs the `reference-taps` scenario before and after.
- **`SwipeableRow` still makes 3 shared values per row** (offset, width and the armed side), 450 for
  150 rows. The pan gesture needs them from its first frame; merging `width` and `armed` into one
  would bring it to 2 (section 6).
- **The Queue's list still follows the whole queue** (`useQueue`): a position change renders
  the list, though its rows now skip.
- **`IconButton` and `TextButton` aren't `memo`**, and most callers pass inline closures. The
  React Compiler would cover this if adopted; otherwise it needs callers to pass stable handlers.
