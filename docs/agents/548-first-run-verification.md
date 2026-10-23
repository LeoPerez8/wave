# #548 first run, permissions and music folders

Method: Impeccable native design review and source correction. The web detector
does not apply to a native Android app. This is a source audit with behavioural
tests, **not rendered acceptance**: every device item below stays PENDING.

## Source baseline and authority

Audit baseline: `72969af7cfc9fad098f89551cb075c83df545584` (integration
`feat/579-all-open-tickets`). Live #548 and #534 were read on 2026-10-23, and
neither has comments. Also read: CLAUDE.md, the implementer brief, `docs/spec.md`
(stories 1 and 3–7, Glossary: Scan root, Excluded folder, Library scan) and the
#534 register (`534-polish-coverage.md`).

Impeccable was loaded from `pbakaus/impeccable` at
`5cb95eea9c96479f57afe0732a45470d30183326`: the skill, the Android context, and
the audit, critique, harden, craft floor and polish guidance. The current spec and
`apps/mobile/DESIGN.md`'s Quiet Catalog contract override stale `PRODUCT.md`
claims (no accounts, no network, no Stats). This ticket repairs no design
metadata.

## Surfaces and contextual aliases

| Surface                                                        | Reached from                                                                                     | Applicable states                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/access.tsx`                                               | Root stack, only while access is missing (`Stack.Protected guard={!granted}`). Replaces the tabs | C (first ask), F (denied return; settings launch failed). L NA (synchronous native check). E/O/S/A NA (no content, network, selection or playback)                                                                                                            |
| System all-files Settings screen                               | Access screen's Open settings / Try again                                                        | Integration only: launch, return with or without the grant, OEM list-screen fallback. Android owns the UI                                                                                                                                                     |
| `app/music-folders.tsx`                                        | Settings › Library › Music folders (the only route)                                              | L (roots/exclusions unread), C (one or several roots; zero or more exclusions), E (no exclusions), D (scanning, or a single root that can't be removed), A (scan running: banner), F (scan failed: banner; remove/include failure dialog). O NA (local), S NA |
| Remove-folder confirm, folder notices, error dialogs           | Music folders rows and buttons; Library/Songs empty states (`promptForMusicFolder`)              | C, F. Shared `overlay/alert` (owned by #556); only copy and integration are checked here                                                                                                                                                                      |
| System folder picker                                           | Add folder, Exclude folder, Choose music folder                                                  | Integration only: cancel, covered, unsupported, outside/root (exclusion)                                                                                                                                                                                      |
| `components/ScanProgressBanner.tsx` (548-S01)                  | Music folders; Library tab; Songs list (empty and unread)                                        | A (enumerating, indexing N of M, incremental with files to read), F (failed + Try again). Hidden when idle/done and for quiet incremental scans                                                                                                               |
| Library tab "No music found" and Songs "No songs" empty states | Library tab, Songs section/tab                                                                   | E after a finished scan, A (Songs: "Looking for songs" while scanning). Owned by #550's list pass; the folder action and copy are checked here                                                                                                                |
| Settings › Library section                                     | Settings index                                                                                   | C (folder count), D (Rescan disabled, "Scanning…"). Owned by the #556 settings pass; the entry into this flow is checked here                                                                                                                                 |

Every alias reaches the same implementation. They share visual evidence, but Back
and return must be checked from each one: Settings › Library › Music folders, and
the empty states' Choose music folder → picker → return.

## Audit and critique before corrections

The calm title, explanatory copy, single settings action, flat folder rows and
quiet progress rule fit the product. They need no onboarding carousel, decorative
motion or new identity. Folder changes already use the system picker and explain
covered, unsupported and excluded picks. Removing a root asks for confirmation and
says that the files stay on the phone. Controls are 48dp (`IconButton` and the #556
`TextButton` floor), colours come from semantic tokens, and Press follows the
motion preferences.

Earlier findings 548-A/B/C (scrollable access screen, a named and valued scan
progressbar, minimum-height folder rows) are integrated and preserved. The audit
found these gaps in visibility and recovery:

| Finding | Severity / category                        | Baseline defect                                                                                                                                                                                                                                                                                            | Correction (this branch)                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 548-D   | P1 / recovery                              | `useAllFilesAccess` discarded the promise from `requestAllFilesAccess`. If both native intents fail (an OEM build without either settings activity, or a SecurityException), the rejection went unhandled, nothing happened on screen, and the next return counted as a denial                             | `library/allFilesAccess.ts` catches the failure, keeps the access screen, shows polite live copy naming the manual path, and switches the action to Try again. A failed launch is not a denial. Taps while Android answers launch nothing more. Tests: `allFilesAccess.test.ts`                                 |
| 548-D2  | P2 / performance (found reviewing the WIP) | The WIP store wrote a fresh state object on every foreground recheck. That would have re-rendered `RootLayout` each time Wave came back to the foreground (the old `useState` path bailed out on equal values)                                                                                             | Writes happen only when a field changes. Test: "an unchanged foreground permission check does not notify". It failed on the WIP and passes now                                                                                                                                                                  |
| 548-E   | P2 / status                                | Music folders reported content as ready via `libraryQueryHasContent("roots")`, but the query's key is `scanRoots`. The screen never reported content ready to the timing session. Before the read finished, both sections drew empty (headings, hairlines, active Add/Exclude) as if there were no folders | The screen uses `useLoadedScanRoots`/`useLoadedExcludedFolders` (the same shared queries, with null meaning unread). Both lists render together once read, and `useScreenContent` follows that. Until then the screen is blank like the Library lists, with a busy "Loading music folders" element for TalkBack |
| 548-F   | P2 / adaptivity                            | Folder name and location were capped at one line each, and the song count competed sideways with them and the remove button. Similarly named folders on internal storage and an SD card, or deep parents, became indistinguishable once truncated, at 1.3x most of all                                     | Name and location wrap. The count moves under the location in the same column. Rows keep the 56dp minimum and gain 8dp vertical padding. A root not yet scanned no longer renders an empty count `Text`                                                                                                         |
| 548-G   | P2 / recovery/accessibility                | A scan failure's cause was cut to three lines, and the newly shown failure wasn't announced                                                                                                                                                                                                                | The full message shows. Title and cause sit in a polite live region, and Try again stays a separate, reachable control after them                                                                                                                                                                               |

The WIP's temporary "Opening settings…" label and disabled state were dropped.
Android answers `startActivity` within a frame, so the label and colour would only
flicker. The deduplication in `request` already makes extra taps do nothing.

Reviewed with no defect found: Android Back on the access screen leaves Wave (no
stack below it, system default). The decorative folder icon exposes no
accessibility node. Live copy on the denied return announces the changed
explanation. "Stop excluding" acts immediately because including a folder again
loses nothing. The Library/Songs empty states fall back to "your music folders"
when roots are unread, so they never name the wrong folder. No numeric health
score is assigned without a rendered inspection.

## Performance

No store read changed. `useLoaded*` reuses the existing `scanRoots` and
`excludedFolders` shared queries, keys included, so `libraryReads` and
`startupReplay` measure the same work as before. No desktop bench applies. The
only runtime effect is React rendering on return to the foreground. The 548-D2 test
covers it (zero notifications for an unchanged answer, as with the previous
`useState` bail-out). Phone measurements of startup and foreground return on the
S24+/SM-G985F release runner are **PENDING**.

## Cross-references and dependencies

- #556 owns the shared alert/dialog, `TextButton` and Settings index. The confirm,
  notice and error dialogs here use them unchanged.
- #550 owns the Library/Songs list empty states. Only their folder action is
  checked here.
- #536 (Android Back, released) covers the global Back handler. The access screen
  adds nothing to it.
- No product decision or new ticket is needed.

## Evidence availability

On 2026-10-23, `device_list` returned no devices: "Android SDK was not found".
`adb` is not installed and `ANDROID_HOME` is unset.

**PENDING:** comparable before/after screenshots or recordings for 548-D/E/F/G on
one device, with the same content, theme and font. Also pending: the tested APK
build label and hash; the device model, OS, viewport, density, refresh rate and
font scale; light and dark at normal and 1.3x for the access screen (first ask,
denied, launch failed), Music folders (loading, one root, several roots, long
paths, exclusions, scanning, failed) and the banner states; TalkBack names, live
announcements, busy state and focus order; gesture and button Back from every
alias; system picker integration; the grant, revoke and regrant cycle; and
hardware performance. The #534 canonical baseline manifest has no access or
music-folder captures and cannot stand in for them. No screenshots or device passes
were fabricated.
