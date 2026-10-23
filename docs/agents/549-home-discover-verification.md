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

## Corrections and source confirmation

549-B–F have source corrections in the implementation commits (full final revision
in the handoff).
`SettingsSlider` now wraps its label/value row with an 8dp horizontal gap; both
texts are bounded to the available width and neither is line-capped. Values,
gestures, haptics and the native adjustable name/value remain unchanged. This also
covers full-size Settings consumers; their appearance/touch-duration sliders need
cross-flow confirmation under #555.

The existing row heading is explicitly accessible and owns the named refresh
action. `discoverRefreshAccessibility` adapts the native event to the same callback
used by pulling. Loading/rebuilding rows offer no action and ignore stale refresh
events; unrelated activation does nothing. Three app event-adapter tests exercise
these cases. They do **not** establish native focus/reachability. The surrounding
carousel stays ungrouped, so each song or mix keeps its own button/menu semantics.
The heading exposes busy state; its separate Updating line keeps the polite live
region. The label/status line can wrap without shrinking the heading away.

Playlist tiles keep their existing default accessible identity. Discover supplies
the complete mix title, artist credit and count through an optional tile label.
Cover shape, tile size, caption truncation, taps and long presses stay the same.
The gone-mix route keeps its header/Back outside a ScrollView, with the existing
chrome inset below the message. Its loaded list already uses that inset.

No new Library read, focus effect, Library subscription, recommendation, queue, persistence or
scheduling path was added. In particular, Home's two-frame shell, bounded standing
picks, independent placeholders, serial/cancellable daily builds, shared graph,
versioned known-video cache, Recap cache and startup gate are unchanged.

## Surfaces, aliases and applicable states

Codes follow the #534 register: L loading, E empty, C content, O offline, F
failure/recovery, D disabled, S selected/editing, A active playback/download.
Every row below is source-inspected (S). **L/D/L1.3/D1.3, TalkBack, navigation and
motion evidence are PENDING for every distinct surface and alias.** Listed states
are applicable; unlisted states are NA for the stated reason. Shared rendering
does not establish contextual Back/return behavior.

| Surface                                                                  | Entry points / aliases                                                                                                                                                            | Applicable states and NA reasons                                                                                                                                                                                                                                                                                                                                             | Findings / overlap                                                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Home route `(tabs)/index.tsx`                                            | Home tab; launch/return; retired `/library/discover` redirects here                                                                                                               | L initial shell and independent slices; E empty library, no plays, every section hidden; C populated; O saved/local content; F shared row/menu errors; S open editor; A playback/scan/Recap arrival. No inline Home query retry exists; do not invent a passing failure state                                                                                                | 549-C/F; #592 shell, #595 startup, #598 Recap                                                                          |
| Home sections (`HomeSection`, `HomeSections`, `ListeningOverview`)       | Home; Library's selected shelf shares Discover, Recently added/played, Most played albums/artists, Favorites. Most played songs, Stats entry and Listening overview are Home-only | L independent placeholders; E absent section; C art/artless, long titles, large counts; O local; A playing songs/favorites. No list selection UI on Home; S NA. F action dialogs; passive totals have no own failure/retry UI                                                                                                                                                | 549-C/D/F; #550 lists, #554 stats                                                                                      |
| Home editor card (`HomeEditorCard` / `ArrangementEditor`)                | Long-press/accessible Edit Home on Home title                                                                                                                                     | C shown/hidden lists; E all hidden; S reorder/remove/add; Done saves; outside/Back cancels. L/O/F/A NA: synchronous local draft, no fetch or playback controls. No text input/IME                                                                                                                                                                                            | Preserved #555/#556 shared editor and title semantics                                                                  |
| Home editor page (`settings/layout/home.tsx`)                            | Home → Settings → Layout → Home                                                                                                                                                   | Same rows as card; changes save immediately. Back returns without rolling back. No Done and no draft cancel on page. L/O/F/A NA as above                                                                                                                                                                                                                                     | Context alias of editor; #555 owns Settings navigation                                                                 |
| Discover section header / settings trigger                               | Home or Discover chosen as Library shelf                                                                                                                                          | C; D YT Music off (named disabled icon); S card open; O card works locally. L visual skeleton header; no independent A/F                                                                                                                                                                                                                                                     | Preserved 549-A; #556 IconButton/overlay                                                                               |
| Magic Queue seeds and refresh                                            | Discover on Home or Library shelf                                                                                                                                                 | L nine shape-matched seed skeletons; E no playable seeds hides row; C one to nine, artless/long credits; O seeds play local-only with YT Music off; D refresh while picking; A queue start; F start error dialog. No checkbox selection (S NA). Seed picking is best effort and retains old content on failure, with no inline error/retry                                   | 549-C/F; #540 adaptive grid, #537/#542 gestures, #593 standing picks                                                   |
| Shared Magic Queue menu entry points (`ActionsMenu` → `itemActions`)     | One local song (Home lists, Library, playlist or mini-player menu), album, artist or playlist; same action label/icon and seed dispatcher in each context                         | C/O start from local seed; F start error dialog; S origin highlight while menu is open; A queue session/Undo. Missing/streamed/unsearched songs, genre menus, bulk selection and the selection bar do not offer Magic Queue (Core policy, not disabled controls). Collection menus wait for seed songs before opening; no in-menu spinner                                    | Existing `itemActions.test.ts` public Core coverage; #551/#553/#556 shared menu and #553 playback-session presentation |
| Artist mixes and Genre mixes                                             | Discover on Home or Library shelf, each row separately                                                                                                                            | L first build; E no usable seeds/mixes hides row; C saved mixes; O saved mixes/build from phone; F failed manual refresh toast, retained mixes; D refresh while building; A opening/playing mix. YT Music off hides rows. No tile checkbox selection (S NA); download progress is on detail/menu, not tiles                                                                  | 549-C/D/F; #594 stepped builds, #541 genre faithfulness                                                                |
| Discover level card (`DiscoverSettings`) / shared `SettingsSlider`       | Settings icon on either Discover header                                                                                                                                           | C all three ranges and endpoints; S current step; O adjustments apply offline; D trigger with YT Music off. L/E/F/A NA: local five-step settings; no loading/network/error/play controls. No IME input                                                                                                                                                                       | 549-A/B; #555 shared slider consumers                                                                                  |
| Pull refresh, saved-content crossfade, Undo toast                        | Magic Queue, Artist mixes, Genre mixes; Home and Library shelf                                                                                                                    | C pull below/past threshold, release/cancel, repeated refresh, Undo; D busy; O local build; F failed mix refresh. No independent checkbox state. Keep reduced motion and default/zero tap duration combinations; retain existing gesture arbitration                                                                                                                         | 549-C; #537/#542 gestures, #556 toast, #593/#594 refresh policy                                                        |
| Mix detail (`library/discover-mix/[id].tsx` → `YtSongList`)              | Tap Artist/Genre tile from Home or Library shelf; deep link to a saved id                                                                                                         | C blended local/streamed songs, large credits/missing artwork; O locally saved list, local playback and offline stream/download feedback; S selected songs/actions; A playing, waiting/downloading/saving/downloaded; F playback/download failure/retry. L shared Library/finder resolution, but saved mix metadata is synchronous and no online-page loading request exists | 549-D entry naming; #551/#553/#555 shared detail/selection/download surfaces                                           |
| Gone-mix state                                                           | Invalid/expired mix id; YT Music off; too few songs after explicit filtering or rebuild                                                                                           | E gone; C full message and Back; O same local decision. L/F/D/S/A NA: no fetch or actionable song list; no retry request to manufacture                                                                                                                                                                                                                                      | 549-E                                                                                                                  |
| Mix actions menu / follow-up dialogs                                     | Long-press Artist/Genre tile in either context, including screen-reader long press                                                                                                | C play/shuffle/queue/save; A download/cancel/retry state; F open/save/download errors; O local actions/online failure; S highlighted origin. L finder preparation precedes menu; entries do not shift under finger. Save collision/Keep Both handled by shared import dialog                                                                                                 | #551 import collision; #556 menu/dialog; no duplicate implementation                                                   |
| Shell, section, mix, seed and Recap skeletons                            | `HomePlaceholders`, `HomeSectionSkeleton`, `DiscoverMixesSkeleton`, `HomeRecapSkeleton`                                                                                           | L only: still, named busy groups; tiles hidden from accessibility. Other states NA: no data or interaction. Section-specific content reservation follows existing font-aware dimensions                                                                                                                                                                                      | #592/#598 preserved                                                                                                    |
| Recap announcement, Stats entry, See all, Favorites and local tile menus | Home; same section on Library shelf where permitted                                                                                                                               | C/O/A plus shared route/menu states. Detailed stories/rankings belong to #554, detail pages to #551 and menus to #556; here verify entry/return and section order only                                                                                                                                                                                                       | Cross-flow coverage, no duplicate restyling                                                                            |

`/library/discover` shares Home's visuals but requires its own redirect/tab and
Back check. Mixes are pushed over the tabs from both Home and Library; they have
no per-section-tab mix alias. Library shelf → mix → Back must return to Library,
while Home → mix → Back returns to Home. Settings Home editor and card share row
rendering, with deliberately different save/cancel semantics. The debug-only
Home glass-spike link remains excluded from this ticket's production entry
coverage; the parent register separately tracks deep-link glass reachability.

## Bounded confirmation procedure (PENDING on device)

Use the same populated library, standing picks and saved Artist/Genre mixes before
and after. Capture baseline `e7a2b8d9` and the handoff revision, naming APK version,
SHA-256, instrumentation, model, OS/API, viewport, density, refresh rate and font
scale. Inspect default light/dark at 1.0 and 1.3 independently. Use Galaxy S24+
120 Hz and SM-G985F Android 13/API33 when available. Capture Home, Library's
Discover shelf, editor card/page, all sliders/endpoints, updated/loading rows,
mix detail/menu and gone mix. Include long names, long New music values, missing
art, one/nine seeds, narrow/short window and large counts.

1. Confirm first shell before read-backed content, independent section arrivals,
   empty/no-plays/all-hidden messages, and no skeleton flash on unchanged return.
2. Open Edit Home by long press and TalkBack action; reorder/remove/add all
   sections. Test Done, outside cancel and both Android Back modes. Repeat via
   Settings with immediate saving; leave and relaunch to confirm persistence.
3. Turn YT Music off: mixes disappear, local Magic Queue remains, settings icon
   says why disabled. Offline with YT Music on, open settings and move each slider
   to each endpoint. Reach all values and scroll at 1.3x/short height.
4. TalkBack each row heading: refresh once, no second action while busy; keep
   every tile independently reachable. Verify complete mix identity, accessible
   slider name/value/step adjustments, busy skeletons, Updating announcement,
   menu/modal focus and focus return after dismissal. Verify touch targets ≥48dp
   by device bounds. Headers are passive text with custom actions, not new touch
   buttons. Check hardware keyboard/D-pad access to buttons and slider behavior;
   Home/editor/mix settings have no text input, so IME overlap is NA. Shared
   playlist collision dialogs' input is covered under #551/#556.
5. Pull each row and release below/past threshold, scroll vertically starting on
   a tile and beside it, refresh/Undo, tap a seed, open each mix, Play/Shuffle,
   queue/save/download/cancel/retry, select songs, play through a download and
   return. Also start Magic Queue from the local song/album/artist/playlist
   menu entry points; verify the absent entries on streamed/missing songs, genres
   and selection. Repeat with tap duration zero/default and Reduce Motion off/on.
6. Open invalid/gone mix in a short window at 1.3x with mini player visible;
   scroll the full message clear of it and use header/system Back. Repeat every
   Home/Library/legacy redirect context. Preserve #536 global Back behavior.

No device result, screenshot or recording is supplied by this source pass.

## Performance and evidence limits

`device_list` on 2026-10-23 returned no devices and Android unavailable:
“Android SDK was not found.” `pnpm perf doctor` failed with
`Couldn't run adb: spawn adb ENOENT`. The real release-runner attempt for
`startup,tab-switch,scroll-home,push-settings` is recorded in the scratch
`549-perf-run.log`; it cannot reach a phone. No simulated timing is accepted.

Before/after phone raw results, medians/p90, frame deadline misses/jank, JS long
tasks, retained memory and repeat-run variability remain **PENDING**, as do
screenshots/recordings and every device check above. The earlier #534 canonical
Home screenshots predate the new read architecture and do not validate these
changes. No build/device identity is invented.

The changed code is presentation and accessibility event wiring. The desktop
`homeOpening`/`mixBuild` replays load unchanged store/Core/read paths and exclude
React layout, native text and accessibility; rerunning those would not measure
these corrections. Their existing evidence and source guards remain intact.
#593/#594/#595's outstanding Hermes/native-frame and six-ms limits stay with
those performance reports; this ticket makes no timing improvement claim.

A repeatable supplemental **Discover settings** device scenario is defined here
because the release runner has no card/slider case: default Home with Discover
first, today's saved mixes, YT Music on, network offline, mini player paused;
open settings; adjust New music 3→1→5→3, Faithfulness 3→1→5→3 and Popularity
3→1→5→3; dismiss with Back; repeat ten times after one warm-up. At 1.3x scroll
the card only as needed, preserving the same scroll/actions in both builds.
Record the interaction windows with the existing perf instrumentation/Perfetto,
including card layout/reblend and rerank work; retain raw traces/counters and
compiler/thermal/refresh/library/build metadata. Run separately with reduced
motion and default/zero tap duration. **Execution and automation of this
supplemental scenario remain PENDING**; it is a manual recipe, not a measured
or simulated result. Existing startup/warm tab/scroll/settings-push scenarios
must also run before/after on the same device and fixture.

## Dependencies and deferred items

No confirmed product-policy defect was reclassified to avoid a fix. Source
corrections 549-B–F still need rendered/native confirmation; acceptance is not
complete. 549-A was already fixed and is preserved. No schema or external API
change is needed. The first-build skeleton after an automatic background failure
and best-effort silent Magic Queue repick behavior are existing policy, recorded
for honest state coverage rather than changed incidentally.

Cross-reference #536 Android Back; #537 swipe/press motion; #538 identity after
download; #539 playlist Undo; #540 Magic Queue tile layout; #541 genre fidelity;
#542 long-press/scroll; #550 browsing; #551 details/imports; #553 selection;
#554 Stats/Recap; #555 Settings and shared sliders; #556 overlays/menu/toast/title
semantics. Performance owners #592–#595/#598 retain their source, cache and
scheduling contracts. These are verification dependencies, not duplicated changes.

## Checks

Full suite counts, typechecks, formatting/lint and final integration reconciliation
are recorded in the scratch `549-handoff.md`. Device acceptance remains PENDING
regardless of passing desktop checks.
