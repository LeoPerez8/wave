# Architecture review and bounded corrections (#543, #544)

Source baseline: `61b0eaeacc2e980cb00b2bc1d4f1f85d634cd485`; corrected navigation:
`7535e59e`. Reviewed the latest 120 commits before implementation, current
`docs/spec.md`, `CONTEXT.md`, `CLAUDE.md`, and Matt Pocock's
`improve-codebase-architecture` and `codebase-design` guidance. No GLOSSARY.md
or architecture decision record directory exists; the current product spec's
glossary governs Music/Library/Artist/Track terminology.

## Scope from recent changes

The history repeatedly changes recommendation work: `discoverMixes.ts` (13),
Core `magicQueue.ts` (10), `magicQueueRadio.ts` (9), Core `magicQueue.test.ts` (7),
`MagicQueue.ts` (7), and `mixHarvest.ts` (7). `docs/spec.md` (28) and Core's
export index (29) are frequent but do not themselves establish architectural
friction. Counts come from `git log --format= --name-only -120` at the baseline.
The review therefore followed recommendation reads, shared cache invalidation,
playlist edits and the real integration typecheck, rather than splitting large
files by size or adding hypothetical adapters.

## Accepted: preserve route knowledge at the metadata seam (#564)

**Strength: Strong.** Observed, reproducible friction: the complete typecheck
failed in the tabs layout, Settings index and Layout index once Expo's generated
route declarations were present. The definitions widened known route values to
`string` or broad template strings; callers lost the information needed by the
navigation interface.

Before: Core route metadata → widened strings → three mobile callers → typed
navigator errors. After: validated literal metadata → existing callers → typed
navigator. Core remains independent of Expo.

Implementation: keep the Settings/Layout arrays' literal values with
`as const satisfies readonly …[]`, and retain `TAB_PATH`'s value union while
enumerating tabs. No new module, route registry or runtime behavior. The
accepted implementation ticket is [#564](https://github.com/LeoPerez8/wave/issues/564),
published as a native child of #543 with self-contained criteria and no invented
blocking relationship.

**Deletion test:** removing the widening annotation eliminates friction;
deleting the domain metadata module would scatter route knowledge across
callers. Preserve the module and sharpen its interface. This improves locality
of route definitions and leverage for every metadata consumer. Existing
Core Settings/navigation public-interface tests are the seam; the generated
Expo router is the second real consumer, not a hypothetical adapter.

Validation: original three `TS2322`/`TS2345` errors recorded, then complete
`pnpm typecheck` passed. All 19 existing Settings/navigation tests passed,
including route order and tab/detail context. The full baseline Core suite
also passed (3,286 tests). Type-only changes require no new UI fixture tests.

## Deferred: one recommendation-preparation module

**Strength: Worth exploring.** `discoverMixes.ts`'s `readerOf`,
`magicQueueRadio.ts` and the new playlist recommendation work all prepare a
catalog, artist graph, genre profiles and Library identity. Existing
`mixCatalog`, `artistGraphNow`, `mixKnown` and `sharedRead` already concentrate
most expensive reads and cache invalidation. Their caller-specific rules are
intentional: Discover uses section sliders, Magic Queue has a session's refill
policy and genre constraint, and #558 requires playlist-isolated feedback.

Before: each caller prepares its policy-specific recommendation input. Possible
after: one read module returns shared input; each caller retains its own policy.
The deletion test does **not** yet establish that another interface would remove
complexity rather than relocate it. Merging feedback policies would violate
#558. Do not add a universal recommendation abstraction during this effort.
Follow-up: assess actual repeated preparation after
[#558](https://github.com/LeoPerez8/wave/issues/558) is integrated; its engine
reuse and isolated feedback tests supply concrete evidence for that decision.
No speculative implementation ticket accepted.

## Rejected: split LibraryStore by file size

**Strength: Speculative.** `LibraryStore.ts` is large, but it supplies a stable
Effect-facing interface over the real SQLite adapter; domain decisions already
live in Core and database behavior has real-store public-interface tests.
A broad split would move imports and delegation without demonstrating added
depth, while concurrent playlist acceptance/Undo changes depend on atomic edits.

Before: callers cross one store seam. Proposed split: callers learn several
store interfaces and transaction coordination. The deletion test predicts
relocated complexity and weaker locality. Rejected without implementation;
[#539](https://github.com/LeoPerez8/wave/issues/539) and
[#562](https://github.com/LeoPerez8/wave/issues/562) remain the bounded,
behavior-driven places to exercise atomic playlist edits. No generic repository
or second hypothetical adapter is introduced.

## Final review

Pending independent architecture exploration/confirmation and combined-branch
Standards/Spec review. The HTML before/after report is generated in the OS temp
directory and shown through T3's HTML renderer. This review does not establish
phone performance or device accessibility evidence; those remain in #545/#534.
