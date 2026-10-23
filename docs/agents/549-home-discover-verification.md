# #549 Home and Discover verification

Method: Impeccable native source audit, critique and polish. No web detector or
browser rendering substitutes for Android evidence. Device acceptance is PENDING.

## Baseline and authority

Audit baseline: `e7a2b8d98f4da22eaec2151f5d229130970abf90` on the latest local
`feat/579-all-open-tickets`, 2026-10-23. Work branch:
`feat/549-home-discover-polish`. Live #549 and #534 were read through the GitHub
API; both are open and have no comments. Read CLAUDE.md, docs/spec.md, the parent
polish register, #548 verification, the implementer brief and #592/#593/#594/#598/
#595 API/handoff notes.

Impeccable was loaded from the parent's `548-impeccable` checkout (the skill,
Android context, native audit, critique, craft floor and polish guidance). Native
critique uses one in-thread assessment. Questions skipped: this implementation
sub-agent has a fixed brief and is explicitly forbidden to delegate. Current spec
and The Quiet Catalog override stale PRODUCT.md claims about offline-only/no
accounts/no Stats, and generic platform suggestions to replace Wave's custom
components with Material. No design metadata is changed.

## Findings collected before edits

The section hierarchy, fixed Discover row order, quiet type, token colours,
shape-matched still skeletons and retained content during rebuilds fit the product.
Keep the zero-read Home shell, independent sections, standing picks and deferred
mix/graph/taste/Recap work. No redesign or recommendation-policy change is needed.
No numeric health/heuristic scores are assigned without rendered inspection.

| Finding | Severity / category     | Source defect                                                                                                                                                            | Intended correction                                                                                                                                                                                       |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 549-A   | Earlier P1 / adaptivity | The old Discover card lacked scrolling                                                                                                                                   | Already corrected in the integration baseline; preserve its ScrollView. Device confirmation remains PENDING                                                                                               |
| 549-B   | P1 / text scaling       | SettingsSlider places a flex-1 label beside an unshrinkable single-line value. The long New music values compete with the label inside a narrow card, especially at 1.3x | Let label/value wrap onto separate lines when they do not fit; preserve the adjustable control, range, callbacks and 48dp track                                                                           |
| 549-C   | P1 / accessibility      | PullRefreshRow puts custom refresh actions on an unnamed View without accessible=true. Grouping the carousel would hide its individual tiles                             | Move refresh actions onto the already named row heading, keep tiles independently focusable, remove actions while rebuilding, expose busy state. Preserve the pull gesture and existing refresh callbacks |
| 549-D   | P2 / semantics          | Discover uses PlaylistCard's hardcoded accessible word “playlist”, although the destination is a mix, and omits the full artist credit                                   | Allow a tile label override and give mixes their full title, artists and count; preserve playlist defaults                                                                                                |
| 549-E   | P2 / adaptivity         | The gone-mix EmptyState is in a fixed View below its header, with no scroll path or floating-player inset                                                                | Keep the Back header and message, scroll the empty state clear of chrome                                                                                                                                  |
| 549-F   | P2 / text scaling       | Discover row labels and Updating are both single-line; the status has no shrink constraint and crowds the heading in narrow/large text layouts                           | Wrap heading and status as needed, retaining the quiet label hierarchy and polite status announcement                                                                                                     |

Implementation, complete surface/state inventory, validation and evidence status
will be recorded below after the correction pass.
