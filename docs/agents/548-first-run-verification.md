# #548 first run, permissions and music folders

Method: design review only (detector not applicable, native Android platform).

## Source baseline and authority

Audit baseline: `72969af7cfc9fad098f89551cb075c83df545584`, branch
`feat/548-first-run-permissions`. Live #548 and #534 read on 2026-10-23; both have
no comments. Read CLAUDE.md, the binding implementer brief, both cached specs,
`docs/spec.md`, and the existing #534 coverage register. This is a source audit,
not a rendered acceptance result.

Impeccable loaded from `pbakaus/impeccable` at
`5cb95eea9c96479f57afe0732a45470d30183326`: its skill, Android context, native
audit, critique, harden, craft floor and polish guidance. The native critique runs
in this context; no extra agents or web detector. The assigned implementation
brief supplies the decisions; questions skipped because this is an implementation
sub-agent with a binding scope. The current spec and DESIGN.md's explicit Quiet
Catalog contract override stale PRODUCT.md claims about no accounts/network/Stats
and the sidecar's older palette. No design metadata repair is in scope.

## Audit and critique before corrections

The calm title, explanatory copy, single settings action, flat folder rows and
quiet progress rule fit this product. There is no case for a new onboarding
carousel, decorative animation or replacement visual identity. Folder changes
already use the system picker and explain covered, unsupported and excluded
choices. Removing a root confirms that files remain on the phone. Source review
confirms shared 48dp controls, semantic theme tokens and Press motion preferences.

The actionable gaps concern visibility and recovery, rather than aesthetics:

| Finding | Severity / category | Baseline defect and expected correction |
| --- | --- | --- |
| 548-D | P1 / recovery | `useAllFilesAccess` discards the promise returned by Android settings. If both native intents fail, there is no feedback and the rejection escapes. Catch the failure, retain the access screen and offer retry/manual settings recovery; prevent duplicate launch requests. |
| 548-E | P2 / status | Music folders checks readiness under `roots`, while the actual query is `scanRoots`; the populated screen never reports main content ready. Use loaded query results directly, show a named still loading state, and wait for both roots and exclusions before offering edits. |
| 548-F | P2 / adaptivity | Folder name and location are both capped to one line; the count competes horizontally with the identity and remove target. Similarly named long folders can become indistinguishable. Let identity/location wrap and put the count below them within a growing row. |
| 548-G | P2 / recovery/accessibility | Scan failure details stop after three lines and the newly displayed failure has no live-region announcement. Preserve the full cause and announce the error while leaving Retry separately reachable. |

Earlier findings 548-A/B/C (scrollable access screen, scan progress semantics,
minimum-height folder rows) are already integrated. Preserve their corrections.
No numeric design/audit health score is asserted without a rendered inspection.
TalkBack focus, clipping, keyboard traversal, Back and latency remain runtime
questions, not evidence-backed passes.

## Evidence availability

`mcp__t3_code__device_list` on 2026-10-23 returned no devices. Android unavailable:
"Android SDK was not found. Install it with Android Studio or set ANDROID_HOME to
your SDK directory." iOS also unavailable and outside product scope.

**PENDING:** comparable before/after screenshots and behavior recordings for
548-D/E/F/G; tested APK/build label/hash; actual device model, OS, viewport,
density, refresh rate and font scale; all rendered, TalkBack, navigation and
hardware performance acceptance. The #534 canonical baseline manifest does not
contain access/music-folder captures and cannot stand in for them. No screenshots
or device passes were fabricated.
