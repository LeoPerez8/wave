# Integrated ticket review

Fixed point: `61b0eaea...c1e18c18`. Independent Standards and Spec axes, run before final fixes. Both read the originating tickets and repository requirements; the parent owns tests and device evidence.

## Standards

# Standards review supporting notes

Fixed reviewed source: `c1e18c18`; base: `61b0eaeacc2e980cb00b2bc1d4f1f85d634cd485`. Scope #534-562 except released #536, plus #564. Read repository instructions, product/spec/design rules, original ticket files and supplied verification reports. No repository edits/commits, remote writes or device access. Parent is performing full tests and emulator work.

## P2 — Renewal does not enforce changed favorite/download priority (high confidence)

- Changed hunk: `packages/core/src/playlistRecommendationSession.ts:98-114`, especially 100-110.
- Requirement: #560 says every eligible favorite/download that fits in five is included, and changes are reflected on next recommendation renewal; `docs/spec.md:224` documents that policy.
- `renew()` derives the new ranked order but keeps every previous track that is still eligible, regardless of its rank, then fills only null slots. With five eligible ordinary tracks already visible, no new favorite/download outside the five can displace one. `PlaylistRecommendations.tsx:83-87` invokes this method for external membership/YT availability changes.
- Public API reproduction run with `node --input-type=module` importing `packages/core/src/index.ts`: seed and a-h are matching Library tracks (Radiohead, Rock, same album; unique titles). Initial `renew()` => a,b,c,d,e. Set h.favorite=true, add another seed member and await `renew()` => a,b,c,d,e. The public `playlistRecommendations` selector with identical updated inputs => h,a,b,c,d. Download status exercises the same retained-slot branch.
- Existing `playlistRecommendationSession.test.ts:19` verifies changed status when a dismissal creates a hole, not a full renewal. The real-store status test at `db/playlistRecommendations.test.ts:381` calls the stateless selector, so it does not cover this controller defect.
- Correction should distinguish a full renewal from Add/Dismiss single-slot refill. Keep unaffected offers stable for the latter, as #561/#562 require, while satisfying priority during an actual renewal.

## P2 — Recommendation rows cannot display their playing state (high confidence)

- Changed hunk: `apps/mobile/src/library/PlaylistRecommendations.tsx:127-139`; playback is initiated at 88-91.
- Hard documented rule: `apps/mobile/DESIGN.md:169,239` marks the playing track's title in ember with a wavy underline; #538 requires correct current identity wherever its rows appear.
- The new footer renders `TrackRow` without `state`, subscribes to no current-playing state, and supplies no equivalent indicator. `catalog/TrackRow.tsx:118` computes playing solely from `state === "playing"`. Tapping a recommendation plays it, but its visible recommendation row remains in the ordinary style and never exposes the existing "now playing" accessibility annotation. All existing major list adapters changed in #538 use `useCurrentPlayingIds`; this new consumer was omitted.
- Use the shared identity hook and pass TrackRow's playing state for both Library and yt IDs. This finding follows the explicit props/renderer contract; no hardware behavior is inferred.

## P3 — Recommendation action glyphs bypass the documented icon-button standard (high confidence)

- Changed hunk: `apps/mobile/src/library/PlaylistRecommendations.tsx:142-166`, glyphs specifically at 153 and 166.
- Hard rule: `apps/mobile/DESIGN.md:285` requires 24dp, 1.5-stroke teal icon buttons, disabled pewter; the shared `components/IconButton.tsx` implements that shape, tone, depth and haptic.
- Both newly active actions render 20dp icons using `secondary` and omit strokeWidth; disabled retains that color with opacity. Add/Dismiss therefore present different active/disabled glyph treatment from the documented shared control. Their 48dp target sizes are correct. Reuse the standard visual treatment while retaining per-offer busy semantics.

## Architecture and evidence boundary

See `architecture-confirmation.md` for independent hotspot exploration, deletion-test conclusions, query-level qualification and all twelve mandatory smells. No additional mandatory smell is promoted to a confirmed violation. No findings based on missing phone evidence: #537/#541/#542 gesture/source reproduction and #545/#546 release measurements retain their documented real limitations. The parent advanced HEAD after the review began; later documentation/menu-typing changes are outside the pinned diff, and do not change the recommendation findings.

## Spec

# Spec review of the saved open-ticket implementation

Reviewed `61b0eaea...c1e18c18`, with the requested `git log 61b0eaea..HEAD --oneline` read at review start (39 commits, HEAD was c1e18c18). The parent subsequently advanced HEAD with f3994587 and 985aad5a while this review was running; none changes the three implementation files cited below. No repository edits, commits, remote mutations, device access, or full test run were performed. Two minimal Core API scenarios were executed with Node to verify the findings. GitHub reads for #558, #560 and #564 confirmed the original requirements and no comments.

Read CLAUDE.md, CONTEXT.md, docs/agents/issue-tracker.md, the applicable product-spec sections, original tickets, and the five supplied implementation/evidence documents. This is a Spec-axis review, not the separate Standards audit.

## P2 / (c) Wrong genre fallback changes eligibility

Code: `packages/core/src/playlistRecommendations.ts:82-90`, especially line 87.

Requirement: `docs/spec.md:350`: "An artist's genre profile is the share of each genre family"; `docs/spec.md:222`: "Playlist similarity leads: compatible songs, artists and genres." Original #559 line 14: "Playlist similarity is the primary ranking factor: track similarity, artist similarity and genre similarity."

When none of the playlist entries has a genre tag (the normal case for streamed playlist entries), fallback calls `profileOf(name)?.keys()` and converts every key to one equally weighted synthetic genre-tagged song. This discards the cached artist profile's shares. A valid cached profile of Pop 90%, Metal 10% becomes Pop 50%, Metal 50%, so a pure Metal candidate passes the shared 0.5 cosine gate even with no artist/radio relation. The actual weighted affinity is only 0.11043152607484655; the implementation offers the candidate with a score of 0.7071067811865475. This is an eligibility defect, not a limitation of unavailable/coarse metadata: the correct shares were supplied and thrown away.

Minimal public-API reproduction (from repository root):

```js
import { playlistRecommendations } from "./packages/core/src/playlistRecommendations.ts";
import { genreAffinity } from "./packages/core/src/genreAffinity.ts";
const song = (id, fields = {}) => ({
  id,
  source: "library",
  videoId: "",
  title: id,
  artists: ["Seed Artist"],
  album: null,
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
  ...fields,
});
const seed = song("yt:seed", { source: "stream", videoId: "seed" });
const metal = song("metal", { artists: ["Metal Artist"], genre: "Metal" });
const profile = new Map([
  ["pop", 0.9],
  ["metal", 0.1],
]);
console.log(genreAffinity(profile, new Map([["metal", 1]])));
console.log(
  playlistRecommendations([seed], {
    library: [metal],
    catalog: [],
    graph: null,
    now: 0,
    profileOf: (name) => (name === "Seed Artist" ? profile : undefined),
  }),
);
```

Confirmed output: actual weighted affinity 0.11043152607484655, yet a recommendation for `metal` with score 0.7071067811865475.

## P2 / (c) Full renewal does not enforce renewed favorite/download priority

Code: `packages/core/src/playlistRecommendationSession.ts:99-110`.

Requirement: original #560 line 16: "Favorite/download status changes are reflected on the next recommendation renewal." `docs/spec.md:224`: "If five slots can hold all qualifying favorites/downloads, all are included" and "The next renewal reflects changes to those statuses."

`renew()` computes the updated ranked order but uses it only as a map of eligibility for every existing slot, then fills only null slots. With five eligible ordinary offers already visible, a newly favorited/downloaded eligible candidate outside the five never gets a slot on renewal. This is distinct from the explicitly required Add/Dismiss behavior of preserving four other slots. A _full_ renewal also preserves all five, defeating the priority guarantee.

Minimal public-API reproduction:

```js
import { playlistRecommendationSession } from "./packages/core/src/playlistRecommendationSession.ts";
const track = (id) => ({
  id,
  source: "library",
  videoId: "",
  title: id,
  artists: ["Radiohead"],
  album: "OK Computer",
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
  genre: "Rock",
});
const seed = track("seed");
let library = [seed, ..."abcdefgh".split("").map(track)],
  id = 0;
const session = playlistRecommendationSession({
  newId: () => String(++id),
  read: async () => ({ playlist: [seed], sources: { library, catalog: [], graph: null, now: 0 } }),
  dismiss: async () => {},
});
await session.renew();
console.log(session.get().slots.map((x) => x?.track.id));
library = library.map((x) => ({ ...x, favorite: x.id === "h" }));
await session.renew();
console.log(session.get().slots.map((x) => x?.track.id));
```

Confirmed output: `[a,b,c,d,e]` before and `[a,b,c,d,e]` after. The initial ranking tests correctly prioritize h, but the actual controller does not apply that selection to occupied slots. The existing session test covers refill after Dismiss, not full renewal.

## P2 / (a) New recommendation rows omit shared song actions

Code: `apps/mobile/src/library/PlaylistRecommendations.tsx:127-140`.

Requirement: `docs/spec.md:232`: "one shared gesture for every list of song rows"; `docs/spec.md:332`: a streaming song's "long-press menu has Play Next, Add to Queue, Add to Playlist, Go to Album" and Go to Artist/Download.

Unlike `DiscoverSongRow` and the surrounding playlist entries, the footer renders a bare `TrackRow` with only `onPress`. It supplies neither `onLongPress` nor `swipe` nor accessibility actions. `TrackRow` does not install them by default. Consequently the footer has no song menu or swipe actions; the visible Add/Dismiss controls are its only non-play actions. This is confirmed by source wiring and does not depend on hardware timing.

## P2 / (a) New recommendation rows never show the playing indicator

Code: `apps/mobile/src/library/PlaylistRecommendations.tsx:127-140` (same integration point, separate missing state).

Requirement: original #538 line 15: "The correct row remains marked across Library, playlist and online representations where the song appears."

The footer permits playback on tap but does not subscribe to `useCurrentPlayingIds` or pass `state` to `TrackRow`. `TrackRow` marks the title, wavy underline and selected accessibility state only when `state === 'playing'`. A playing suggestion therefore never gets a playing indicator, including after its stream is downloaded. The rest of the patch deliberately upgrades the existing Library/playlist/Search/Discover rows to the shared identity hook, but omits this newly integrated list.

## Other axes and evidence

No additional concrete unrequested behavior was established. Source review did not establish an actionable defect in the recommendation acceptance transaction or isolation, playlist Undo, the Magic Queue overlap gate, or the long-press cancellation gate. Existing tests and evidence docs describe those seams; this review does not claim a new full-suite pass or device validation.

Known hardware/device evidence is one outstanding acceptance gap, not repeated code findings: physical S24+ / SM-G985F runs, 120 Hz/performance comparisons, long-press/scroll timing, swipe rebound, TalkBack and final combined-build UI interactions remain subject to the documented parent-owned validation. The parent was running tests and emulator validation concurrently.

## Resolution status

Standards: 3 findings, worst P2 renewal priority and playing state. Spec: 4 findings, worst P2 eligibility, renewal and row integration. Duplicate findings remain under their original axes. All five distinct corrections are implemented on `fix/open-tickets-review-fixes`, completing saved WIP `b9fe401e` in code commit `b6614a43`. The worktree started at integration `a01d7360`, merged `t3/a59482fe`, and checked/merged the integration branch again before committing. This is implementation verification; a new independent review is not claimed.

1. **Weighted genre fallback.** Tagless playlist seeds now average the supplied artist profiles' actual family shares. The 90% Pop / 10% Metal reproduction excludes the unrelated pure-Metal candidate and keeps the Pop candidate. Tagged playlist genres retain precedence.
2. **Renewal and refill.** A full `renew()` selects the currently ranked five distinct recordings before retaining their slots, so a newly favored/downloaded eligible song can displace an ordinary offer. Add/Dismiss still fill only their own slot. The third-review correction below replaces snapshot-based notification acknowledgement with a guard around this controller's synchronous successful-Add announcement. External membership and source notifications request full renewal, retained through in-flight work; an ordinary Add keeps the four held offers and their keys.
3. **Shared row actions.** The footer uses `DiscoverSongRow` for Library and streaming recommendations. That existing adapter supplies their long-press menus, configured swipes and `TrackRow`'s swipe accessibility actions. The recommendation read exposes its existing raw Library rows for the adapter; no second Library query is added. Metadata remains available for held offers through a later refill.
4. **Playing identity.** The same adapter already follows `useCurrentPlayingIds`, including Library and `yt:` representations across a download, and passes the existing playing state/annotation to its row. The footer no longer bypasses that subscription.
5. **Shared icon buttons.** Add/Dismiss use `IconButton`: 24dp, 1.5-stroke accent/disabled-tertiary glyphs, 48dp controls, shared press/haptic behavior, descriptive labels and per-offer busy state. `IconButton` now accepts optional `busy` accessibility state. No tests assert style constants.

The bounded acceptance-read observation from [independent architecture confirmation](544-independent-confirmation.md) is also addressed. Add reads current membership and Library recordings in its existing transaction without loading candidate songs/radios, pending stream favorites or the playlist's full feedback history. Its offer-key duplicate query remains. A two-track SQLite query probe measured 19 SELECT statements before the extraction and 15 after, with one membership addition in both cases. This establishes removal of four unused reads only. Validation still reads Library metadata/status/genres, and refill still reads the current recommendation snapshot; no latency, scaling or phone-performance improvement is claimed.

### Verification of the corrections

Applied the repository's TDD skill at the already-approved Core selection/session and real-SQLite store seams. The two WIP regressions were rerun against the original `a01d7360` Core source in a temporary copy: both failed with the reviewed defects (Metal incorrectly included; h not selected on renewal). They pass with the corrections. A further session regression was observed failing before the membership-notification change and passing afterward. The additional SQLite characterization test passed before and after narrowing the read, preserving download video identity despite edited tags and rejecting a file lost after display.

- Targeted selector/session/store run: **23 passed**, including the new regressions, stable Add/Dismiss refill, retry, duplicate protection, transaction rollback, download arrival and feedback isolation.
- Full `pnpm --filter @wave/core test`: **3,315 passed**.
- Full `pnpm --filter @wave/mobile test`: **502 passed**.
- Core and mobile typechecks: passed; the final mobile row-cache adjustment and Core test cleanup were typechecked again, and the 23 targeted tests rerun.
- Repository `pnpm fmt:check` and `git diff --check`: passed. Full lint exited successfully with repository warnings; the eight changed source/test files pass lint without warnings.

Local test/query artifacts: `/tmp/wave-open-tickets-20261021/reviewfix-dc52eeb6/`. No emulator/phone, TalkBack, APK installation, gesture timing, light/dark screenshot or performance evidence was produced by this implementation worktree. Parent-owned combined-build validation and the physical-device acceptance gaps above remain. No additional agents or remote mutations were used.

### Second review findings and corrections

The independent second-round Standards and Spec reports at `/tmp/wave-open-tickets-20261021/standards-review-round2.md` and `/tmp/wave-open-tickets-20261021/spec-review-round2.md` confirm the original five corrections and identify two further P2 lifecycle defects. Both are corrected together on `fix/playlist-recommendation-renewal`, based on parent integration `de3266f6` and updated with its later `52a0dfbd` tip. This records implementation evidence, not another independent review.

1. **Library invalidation with unchanged membership.** The footer now follows the cause of the existing Library notification: track changes and saved Library favorites trigger full source renewal, while this playlist's membership notifications can acknowledge Add's refill. The `items` refresh itself no longer triggers another renewal. Core's suppression applies only once to a matching Add snapshot, not to every unchanged-membership read. Source renewal during a save/read is retained and processed afterward. Public regressions prove truthful empty results after all candidates are removed, and inclusion of newly favored/downloaded candidates when their source change arrives during Add. The existing delayed Add regression still proves four held objects/keys survive its own membership notification.
2. **Failed-refill recovery after saved feedback.** Try again explicitly requests refill-only recovery. It excludes held recordings before the replacement limit, fills the vacant slot and preserves held objects/keys; normal full renewal still enforces the current priority five. The public regression saves actual playlist-scoped negative feedback, fails the refill read, then recovers to `[a,b,f,d,e]`. Before correction the same scenario produced `[a,b,f,g,h]`, replacing untouched d/e. Repeated failed recovery retains its refill error and held offers.

Both reported defects and the in-flight source-change case were observed failing before their corresponding corrections, then passing. The targeted selector/session/real-SQLite run passes **26 tests**, including weighted genre shares, favorite/download priority, delayed Add, stable Add/Dismiss and store acceptance/rollback/identity/isolation. Core/mobile typechecks, changed-file lint/format checks and `git diff --check` pass. Repository lint passes with existing warnings outside the changed files. Full Core/mobile suites were not repeated; their previous 3,315/502 results remain historical evidence. Shared row playing/menu/swipe behavior and shared action buttons are unchanged. No new dependencies, versions, lockfiles, UI test boundary, remote actions or devices were introduced.

Full commands, scope and evidence limits are recorded in [recommendation verification](558-playlist-recommendations-verification.md#2026-10-21-second-review-corrections). Red/green/final logs: `/tmp/wave-open-tickets-20261021/renewalfix-7c5d48a3/`. Parent-owned merged APK/controller/footer checks and physical-device, TalkBack, gesture and performance gaps remain open.

### Third Spec review correction

The third Spec report (`/tmp/wave-open-tickets-20261021/spec-review-round3.md`, reviewed `dbaa45be`) found that immediate playlist notifications were discarded during a recommendation input/graph read. The bounded correction on `fix/retain-external-library-invalidation` starts at parent integration `41b78255` and incorporates its later `954abe0d` tip, including the separately landed font-grid fix (`56de03dd`) and subsequent surface-inventory documentation. This is implementation verification, not a new independent review.

External playlist notifications now request the same full renewal as source changes; the existing pending-renewal path rereads after an in-flight save, full read or refill. The footer suppresses only its own successful Add announcement, while `playlistsChanged` and `publishLibraryChange` execute synchronously inside that accept callback. The guard clears in `finally`, before refill starts. Core no longer infers causality from equal playlist IDs, so an external addition of a held offer cannot be swallowed merely because the refill already read it. This supersedes the matching-snapshot acknowledgement described in the historical first/second-review evidence above.

Public Core regressions reproduced both stale offers: an external addition after a full-read snapshot left a offered, and an external addition of held a before Add's refill snapshot was mistaken for its acknowledgement. Both were observed red before their corrections, then green. Timing cases cover full reads before/after their snapshot, plus real-SQLite Add saves/refills before/after their snapshot. Replaying the parent's old notification request against `41b78255` leaves held A offered in all three concurrent SQLite cases; the corrected cases remove A and keep five distinct offers. A normal store-backed Add preserves all four held objects/keys and records exactly one feedback entry. The previous 26-test coverage remains, with the old delayed-ID-acknowledgement case updated to the causal notification contract; seven cases bring the targeted run to **33 passing**.

Core/mobile typechecks, changed-file lint/format and `git diff --check` pass; repository lint passes with existing warnings outside this slice. Parent-reported full results at `41b78255` are **3,318 Core / 502 mobile**; those suites were not repeated here. The original five and both round-two corrections remain covered. No dependencies, versions, lockfiles, public UI test boundary, remote actions, root-checkout edits, devices or subagents were introduced. The notification wiring was source-reviewed and typechecked; it was not tested through a rendered footer.

Commands and evidence limits: [third-review verification](558-playlist-recommendations-verification.md#2026-10-21-third-spec-review-correction). Logs: `/tmp/wave-open-tickets-20261021/invalidationfix-e0dd4576/`. Final APK/footer/device validation remains parent-owned.
