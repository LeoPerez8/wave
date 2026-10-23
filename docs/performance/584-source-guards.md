# Whole-Library followers and opening requests (#584)

The desktop guards in `apps/mobile/src/perf/performanceGuards.test.ts` inventory
whole-Library work and requests reachable from Library detail routes (including
their tab-specific routes) and Now Playing. They run with the ordinary mobile
`node:test` suite:

```sh
pnpm --filter @wave/mobile test
```

For just these guards, their regression fixtures, and the unchanged route guard:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test \
  apps/mobile/src/perf/performanceGuards.test.ts \
  apps/mobile/src/perf/sourceAudit.test.ts \
  apps/mobile/src/perf/routeObservers.test.ts
```

`performancePolicy.ts` is the reviewable inventory. Each exception names an exact
module and declaration with its reason. Whole-Library exceptions also name each
protected capability: the shared songs query, song finder, whole artist list or
taste history. Adding another capability to an allowed declaration still fails.
Both new uses and obsolete entries fail the inventory comparison.

`removeIn` means **to remove**, and names the downstream #579 ticket. The initial
debt covers the Now Playing buttons, star and downloaded-file lookup (#587),
playing ids (#588), artist opening (#589), Popular's quiet read (#590), integrated
album and other remote detail openings (#591), Home's Magic Queue row and taste
derivation (#593), mix inputs (#594), and streamed artist resolution (#586).
These entries record existing behavior; they do not assert that it is deferred
or connectivity checked yet.

Network exceptions distinguish automatic opening hooks from explicit gestures.
The scanner conservatively follows callbacks as well as direct calls, so an
explicit Play, Download, Favorite, Share, swipe or menu action needs its own
reason. A reviewed function boundary covers its implementation's transitive
requests; it grants no exception to sibling declarations or other callers of a
shared helper. Direct `fetch` is guarded regardless of host, also covering new
Deezer and LRCLIB wrappers. The YouTube Music Effect service and native methods
are protected separately, since their requests do not use JavaScript `fetch`.

When a follow-up fixes an offender, remove its obsolete capability or exception
in that same change. #587 removed the four exact Now Playing button, star and
downloaded-file exceptions; its controls now share one targeted song/file/star
statement after sheet settlement or their own early gesture. The scanner and
route-observer guard are unchanged. A necessary automatic request belongs in a reviewed hook
that waits for `useScreenSettled` / `useNowPlayingSettled` (or the corresponding
subscription) and checks Android connectivity before asking. Replace the debt
entry with that explicitly documented deferred boundary and update the opening
policy validation alongside its behavioral tests. A static allow-list records
that review; it cannot prove control flow, connectivity behavior, or distinguish
a gesture callback from one incorrectly invoked during render.

`sourceAudit.mjs` uses the existing development tool `react-doctor`'s classic
TypeScript compiler API to resolve symbols through aliases, barrels, namespace
and computed members, destructuring, Effect values and wrappers. Changed or
missing protected declarations fail visibly. Comments, strings, type-only
references and unrelated same-named helpers do not count. The scanner and its
compiler dependency are desktop-only; the application imports none of them, and
Core gains no dependency. New transport APIs or dynamically constructed code
require an explicit scanner/policy update during review.

Issue #589 removes the Library artist route's opening exception. Its optional
online work has two exact reviewed boundaries in `artistSection.ts`:
`useDeferredArtistSection` acquires the shared finder only for Online with a
standing full answer, after the local query's content and `useScreenSettled`;
its section request and queued retries wait for that same settlement and check
Android `online()` immediately before `fetchArtist`. `useArtistSongsFinder`
builds only over the artist's already-read sorted songs once the deferred shared
finder exists. Library mode needs neither. Saved Popular ranking still uses
only the artist's saved answer and own songs.

Fixed automatic request entries use a `deferred` review record instead of
`removeIn`: settlement scope, Android connectivity and the exact behavioral
test files must be present. The scanner still inventories the exact declaration
and rejects unlisted or stale uses; this record does not prove control flow.
`ytArtistOpening.test.ts` exercises the production policy and
`artistOpening.test.ts` runs its opening/settlement replay against the actual
store and sql.js, checking song rows and the saved page.

#590 removes the exact `useYtPopularSongs` opening exception: Popular now uses the saved answer from the single `useDeferredArtistSection` boundary.
`artistPopular.test.ts` exercises the production reader and fetch/save workflow
with fake YouTube transport and the real 1,000-song store: zero requests before
settlement, offline or with Online off, one request per artist/opening, shared
Popular/Online answers, immediate local order, saved ranks offline, allowance
expiry, Wi-Fi eligibility, retries, cancellation and stale-answer rejection.
Core's public `ytPopularReadDue` edge cases live in `ytPopularRead.test.ts`.
The fixed boundary's review record names those tests; no scanner capability or
route guard was weakened. The common playing-ids follower remains #588's.
Issue #591 replaces the remaining detail-opening debt as described below.
#586 removed the exact `ytmusic/streamedArtist.ts#listArtists` and `#sharedArtists`
exceptions: rendering a link no longer lists artists or builds `libraryArtistFinder`.
An unread Core target is available immediately. Explicit taps resolve requested
credits using `artistNamesForLink` keyset pages of at most 128 names, yielding
between pages, then `linkRows` only for matches. The 500 ms deadline aborts the
lookup and falls back to YouTube Music, with an immediate offline page. Mixed
selection prepares only its requested names while its explicit card is shown.
The inventory still rejects new whole-Library followers; no capability or
scanner boundary was weakened to accommodate the replacement.

## Detail openings after #591

No `removeIn: 591` exception remains. The existing declarations stay exact:

- `albumSection.ts#useYtAlbumSection` waits for its own local tracks and
  `useScreenSettled` before artist/release requests or retries. `albumOpening`
  is the production data boundary used by the hook and store replay. Its
  shared finder is activated only for an answered release after that boundary;
  local rows and the offline note need neither the finder nor YouTube.
- `artistPage.ts#useYtArtistPage` waits for settlement before asking and renders
  offline/loading/failure independently of the finder. The finder and
  `useLibraryReleases`' shared artist/album lists are active only for a standing
  full online answer after settlement. #586's offline route hint and explicit
  retry remain effective.
- `YtSongList.tsx#useYtListPage` defers remote album/playlist reads and retries
  until settlement and checks Android at execution. Offline is immediately
  drawable. The visible list's finder waits for a loaded page; the album
  download helper also waits for nonempty online songs and settlement, so an
  empty helper cannot acquire the cold shared query behind a Library album.
- `backgroundFill.ts#playlistOpened` requires the playlist screen's settled
  flag. A fill search checks connectivity before waiting for the allowance and
  again when its request executes. Existing global fill scheduling stays under
  its existing ownership.

These request paths use `artistOpeningRequest`, whose Effect checks Android's
`online()` when run, including loss of connectivity after scheduling. Page
notes use the synchronous connectivity result without waiting for restoration,
settlement, a whole-Library query or a remote failure. Unmount aborts the
artist/release/list effect and discards late answers.

`ytAlbumOpening.test.ts` and `ytArtistPageOpening.test.ts` test the public Core
policies. `albumOpening.test.ts` exercises the production album data boundary,
real LibraryStore/sql.js queries, late online joining, retained multi-disc headers and a controlled pending
release. `detailOpening.test.ts` exercises immediate offline views and the
production execution boundary with an API that never answers; its request
counter stays zero. These are desktop data/effect tests, not mounted RN frames.
The historical-store red replay reads 1,010 song rows at a 1,000-song Library;
the fixed opening reads its ten album tracks and starts no request.

#590 completes Popular's due/once, allowance and Wi-Fi policy at the single
artist opening boundary described above; no `removeIn: 590` entry remains.
The #584 route observer restriction and #585 dispatch/watchdog are unchanged.

## Home Magic Queue after #593

The exact `home/magicQueueSection.ts#MAGIC_QUEUE_LIBRARY`,
`playback/TasteProfile.ts#live` and `playback/magicSongs.ts#magicSongsOf` debt
entries are retired. Standing picks use `songsByIds` (nine at most), with picked
track/favorite invalidations. Live signals resolve only their credited artist
IDs. Short lists alone use a one-ID growth probe, so adding a file can fill them.

The allowed source reads are now the exact background functions
`playback/tasteDerivation.ts#readTasteLibrary` and `#deriveTaste`. Home gates its
job on `useScreenSettled`; these functions wait on existing cancellable free
turns and reuse one Library input for the shared live profile and the pick.
Mapping, scoring and ordered weighted draws consume cooperative iterator steps.
`magicQueueRead.test.ts`, `magicQueueJob.test.ts`, `tasteDerivation.test.ts` and
`liveTaste.test.ts` exercise the real store/registry, timing session, scheduler
cancellation and shared profile semantics. The route-observer policy is unchanged.
Source SQL reads remain separately visible in the desktop evidence; allowing a
background source read does not claim that synchronous SQLite has a six-ms cap.

## Playing row identities after #588

The exact `playback/hooks.ts#useCurrentPlayingIds` debt entry is retired.
`createPlayingIds` owns one current-recording registry attachment and one download
completion subscriber, shared by every mounted list. Its query reads indexed
normalized-title candidates and applies Core's `recordingMatches`; no whole-Library
query or finder is followed or built. Saved download metadata filters unrelated
completions before any read. Known matched-row edits/removals can refresh the same
targeted query. Identical identity sets retain their snapshot and notify nobody.

The SQL/store/bus tests mount eight consumers and distinguish the single source
refresh and row returned from the eight consumers receiving an actual identity
change. Race coverage discards prior-track and pre-download lookup answers. The
source scanner and route-observer policy are unchanged; there is no candidate-finder
exception. The index's one-time upgrade backfill uses pages of 128 titles, yielding
between transactions before the LibraryStore becomes available.

## Recap availability after #598

The inventory also protects the encapsulated `LibraryStore.countedListening`,
its database implementation, the bounded `countedListeningPage` driver and
`Stats.recaps`. The whole-history capability has no production Stats consumer;
only its exact store implementation remains inventoried. Recap stories now
collect their requested period through the bounded source as well.

The only source consumer is `stats/Stats.ts#readListeningPages`: an indexed
keyset statement aggregates at most 512 raw events (at most 513 returned SQL
rows including its cursor), then yields to the supplied
cancellable free turn. Empty/all-skipped pages still advance. Core accumulates
local calendar periods and finishes ordering in cooperative steps. The exact
`recapAvailabilityLive.ts#getRecapAvailability` boundary shares this calculation
between Home and Stats only while visible and settled, using the existing free
turn scheduler. The cache keeps its previous answer, cancels hidden/outdated
work, and rejects stale publication. History versions come from committed store
writes, including progress, imports and each sync page; calendar/timezone/clock
checks run only while a consumer is active and on foreground/return.

`library/db/recapAvailability.test.ts`, `library/db/regressionSweep.test.ts` and
`stats/recapAvailability.test.ts` verify the actual store/Stats/cache seam with
the shared fixture and controlled clock/scheduler. The injected real-API scanner
regression now also rejects new whole-history, paged-history or `Stats.recaps`
callers. No scanner algorithm, route protection or another ticket's debt entry
was relaxed. Desktop timing and remaining device checks are recorded with #598's
benchmark evidence in `579-fast-again.md`.
