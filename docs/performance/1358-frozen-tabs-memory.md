# #1358 Hidden tabs stay frozen, and memory stays under 500 MB

Ticket: #1358 (parent #1346). Branch `feat/1358-frozen-tabs-memory`, based on `feat/1346-instant`
at 497c2c3db.

**The phone numbers are pending.** Everything below was measured on the desktop (Node 24, V8,
`--expose-gc`) or read from the code and the earlier tickets' docs. Nothing is a phone or emulator
measurement. The reference phone's runs are under "Phone run: pending".

## Hidden tabs freeze

Before: `freezeOnBlur` was on only in a comparison bundle built with
`EXPO_PUBLIC_WAVE_TABS=freeze` (#304). A hidden tab was detached and `display: none`, its stores
paused (#722), but React could still render it: a parent's re-render or a state update reached
it.

Now Core's `DEFAULT_TAB_SCREENS` has `freeze: true`, so every release freezes a hidden tab
(`detach,display-none,freeze,retain=5`). What happens:

- **Leaving a tab.** react-native-screens sets its `activityState` to 0 and freezes its tree one
  tick later (`DelayedFreeze`), after the `blur` event has paused its shared queries and sighted
  stores. From then on the tab renders nothing, whatever changes.
- **While hidden.** Shared Library queries don't re-read (`attachInSight`), sighted stores
  (`useSightedStore`: playing ids, stars, scan status) hold their last value and aren't
  subscribed, and a frozen tree doesn't render the updates that still reach it.
- **Coming back.** The tab unfreezes in the commit that shows it (the freeze lifts at once, only
  freezing waits a tick), the updates it missed render once, and on `focus` each paused query
  and store catches up once if what it follows moved. So the playing song's highlight and a
  Library change made from another tab (a playlist edited from Search, a star from Now Playing)
  are current in that first frame after return or the frame after, with no render while hidden.
- React hides a frozen tree as a Suspense boundary does: its layout effects are cleaned up while
  frozen and run again when it shows. The tabs' layout effects are cheap (screen timing marks,
  the song pager's order, a latest-props ref), so this adds no work worth measuring.
- A comparison bundle can still turn it off with `EXPO_PUBLIC_WAVE_TABS=thaw`.

Guards (`apps/mobile/src/perf/memoryGuards.test.ts`): the default parses to frozen, detached
and paused; `renderTabScreens` passes `freezeOnBlur={TAB_SCREENS.freeze}` and the focus-driven
`activityState`; and no workflow or app config sets `EXPO_PUBLIC_WAVE_TABS`, so no release
bundle can pick another way. Core's `tabScreens.test.ts` covers parsing (`freeze`, `thaw`, the
later one wins, `attach` never freezes).

## Where the memory goes

The reference log had two "killed for low memory" starts at a PSS around 550 MB. PSS is native
memory first: decoded images, Fabric's views, the Hermes heap, the player's buffers and the
mapped `.so` files and fonts. The JS-side data Wave keeps for screens is small next to it.

### JS caches kept for the session (desktop, heap after GC)

| Cache                                                     | Bound                                    | Size                     | Source              |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------ | ------------------- |
| Search's index (727 songs)                                | the Library                              | ~1.2 MB                  | #1354's doc         |
| Screens kept ready (lists, playlists, genres, Stats, DJ…) | per screen; 8 recently opened            | ~1.5 MB                  | #1352's doc         |
| Home snapshot, parsed                                     | one; freed section by section            | 96 KB, then 0            | #1353's doc         |
| YT album pages (`albumPages.ts`)                          | **24 (was unbounded)**                   | 302 KB (15 songs each)   | measured, synthetic |
|                                                           |                                          | 752 KB (40 songs, worst) | measured, synthetic |
| YT album and playlist pages (`knownYtPages.ts`)           | 12                                       | 905 KB (100 songs each)  | measured, synthetic |
| Online Search answers (`knownYtSearches.ts`)              | 24                                       | 739 KB (40 results each) | measured, synthetic |
| YT artist answers (`knownYtArtists.ts`)                   | 16                                       | < 500 KB                 | estimate, as pages  |
| Lyrics (`trackLyrics.ts`)                                 | 16 tracks                                | 240 KB (60 lines each)   | measured, synthetic |
| Played-artist photos (`PlayedEntityViews.tsx`)            | **64 (was unbounded)**                   | 36 KB                    | measured, synthetic |
| Community playlists, followed releases, similar artists   | their own caches, kept on disk and paged | see #1260, #1327, #1258  | not counted again   |

The synthetic rows have the shapes of the native types (`NativeYtAlbum`, YT songs with an
11-character id, title, two artists and a 120 px thumbnail URL). V8 and Hermes lay objects out
differently; Hermes is usually a little smaller for small objects, so these are upper bounds
within a factor that doesn't change the total. The script is in "How the desktop numbers were
taken".

Everything Wave keeps in JS memory for screens adds up to about **6 MB** at the bounds, about 1%
of the budget. The 50 MB of headroom the phone needs isn't in JS caches; cutting them would cost
#1352's and #1353's screens from memory and win nothing visible in PSS.

### What else holds memory, from the code

- **Decoded images.** Every artwork goes through `artworkUri` (Performance rules 9, guarded):
  rows ask for the thumbnail, tiles for the medium cover, Now Playing for the original, and
  expo-image (Glide) downsamples each to the view's size by default; no view turns
  `allowDownscaling` off. A detached tab's views keep their bitmaps as active resources, so five
  kept tabs each hold one screen of covers. This is the first thing to read on the phone
  (`Graphics` in meminfo).
- **Now Playing** stays mounted with the Queue and Related drawn hidden once it has settled
  (#1380). The Queue is a virtualised list; Related draws one carousel.
- **The Hermes heap** holds the Library rows Search's index shares (1.4 MB of rows for 727
  songs, #1352), the queue's tracks, and the caches above.
- **The module collections** that aren't caches (jobs in flight, listeners, settings) are bounded
  by what they mirror. Each one now says so in `MODULE_COLLECTIONS`.

## Cuts

1. **YT album pages bounded at 24** (`ytmusic/albumPages.ts`). Every album page read was kept
   for the session (the album screen, New releases, the Magic Queue's new-release seeds and every
   download's tags read through it), so a long session that browsed and downloaded kept growing.
   Now it's a `knownPages(24)`: the album being downloaded is touched by each of its songs, so a
   whole-album download still shares one read. A page let go is read again on its next use.
2. **Played-artist photo lookups bounded at 64** (`stats/PlayedEntityViews.tsx`).
3. **Core's `knownPages` gained `forget` and `size`**, so a failed read frees its place and the
   bound can be tested (`knownPages.test.ts`: 1,000 pages read, 3 kept).

Guards added for rule 12 (`memoryGuards.test.ts`): every module-level `Map`, `Set` or
`knownPages` in the app and the client must be listed in `MODULE_COLLECTIONS`
(`perf/performancePolicy.ts`) with what bounds it, a stale entry fails, and every `knownPages`
takes a number (or a const in its module) of at most 64. A planted unbounded cache fails.

Not cut: #1352's kept screens, #1353's Home snapshot, Search's index, the five kept tabs and
Now Playing's hidden Queue and Related. Each is what a screen opens from in its first frame, and
together they are a few MB of JS plus the native views the phone run will size.

## How the desktop numbers were taken

```sh
node --expose-gc measure.mjs
```

`measure.mjs` builds each cache at its bound with synthetic rows shaped like the native types,
takes `process.memoryUsage().heapUsed` after two `gc()` calls before and after, and prints the
difference. The rows: album pages with a 17-character browse id, a title, an artist, a 544 px
cover URL, a playlist id and 15, 40 or 100 tracks; search answers of 40 songs; lyrics of 60 synced
lines of 38 characters.

## Phone run: pending

On the reference phone (Xiaomi 25118PC98G, Android 15), set up as #1347's run says, with the
release before this ticket and then the one that carries it.

**1. The reference scenario, with PSS.** The runner reads `dumpsys meminfo` at each scenario's
end (PSS, RSS, Java heap, native heap, Graphics) and `compare` prints them side by side:

```sh
node scripts/perf/perf.ts run --scenario reference-taps,tab-switch,soak-routes,soak-player \
  --label 1358-before --artist "<Library artist on Artists' first screen>" \
  --playlist "<playlist on Playlists' first screen>" --album "<album on Albums' first screen>" \
  --yt-artist "<non-Library artist on that artist's Similar artists row>"
# install the release with #1358, then:
node scripts/perf/perf.ts run --scenario reference-taps,tab-switch,soak-routes,soak-player \
  --label 1358-after --artist "<same>" --playlist "<same>" --album "<same>" --yt-artist "<same>"
node scripts/perf/perf.ts compare perf-results/1358-before-<time>.jsonl perf-results/1358-after-<time>.jsonl
```

Pass: `tab-switch`'s tab p90 within 50 ms (the return to a frozen tab), and PSS under 500 MB at
every scenario's end.

**2. 30 minutes of playback, PSS every 30 s.** Start a Magic Queue or a long playlist, visit
every tab and a few pushed screens, then leave the phone playing with the screen on Home:

```sh
adb logcat -c
for i in $(seq 1 60); do
  printf '%s ' "$(date +%T)"
  adb shell dumpsys meminfo dev.leoperez.wave | grep -E "TOTAL PSS|Graphics:|Native Heap:|Java Heap:" | tr -s ' ' | tr '\n' ' '
  echo
  sleep 30
done | tee pss-1358.txt
sort -k4 -n pss-1358.txt | tail -1   # the highest TOTAL PSS
```

Pass: no line over 500 MB, and the last lines no higher than the first ten minutes' (no growth).

**3. No low-memory kill.** After both runs:

```sh
adb logcat -d -b events | grep -iE "am_low_memory|am_kill.*dev.leoperez.wave"
adb logcat -d | grep -iE "lowmemorykiller|lmkd.*dev.leoperez.wave|Kill '?dev.leoperez.wave"
adb shell dumpsys activity exit-info dev.leoperez.wave | grep -iE "reason=3|LOW_MEMORY" | head
```

and Wave's app log has no "… was killed for low memory" line (`SessionRecord.kt`, written at the next
start). Pass: all three print nothing for Wave and the app log has no such line.

If PSS is over budget, the meminfo lines say where: `Graphics` growing with tab visits points at
the kept tabs' bitmaps (try `retain=3` with `EXPO_PUBLIC_WAVE_TABS=retain=3`, #304), `Native Heap`
at the player or images, `Java Heap` at the native modules. Record the numbers here.

| Run                    | Peak PSS | PSS at end | Graphics | Native heap | `tab-switch` p90 | Low-memory kill |
| ---------------------- | -------: | ---------: | -------: | ----------: | ---------------: | --------------- |
| before (`1358-before`) |  pending |    pending |  pending |     pending |          pending | pending         |
| after (`1358-after`)   |  pending |    pending |  pending |     pending |          pending | pending         |
| 30 min playback        |  pending |    pending |  pending |     pending |                — | pending         |

**The emulator's version, by #1535** (`wave-run-903`, perf builds of `2f2a0300d`, the reference
Library seeded; `docs/performance/1535-tabs-mode.md`). Not the phone run above, which stays
pending. "Frozen" is this ticket's default, "not frozen" #1535's (hidden tabs unfrozen, screens
under a push still frozen). Four runs of `tab-switch` each; the emulator draws in software, so
`Graphics` reads 0.

| Run (emulator)      | PSS at end of `tab-switch`, each run | Native heap (median) | `tab-switch` first frame p90 |
| ------------------- | ------------------------------------ | -------------------: | ---------------------------: |
| frozen (`freeze`)   | 644, 434, 499, 447 MB                |               179 MB |                       282 ms |
| not frozen (`thaw`) | 459, 441, 427, 443 MB                |               168 MB |                       196 ms |

Freezing hidden tabs didn't lower PSS on the emulator; #1535 turned it off by default.
