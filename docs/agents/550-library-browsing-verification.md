# #550 Library tabs and browsing verification

Method: native source audit and design review (Impeccable native audit, critique and polish; web detector not applicable). Baseline: `c0a837f605d80288e278c5f9765434237d70e757`, branch `feat/550-library-browsing-polish`, 2026-10-23. Live #550 and #534 bodies/comments read through `gh api`; both have no comments. Findings below were recorded before implementation.

Current `docs/spec.md` and The Quiet Catalog govern. The stale offline-only/no-account/no-Stats product metadata and DESIGN's final prohibition on black do not override the shipped specification. Preserve semantic tokens, square covers/artist circles, flat hierarchy and tunable motion. The existing 550-A keyboard correction remains integrated.

## Baseline findings

- **550-B / P2 / status and recovery:** Albums, Artists, Genres and Playlists use empty-array placeholders before their first shared read. They draw empty copy while loading. Shared-query first failures leave the same empty UI indefinitely; Songs and Favorites instead stay blank. A scan error banner cannot explain a database read failure. Expose first-read loading/failure and explicit targeted Try Again, keeping the last good result during refresh and the existing shared-read lifecycle. Test the Core registry public API, already authorized by the implementation brief.
- **550-C / P2 / adaptivity:** `PlaylistsHeader` puts its count and two text actions in one non-wrapping row; `PlaylistsButtons` also disallows wrapping. The count has no width once the actions consume the available width. Permit the count/actions to wrap on a narrow or enlarged-text layout. Rendered before/after evidence is PENDING.
- **550-D / P1 / accessibility:** Albums maps two letter starts to the same grid row. `spineStep` derives each step solely from the top row, resolving ties to the last letter there. Repeated decrement can return the same earlier letter forever. Preserve the last explicitly chosen letter while its row is still current so every letter is reachable. Test forward/backward traversal, row changes and reverse sorts through the Core public spine API.

Fixed-height 56dp rows/tile captions remain a render-verification risk inherited from the parent register, not a new confirmed clipping claim. No speculative font-metric/indexing change is planned.

## Evidence status

All screenshots, native interactions, light/dark × 1.0/1.3 font, TalkBack, target/inset measurements, keyboard, motion, gesture/button Back and release phone performance are **PENDING**. No APK/device has been tested for this slice. Historical parent captures do not validate this build. The required surface/state inventory and final check results will be completed below.

Additional source finding before its correction (the handle is unchanged at implementation commit `fca7d6e0`): **550-E / P2 / touch target** — playlist grid/large drag handles have a 48dp width but only `22 × fontScale + 16` dp height: 38dp at 1.0 and 44.6dp at 1.3. Keep the same caption centre and enlarge the absolute hit area to at least 48dp; preserve drag recognition, list cell sizes and the existing semantic Move up/down alternatives. Actual gesture/target measurement remains PENDING.
