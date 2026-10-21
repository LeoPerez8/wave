# Owner field reports #535: implementation and verification

Work branch: `feat/535-field-reports-fixes`, based on integration
`feat/534-resolve-open-tickets` at `61b0eaea`. Ticket bodies and live comments
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
