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
