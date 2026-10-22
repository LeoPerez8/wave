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
in that same change. A necessary automatic request belongs in a reviewed hook
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
route guard was weakened. The common playing-ids follower remains #588's, and
other online detail pages remain #591's.
#586 removed the exact `ytmusic/streamedArtist.ts#listArtists` and `#sharedArtists`
exceptions: rendering a link no longer lists artists or builds `libraryArtistFinder`.
An unread Core target is available immediately. Explicit taps resolve requested
credits using `artistNamesForLink` keyset pages of at most 128 names, yielding
between pages, then `linkRows` only for matches. The 500 ms deadline aborts the
lookup and falls back to YouTube Music, with an immediate offline page. Mixed
selection prepares only its requested names while its explicit card is shown.
The inventory still rejects new whole-Library followers; no capability or
scanner boundary was weakened to accommodate the replacement.
