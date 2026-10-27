# #722 Unseen is idle: no screen work with the screen off or a tab hidden

Ticket: #722 (parent #712). Branch `feat/722-unseen-is-idle`, based on
`origin/feat/712-faster-lighter` at 97568424.

## What changed

- **The app in the background counts as out of sight.** `useScreenSight`
  (`apps/mobile/src/lib/screenSight.ts`) is in sight while the route is focused, Now Playing
  isn't over it and the app isn't in the background (`AppState` `background`: the screen off or
  another app). The conditions are combined in `lib/sight.ts` (`sightOf`), which has no React
  Native import. Shared Library queries pause on it as before (`attachInSight`), so a focused
  Home or Library screen doesn't re-read on each play with the screen off. It reads once when
  Wave comes back. Stats already did this for Recap.
- **Hidden screens stop following external stores.** `useSightedStore` (built on
  `followInSight`) holds a store's last value while its screen is out of sight and doesn't
  subscribe to it, so changes render nothing there. When the screen comes back it renders once,
  and only if the store moved meanwhile. The stores that now pause this way:
  - playing ids (`useCurrentPlayingIds`)
  - Library stars (`useFavoriteIds`)
  - pending YT favorites (`usePendingFavoriteVideos`)
  - the song list's download snapshot (`useSongListDownloads`)
  - scan status (`useScanStatus`) and the banner's scan progress (`useScanProgress`)

  The pause lives in those shared hooks, so `SongList` (#715) and the lists still on `TrackRow`
  get it with no screen edits. Menus and Now Playing are drawn above the screens and keep
  following stars through `useLiveFavoriteIds` and `useLivePendingFavoriteVideos`
  (`itemActions`, `useYtSongStarred`).

- **Only the banner follows scan progress.** `useScanState` is gone. `useScanStatus` returns the
  status alone, so a progress tick doesn't re-render the Library tab, Songs, the browse lists,
  Music folders or Settings. `useScanProgress` is for `ScanProgressBanner` alone.
  `performanceGuards.test.ts` fails if anything else follows the progress or subscribes to
  `scanState`.

### Paused subscriptions by default, freeze switchable

Paused subscriptions are the default. react-native-screens' freeze stays behind
`EXPO_PUBLIC_WAVE_TABS` (#304). Core's `parseTabScreens` now also reads `follow` (hidden screens
keep following stores, as before this ticket) and `pause` (the default). Perf builds report the
choice in the `tabs.screens` meta, for example `detach,display-none,follow,retain=5`. The phone
runs decide between them:

| Bundle (`EXPO_PUBLIC_WAVE_TABS`) | Hidden tabs                                             |
| -------------------------------- | ------------------------------------------------------- |
| _(unset)_                        | paused subscriptions (this ticket's default)            |
| `follow`                         | follow every store, as before #722 (the "before" build) |
| `freeze`                         | paused subscriptions, and the hidden tree frozen        |
| `follow,freeze`                  | freeze alone                                            |

Perf builds now count `SongList` renders (`renders.SongList`) beside `SongRow`.

## Budget

- With the screen off and an album playing, the screen in front reads no shared query per play.
  It reads each of its queries at most once when Wave comes back (`libraryQueries` meta:
  `reads`, `paused`).
- Hidden kept tabs render nothing on a song change, a star or a scan progress tick. On a skip
  with Library, Songs and Home kept, `renders.SongList`, `renders.SongsList` and
  `renders.LibraryScreen` come only from the tab in front.
- During a scan, only `ScanProgressBanner` renders per progress tick. `LibraryScreen`,
  `SongsList` and the browse lists render only when the scan starts and ends.

## Phone check (pending, S24+)

Perf builds, the default bundle and one built with `EXPO_PUBLIC_WAVE_TABS=follow` as the before
(and `freeze` for the comparison):

```sh
# Song change with kept tabs: visit Home, Library and Songs first, then skip.
node scripts/perf/perf.ts run --scenario tab-first,skip --label 722-before   # follow build
node scripts/perf/perf.ts run --scenario tab-first,skip --label 722-after    # default build
node scripts/perf/perf.ts run --scenario tab-first,skip --label 722-freeze   # freeze build
# Scan progress: the launch rescan with a tab tapped while it runs.
node scripts/perf/perf.ts run --scenario rescan-return --label 722-<build>
node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
```

Compare `renders` (SongList, SongRow, SongsList, LibraryScreen, HomeScreen) and the `js:` counts
per step. Then play an album with the screen off for 30 minutes on Home (#713's screen-off soak,
once it's integrated) and read `libraryQueries.reads` before and after. It should grow by at most
one read per query on return, not one per play.

Before/after numbers are left for the owner's run and never block the merge.

## Behavior kept

- A screen back in sight shows what the stores hold now, after one render. A screen that comes
  back with nothing changed doesn't render.
- Edits that remove items (deleted songs, an unstar) still make hidden screens' queries re-read
  at once, as before (Core's `createLibraryQueries`). Only stores pause.
- Menus, Now Playing and swipe actions read stars and playing ids as they are now.

## Tests

- `apps/mobile/src/lib/sight.test.ts`:
  - A focused screen goes out of sight while the app is in the background.
  - Its shared queries (Core's registry, through `attachInSight`) don't re-read on five plays in
    the background, and read once on return.
  - A hidden component doesn't render on a song change, a star or ten scan progress ticks. It
    renders once on return, with the latest values, and not at all when nothing changed.
  - A screen mounted out of sight shows the store as it is, then waits.
  - With `follow` it follows every change.
- `apps/mobile/src/perf/performanceGuards.test.ts`: only the banner follows scan progress.
- `packages/core/src/tabScreens.test.ts`: the `follow` and `pause` switch.

## Not measured

Everything on the phone: render counts, reads with the screen off, and freeze against paused
subscriptions. Freeze's effect on a tab coming back (the first frame after the switch) is
measured by #304's `tab-switch` runs, not here.
