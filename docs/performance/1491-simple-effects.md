# #1491 Lighter effects on weak phones

Ticket #1491, part of #1481. Branch `fix/1491-simple-effects`.

## The list's scroll flag

`useListScrollable` was suspected of re-rendering the lists on every touch. It flips only when a
long press starts and ends a drag, and the emulator logged no JS block over 50 ms when it did, so
it was left as it is. The Playlists blocks a swipe logs (57–60 ms "rendering
ArrangeablePlaylists") come from the drag's scroll window mounting new rows, not from the flag.

## Method

Emulator `emulator-5560` (Android 15, x86_64), perf builds repacked from the release APK
(`EXPO_PUBLIC_WAVE_PERF=1`), the 3,000-song seed (`scripts/perf/seed.ts`), offline, Archive
playing. The phone effects were forced to `simple` through the stored verdict
(`wave.phoneEffects.verdict`). Each effect was turned off alone in a diagnostic build that was
never committed, and the glass through the perf runner's probes (`--glass`). Each row is 10 steps
of `scripts/perf/perf.ts`: tab switch (`tab-switch`), a push and pop (`push-playlist`), and Now
Playing's open and close (`now-playing`). Figures are the first frame's median / p90 in ms and the
share of late frames. Runs on different boots are compared only against their own boot's baseline.

The Queue scenario can't time a warm open: its mark fires on mount, and the Queue stays mounted.
That is already so on the integration branch, so the Queue was left out.

## Effect by effect (simple mode)

Boot 1:

| Effect turned off         | Tab switch        | Push             | Pop             | Now Playing open | Now Playing close |
| ------------------------- | ----------------- | ---------------- | --------------- | ---------------- | ----------------- |
| Nothing (baseline)        | 76.8 / 177, 19%   | 59.2 / 77.9, 30% | 87.4 / 98.3     | 72.3 / 83.5, 42% | 66.5 / 72.6, 30%  |
| Tab entry slide           | 80.5 / 159.1, 16% |                  |                 |                  |                   |
| Push transition           |                   | 59.1 / 478.1     | 86.7 / 185.3    |                  |                   |
| Now Playing's spring      |                   |                  |                 | 76 / 84.1        |                   |
| Glass (tint and rim only) |                   | 55.8 / 63, 19%   | 74.9 / 92.3, 8% | 61.5 / 75.1, 9%  | 60.3 / 66.6, 6%   |

Boot 2, glass probes:

| Glass                            | Tab switch        | Push             | Pop         | Now Playing open  | Now Playing close |
| -------------------------------- | ----------------- | ---------------- | ----------- | ----------------- | ----------------- |
| live (simple glass)              | 81.3 / 163.7, 18% | 56.5 / 62.9, 27% | 74.2 / 95.9 | 75.7 / 108.6, 37% | 59.6 / 79.9, 30%  |
| record (no blur)                 |                   |                  |             | 66.9 / 76.7, 23%  | 57 / 64, 10%      |
| coalesced (one shared recording) | 83 / 159.5, 19%   | 59.7 / 68.7, 26% | 80.3 / 86.6 | 62.6 / 68.1, 13%  | 55.9 / 82.2, 11%  |
| off (tint and rim only)          | 69.9 / 147.5, 10% |                  |             | 60.8 / 64.1, 7%   | 49 / 61.5, 6%     |

- Dropping the tab entry slide, the push transition or Now Playing's spring left the first frame
  where it was. Without the push transition, the p90 and the response got worse. All three stay.
- The glass's blurred backdrop was the one effect with a cost: about 11 ms on a tab switch's first
  frame and 15 ms on Now Playing's open. It also doubled the late frames or more, and took a tab
  switch's frame p90 from 29 to 46 ms. Recording the backdrop costs about as much as blurring it:
  `record` (no blur) removed about half of the late frames that `off` removed.

## Change

In simple mode, the shipped glass (tab bar, mini player, selection bar, DJ's adjust bar, dialogs
and toasts) is the theme's opaque surface, the one Android below 12 draws. It records no backdrop
and draws no blur, tint or rim (Core's `glassLayers` returns `opaque`). Full mode is unchanged. A
perf probe still draws the simple glass in simple mode, so one build compares the two.

## Before and after

Same boot, simple mode, no probe; before is the integration branch's build, after is this branch.

| Step              | Before                          | After                          |
| ----------------- | ------------------------------- | ------------------------------ |
| Tab switch        | 76.3 / 155.5, 19%, frame p90 46 | 73.1 / 164.9, 9%, frame p90 29 |
| Push              | 57.8 / 72.7, 26%                | 55.7 / 73.6, 15%               |
| Pop               | 78.1 / 83, 9%                   | 83.4 / 97.3, 6%                |
| Now Playing open  | 68 / 83.3, 42%, frame p90 48    | 62.2 / 67.3, 7%, frame p90 34  |
| Now Playing close | 59.8 / 63.7, 32%                | 54.3 / 66.9, 5%                |

Where a kept frame's time went, mean ms: Now Playing's open issued its commands in 2.6 ms
(was 5.7) and waited 13.5 ms on the GPU (was 17.9); a tab switch, 2.2 (was 4.3) and 11.4 (was 14.5).

A tab switch's p90 first frame is a JS render, not an effect. Both builds logged the same blocks
during the taps:

```
before: JS blocked 101 ms on /library by rendering (tabs)
before: JS blocked 83 ms on /playlists by rendering (tabs)
after:  JS blocked 97 ms on /library by rendering (tabs)
after:  JS blocked 69 ms on /playlists by rendering (tabs)
```

## Left for the phone

- A run on the reference phone in simple mode, and the owner's look at the opaque bars.
- Not done here: `coalesced` glass looks the same as `live` and cut Now Playing's open p90 by
  about 40 ms on the emulator. Using it in full mode is the owner's call, since this ticket leaves
  full mode unchanged.
