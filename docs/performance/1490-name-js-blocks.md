# #1490 Every JS block names its cause

Ticket: #1490 (parent #1481). Branch `fix/1490-name-js-blocks`, based on the
`feat/1481-dj-moods-speed` integration branch.

## What logged as "no background work"

A block gets a name only from a render span (`useRenderCost`), a background slice, the latest
work that ran, or, before the first settle, a startup step (`createJsBlockLog`). On the emulator
with the 3,000-song seed (`docs/agents/emulator-checks.md`), a minute of browsing Home,
Playlists, the DJ screen and Settings on the integration tip logged three unnamed blocks, all on
Playlists: 59, 56 and 204 ms. #1489's runs saw 169 to 178 ms ones opening a playlist page.

A temporary React commit hook found what ran in each block. The hook was put at the top of the
bundle, since the renderer loads before the app's entry. It was never committed.

| Block                                  | What ran                                                                                                                | Why nothing named it                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Playlists, 115–187 ms, while scrolling | `ArrangeablePlaylists` re-rendering, about 495 components                                                               | Its own state renders it, without `PlaylistsList` or the tab's span around it      |
| Playlists, 190–227 ms, tapping the tab | The frozen tab showing again: a 5–24 ms render, then a commit of about 190–226 ms that re-runs the tab's layout effects | `useRenderCost` sees layout effects with no render and, by design, reports nothing |
| DJ, 56–64 ms                           | `DjScreen` re-rendering its own state                                                                                   | Not under the stack screen's span                                                  |
| Home, 52–130 ms, rarely                | Once a commit topped by an animated view; once nothing that timers, frame callbacks or events saw                       | See "Left over"                                                                    |

## What changed

- `ArrangeablePlaylists` and `DjScreen` time their own renders (`useRenderCost`), so a block they
  hold says `by rendering ArrangeablePlaylists` or `by rendering DjScreen`.
- `RenderCost`, the span around each tab, now tells a reveal from a render. A child at its top
  marks when its layout effects start. When those effects run with no render, the span reports
  `shownAgain(name, start, duration)` instead of nothing.
- Core's block log has a `shownAgain` port. It names a block `by showing tab:playlists again`
  and weighs it as a render span. Render names now keep their `rendering` prefix in the stored
  span, so the two kinds share one list.

The naming order is in `docs/spec.md` (Logging, the JS block line).

## Before and after

Same runner and seed, a minute of browsing (Home, Playlists, Home, DJ, Settings, twice):

- Before: `JS blocked 59 ms on /playlists by no background work`, `… 56 ms …`, `… 204 ms …`.
- After: no unnamed block on Playlists, DJ or Settings in three runs. Playlists' blocks now say
  `JS blocked 233 ms on /playlists by rendering ArrangeablePlaylists` (also 53, 70 and 64 ms in
  that run; 167, 63 and 55 ms in another).
- Home logged 2, 1 and 0 unnamed blocks over those runs: 107 ms, 93 ms, then 130 ms.

`by showing … again` didn't appear in these runs: the tab reveals fell inside `(tabs)`'s or
`ArrangeablePlaylists`'s render span, which held more of the block. It names a reveal that no
render overlaps. Core's and the app's tests cover it.

## Why Playlists re-renders while scrolling

`useListScrollable` (`motion/heldTouch.ts`) subscribes with `useSyncExternalStore` to whether a
touch is held. It flips on every touch down and up, so each swipe renders the whole
`ArrangeablePlaylists` twice. That costs 55 to 233 ms with the seed's playlists. This ticket
names that cost and doesn't change it. Rendering only the scroll flag's owner, or keeping it in a
ref the native scroll view reads, would remove most of these blocks.

## Left over

- Home's remaining unnamed blocks (52 to 130 ms, at most two a minute) belong to #1487. One was
  a commit topped by an animated view. The 130 ms one had no timer, frame callback or event
  running. The commit hook recorded nothing on that build, so a commit with no span around it,
  a native callback's continuation and Hermes GC all remain possible (see
  `1447-named-background-work.md`, items 2 to 4).
- The emulator's idle crash (see #1489's report) restarted Wave four times during one run's
  launch. The browse minute itself ran without a crash.
