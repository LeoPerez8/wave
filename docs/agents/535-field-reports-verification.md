# Owner field reports #535: implementation and verification

Original work branch: `feat/535-field-reports-fixes`, based on integration
`feat/534-resolve-open-tickets` at `61b0eaea`. Resumed in the bound worktree on
`fix/535-field-report-fixes`, starting at integration `7535e59e`, by merging
the original four issue commits through `b9d7d9cd`; the old worktree was not edited.
Ticket bodies and live comments
read on 2026-10-21, including #528 and PR #533. No physical device validation
has been performed here; the parent owns the emulator. No build/device is
inferred for reports other than the Android Back report explicitly identified
in #535. Proposed specification updates live here to avoid concurrent spec edits.

## #537 — swipe rebound

Raised the row return spring damping from 20 to 23, keeping stiffness 240.
This is a modest reduction in the spring overshoot; gesture activation, the
one-third-width arm threshold, velocity/cancel resolution, available actions,
vertical failure offsets, and immediate reduced-motion settling are unchanged.
No test asserts animation constants. Existing public Core swipe tests cover the
behavioral decisions. A comparable before/after recording and physical-device
scrolling/reduced-motion verification remain outstanding.

## #538 — playing identity across download

Reproduced at the public identity seam: the queue remains `yt:current` while
its downloaded Library row becomes `42`. The old equality check loses that
row's underline. The shared row hook now retains the queue id and adds the
Library id resolved by the existing recording finder, following Library and
queue-track changes. Library, playlists, Search, Discover, album/artist lists,
Home and Stats use that hook. The raw queue/player id, transport commands,
position and playback persistence are unchanged.

Public Core regressions first failed on the missing Library identity and now
pass. They cover download arrival, unmatched recordings, skip with stale
metadata, Library playback and stopping. Existing queue/position tests cover
the transport decisions; no live stream/download, pause/resume or position
continuity has been verified on a device. Proposed spec addition: current-row
identity follows the recording across a stream's completed Library download.

## #539 — playlist removal Undo

All app removal paths share `library/playlists.removePlaylistItems`, which now
shows the existing action toast only after a successful removal. Undo retains
the original item ids, sync ids and order keys; restoration stamps the entries
as an ordinary edit and uses normal playlist notifications/sync. It restores
only this operation's unchanged tombstones, skips new copies added meanwhile,
and preserves pre-existing repeated-song entries. It cannot revive a deleted
playlist. Streamed entries can link to a file downloaded during the Undo window.
Expiration/dismissal leaves tombstones in place. Library files, favorites and
the playback queue are not edited by removal or Undo.

Real SQLite store tests cover exact entry/order restoration, later additions,
repeated Undo, existing repeated songs, re-addition, deleted playlists, and
streamed/unsearched entries. A two-phone local sync-service round trip verifies
removal followed by Undo preserves the receiving phone's original entry ids and
order, including streamed/unsearched entries. This is persisted-store and local
service evidence, not a production sync or device restart claim. Existing toast
duration, recommended accessibility timeout and TalkBack announcement/action
handling are reused unchanged; on-device TalkBack/expiry checks remain pending.
Proposed spec addition: removing playlist entries offers the normal action-toast
Undo, restoring that operation's original entries and relative positions.

## #540 — Discover suggestion grid

Discover's Magic Queue seed suggestions now pick nine songs and lay out as
three columns at default phone text size, with two-line titles inside artwork.
The caption uses white text on an 80% black plate: even over pure white art,
the plate is at most #333 (calculated contrast with white is about 12.6:1).
The same plate covers missing artwork. Full title, artist, album and seed
purpose are read by the button; decorative image/text children are hidden from
accessibility. Tap starts the same seed, long-press opens the same actions,
and pull refresh, its accessibility action, and crossfades are retained.

At font scale 1.3 the layout becomes two columns; at 2.0, one. Narrow widths
also reduce columns to retain 48dp targets. Caption height grows with font
scale rather than disabling scaling. Older saved ten-song suggestions shrink
immediately to their first nine seeds. Public picker tests cover nine unique
songs, refresh/Undo and that persisted transition. Active Queue batch size and
ordering are unchanged. No screenshots, real artwork comparison, TalkBack or
large-text device validation were performed by this child. Parent should
capture default/1.3x and light/dark, including long titles and missing art.
Proposed spec update: Discover's Magic Queue suggestions use this adaptive
grid; replace its earlier ten-song carousel description.

## #541 — Balanced genre safety

Live #541 has no further comments. Reported: a Jack Johnson seed, Balanced,
with Rage Against the Machine and Bring Me the Horizon recommendations.
**Unknown original evidence:** seed song/title; which slider "Balanced"
referred to (New music, Genre faithfulness, or both); each candidate's title
and Library/YouTube Music source; seed and candidate file tags/artist profiles;
APK version/build/SHA, device and date. Do not reuse #535's Back-report metadata.
The current integration contains #528's #533 merge `39ed6239`; whether the
original APK did is unknown. These regressions use representative explicit
acoustic/folk/soft-rock/pop versus rap-rock/metal profiles, not recovered
metadata or a reproduction of those actual recordings.

The existing cosine rule could admit a mostly incompatible profile through a
minor shared family. Magic Queue now also requires shared genre mass: sum of
the minimum shares for each family. Balanced requires 0.5 overlap; the other
steps use their existing thresholds (0.8, 0.65, 0.35, 0.2). This is a general
profile rule with no artist-name special cases. Both Library and catalog gates
run for every batch, before learned taste/weights pick songs; refill metadata
lookups use the same gate and slider threshold. Mixes retain their cosine rule.

An untagged seed still resolves its radio artists' Library/Deezer profiles.
When nothing can resolve its genre, non-Wander recommendations are withheld
instead of silently accepting everything. Unknown candidate metadata also stays
out. Library Wander alone permits any genre (including unknown); YouTube Music
Wander retains a 0.2 overlap/affinity requirement, a known seed and known artist
profile, plus its existing catalog/radio, exclusion, cache and network rules.
This can produce shorter/empty batches when metadata is unavailable or lookups
are disabled; it does not substitute unrelated songs to fill the queue.

Public regression evidence: first 9 then three 10-song batches with both
sources; incompatible candidates rejected before picking; compatible neighbours
retained; unknown/null/empty seed profiles; all five settings and online Wander
restrictions; artist fallback and missing candidate metadata in existing #528
tests; refill looks beyond cosine-only matches. New behavior tests were seen
failing before each fix. Existing public mix tests remain unchanged.

Proposed spec addition: Magic Queue uses shared genre mass at the existing
Genre faithfulness thresholds, and an unknown seed cannot establish a safe
match. Coarse or inaccurate tags cannot distinguish styles they label
identically; the reported songs need their real metadata collected on the
owner's APK to judge this case. Physical playback/recommendation validation
remains pending with the parent.

## #542 — bounded long-press investigation and cancellation

No hardware reproduction exists here. Source inspection establishes two
asynchronous windows: `Press` measures its anchor before invoking the handler;
paged Library/collection/playlist and YT Music menus then read songs/artists or
network data before opening. Previously neither completion checked whether the
originating gesture was cancelled. This is a demonstrable stale-request path,
not proof of the owner's precise timing sequence. The second hypothesis,
React's `scrollEnabled` propagation reaching native too late, is still unproven.

A per-touch Core request gate now invalidates pending anchor completion on
press cancellation, leaving a pending press, release before measurement, a new
touch or unmount. Async menu data reads capture the same permission before
awaiting and check it before opening. An admitted long press may leave the
row and release while its menu data finishes loading, preserving ordinary
long presses and slide-to-choose. Old completions cannot cancel a newer touch.

The installed React Native 0.88 Pressability forwards its responder event to
`onPressOut`; the public event's `dispatchConfig.registrationName` distinguishes
`onResponderTerminate` from an ordinary slide outside the row. Termination or
touch cancellation clears the hold and dismisses that origin's open menu; an
ordinary slide keeps it. There is no responder capture/rejection, added timer,
long-press-delay change, native gesture rewrite, or scroll lock at initial
touch. The existing hold-driven list scroll lock begins at the existing
long-press threshold. Native lock delivery and absence of background scroll
still need device confirmation.

Opt-in instrumentation: bundle with `EXPO_PUBLIC_WAVE_LONG_PRESS_TRACE=1`,
restart the process and export Settings > Developer > Export Logs after a
short trial. `WaveLongPress` logs at most **256 lines per process**, with
monotonic JS timestamps, Press keys, touch start/configured delay, threshold
elapsed time, anchor admission/discard, async-menu admission/discard,
actual overlay creation, press-out/termination, release/cancel/unmount, and React list-scroll-prop
commits. No per-frame/move logging or artificial stall is installed. A React
commit is not native acknowledgement; compare with a screen recording and
native input/scroll trace before concluding lock propagation is the cause.

Public Core tests cover cancellation during measurement, cancellation during
menu data loading, slide-out plus normal release, late timers after a scroll,
release before measurement and stale callbacks across a new touch. Existing
slide-to-choose tests verify target selection decisions. These are policy
regressions, not automated UI or hardware gesture evidence.

Parent's pending hardware matrix: immediate vertical drags and flings from a
row; drift beginning just before/at/after the configured threshold; stationary
long presses; slide onto each menu side and release; slow Library/YT metadata
reads; cancellation/unmount; reduced motion and TalkBack. Record APK/build/SHA,
device/OS, configured delay, traces and recording. If scroll still overlaps an
admitted menu, inspect native responder/scroll timing first and decide on a
bounded UI-thread arbitration follow-up only from those traces. Do not delay
or block initial scrolling as a fallback. This ticket remains device-pending.
