# Playlist recommendations — #558

Product-spec addition for integration into `docs/spec.md` by the parent (kept here to avoid concurrent spec edits).

## #559 — visible recommendations

Editable Wave playlists show Recommended songs after their entries, up to five distinct eligible recordings. An empty playlist asks for songs first. A short or exhausted catalog shows the actual count; loading and retryable failure leave the playlist usable. Find and selection hide the footer.

Core derives the playlist's genres and credited artists and ranks the Library plus the existing candidate catalog through `recommend`, using the existing Artist graph. Track genre tags take precedence over artist-wide genres. Graph/radio proximity and genre compatibility lead; compatible same-artist and same-album songs rank strongly. A known genre mismatch cannot qualify from artist/album alone. With no genre evidence, artist/radio proximity still works. No global taste signal is read. Library files remain available offline or with YT Music off; streaming candidates require online and YT Music enabled. This view makes no network requests to fill its catalog.

Recording identity follows the shared integrated Library/YT Music matcher: title, credited artist and length, including remaster normalization and distinct live/edit versions. Playlist recordings and cross-source duplicate representations are excluded, preferring the playable Library file.

Evidence: Core public API tests exercise ranking through the Artist graph and recording exclusion. Real-SQLite store tests exercise playlist → stored catalog/Library → ranked suggestions and offline/disabled fallback. Device appearance and interaction remain for the parent's emulator run; no physical-device evidence is claimed.

## #560 — matching favorites and downloads

Eligibility is decided before status. Among eligible recordings, every favorite or download ranks ahead of ordinary songs; compatibility orders each group. Thus all qualifying priority songs fit when there are at most five, and the most compatible five win when there are more. Duplicate recordings still count once. Library favorites, pending YT Music favorites and completed downloads are read afresh on renewal; unrelated favorites/downloads cannot qualify by status. Explicit favorite/download behavior is unchanged.

Evidence: Core selection checks include matching favorites/downloads, an unrelated favorite/download, seven priority songs and changed status. Real-SQLite reads verify favorites, unstar, downloaded-file status and catalog pending favorites reach visible selection.

## #561 — playlist dismissal

Each visible recommendation has Dismiss. The controller saves the playlist-scoped signal before removing the offer, replaces only that slot, and preserves the other offer objects and keys. Recording equivalents consumed during this visit are excluded before the five-song limit, so dismissals can reach beyond the initial five. A failed save leaves the offer available for retry. A saved choice whose refill fails leaves a truthful hole and offers Try again without repeating the write. Controls are disabled during pending work and stale offer keys are ignored.

Feedback is local SQLite data keyed by playlist identity and offer key, with an upgrade migration and duplicate-write protection. Exact recordings, credited artists, nearby artists from the baseline graph, and genre families receive a bounded, mild adjustment; eligibility remains unchanged. A dismissal is not an artist/genre ban, and reopening can offer a dismissed recording again with the adjustment. No feedback goes into the global taste history or Artist graph inputs.

Evidence: Core tests cover held saves, repeated/stale taps, failed saves, stable refill and refill recovery. Real-SQLite tests cover upgrading an existing Library, closing/reopening the database image, playlist isolation, actual failed writes, retry, refill and unchanged global taste inputs. The Taylor Swift fixture preserves her global favorite and the original graph/ranking for unchanged inputs.

## #562 — playlist acceptance

Each suggestion has a separate Add button beside Dismiss; tapping the row still plays it. Add rechecks current playlist membership and available Library recordings, then commits one playlist entry and one positive signal in the same SQLite transaction. A feedback-save error rolls the entry back. A stale offer whose recording is already present adds neither another entry nor another signal. A stream downloaded since it appeared resolves to its Library recording, and saved video IDs prevent duplicate representations after tag edits.

After a successful addition, the playlist is notified and only the vacated recommendation slot is refilled, using freshly read contents, feedback, favorite/download status, candidate catalog and baseline Artist graph. Pending actions block rapid repeated/cross-action taps; old offer keys cannot act again. Candidate exhaustion leaves fewer songs, and loading/save/refill failures have distinct recovery copy. No action favors, downloads, records playback, rewrites global taste/graph inputs, or learns for another playlist. The independent row-play, favorite, download and playback mechanisms retain their existing semantics.

A positive signal can follow a prior dismissal, including for the same recording after reopening. Positive and negative recording signals aggregate, rather than retaining the first negative match forever. Artist, graph-neighbor and genre-family adjustments remain bounded to ±0.35 and apply only after compatibility eligibility, within the favorite/download priority policy. Feedback is kept on this phone across restarts, without being synced as global preference data.

Evidence: Core controller tests cover acceptance only on save success, repeated/cross-action/stale taps, updated membership, stable refill, read failure/retry, truthful empty/exhausted state and changed favorite/download status on the next refill. Core ranking tests cover positive related-track learning and acceptance cancelling a prior recording dismissal. Real-SQLite tests exercise transaction rollback after an actual feedback write failure, duplicate/preexisting additions, stream acceptance without implicit favorite/download, downloads arriving between display and Add, dismissal → acceptance → database restart, isolated same-input ranking for another playlist, unchanged global taste/catalog/recommendation ranking, and complete exhaustion. The preexisting #559/#560 ranking and store integration tests remain enabled.

## Manual acceptance still required

The parent owns the device. This implementation has not installed or driven an emulator or physical phone. On the parent's final APK, verify the actual editable-playlist footer (including an empty playlist), visible five/short counts, row playback, Add and Dismiss, pending disabled controls, unchanged surrounding scroll/playlist behavior, save/refill error copy, YT Music off/offline Library fallback, leaving/reopening, and process restart. Check light/dark appearance, long song titles and larger system text, and TalkBack labels/focus after replacement. Physical S24+ interaction, performance and TalkBack evidence remain unavailable here; automated Core/store evidence is not a device claim.

Impeccable context reported preexisting design-sidecar drift (`DESIGN.md` newer than `.impeccable/design.json`) and an unset visual build path. Neither is changed in this implementation; `document` can refresh the sidecar in a separate design task.
