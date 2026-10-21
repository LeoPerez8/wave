# Playlist recommendations — #558

Product-spec addition for integration into `docs/spec.md` by the parent (kept here to avoid concurrent spec edits).

## #559 — visible recommendations

Editable Wave playlists show Recommended songs after their entries, up to five distinct eligible recordings. An empty playlist asks for songs first. A short or exhausted catalog shows the actual count; loading and retryable failure leave the playlist usable. Find and selection hide the footer.

Core derives the playlist's genres and credited artists and ranks the Library plus the existing candidate catalog through `recommend`, using the existing Artist graph. Track genre tags take precedence over artist-wide genres. Graph/radio proximity and genre compatibility lead; compatible same-artist and same-album songs rank strongly. A known genre mismatch cannot qualify from artist/album alone. With no genre evidence, artist/radio proximity still works. No global taste signal is read. Library files remain available offline or with YT Music off; streaming candidates require online and YT Music enabled. This view makes no network requests to fill its catalog.

Recording identity follows the shared integrated Library/YT Music matcher: title, credited artist and length, including remaster normalization and distinct live/edit versions. Playlist recordings and cross-source duplicate representations are excluded, preferring the playable Library file.

Evidence: Core public API tests exercise ranking through the Artist graph and recording exclusion. Real-SQLite store tests exercise playlist → stored catalog/Library → ranked suggestions and offline/disabled fallback. Device appearance and interaction remain for the parent's emulator run; no physical-device evidence is claimed.
