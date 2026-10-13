# Wave v1 — Spec

Status: draft for review · Owner: @LeoPerez8

## Problem Statement

I keep my music as local files on my Android phone (Samsung Galaxy S24+). BlackPlayer has the features I want from a local player — folder-based library, gapless playback, lyrics, sleep timer, an equalizer and a tag editor — but its look and interaction model feel dated next to Apple Music, whose structure, gestures and "Liquid Glass" materials I much prefer. Apple Music, on the other hand, does not exist as a local-file player on Android. No app gives me both.

## Solution

**Wave** is a personal, Android-only local music player with a BlackPlayer-grade local-file engine and an interface of its own. Apple Music (iOS 26 era) is the reference for how it should feel, not a template to copy. It indexes the music folders I choose, plays them gaplessly through a native audio engine with full system integration (notification, lock screen, Bluetooth), and records every play so that rich listening statistics can be built later.

v1 delivers the core player and library. v2 adds the advanced audio and library-management features (see Out of Scope).

## Glossary

- **Track** — one audio file in the library.
- **Album** — tracks grouped by album title + album artist.
- **Artist** — a track artist; **Album artist** — the artist an album is filed under (falls back to the track artist; "Various Artists" for compilations).
- **Genre**, **Folder** — alternative groupings of tracks.
- **Playlist** — a user-made, ordered list of tracks.
- **Scan root** — a folder Wave indexes; **Excluded folder** — a folder under a root that Wave ignores.
- **Library scan** — walking the scan roots and reconciling files with the index (full on first run, incremental afterwards).
- **Play context** — what a playback was started from (album, artist, playlist, genre, folder, search, all songs, favorites, home section).
- **Queue** — the ordered list of tracks to be played, including the current one and **Up Next**.
- **Play event** — one record per time a track starts playing, with how long it was listened to and how it ended.
- **Counted play** — a play event that counts towards play counts: listened to for more than 15 seconds, or, for a song of 15 seconds or less, played to the end. Each play event counts at most once, however long it goes on.
- **Sidecar** — a `.lrc` lyrics file beside an audio file (`Song.lrc` or `Song.mp3.lrc`).
- **Favorite** — a starred track (Apple Music's star).
- **Artist image** — the circle an artist is shown with: their **artist photo** (downloaded online, see Artist photos) when there is one, else the cover of the album that represents them, else their initial.
- **Now Playing** — the full-screen player; **Mini player** — the floating glass pill above the tab bar.
- **YT Music song** — a song found on YouTube Music rather than in the Library. It is identified by its YouTube video id (`yt:<videoId>` wherever a track id is expected, so it can't collide with a Library id), can be streamed or queued, and becomes a Track only once it's downloaded into the Library. A YT Music song the Library already has (see YT Music) is never offered as one. _Avoid_: online track, remote track, stream.

## User Stories

### First run and library

1. As a user, I want Wave to ask for all-files access on first launch, so that it can read every audio file in my music folders.
2. As a user, I want Wave to index my `Music` folder by default and let me choose the folders my music is actually in with the system folder picker, so that I get a working library whatever my folders are called.
3. As a user, I want to add and remove scan roots and exclude sub-folders in Settings, so that only the music I care about appears.
4. As a user, I want to see scan progress (files found / indexed) during the first scan, so that I know the app is working on a large library.
5. As a user, I want to start browsing while the first scan is still running, so that I don't wait for tens of thousands of files.
6. As a user, I want Wave to pick up new, changed and deleted files automatically each time I open it, so that my library stays current without a manual full rescan.
7. As a user, I want to pull to refresh in the Library, so that I can force a rescan after copying new music.
8. As a user, I want MP3, FLAC, M4A/AAC/ALAC, OGG/Opus and WAV files to be supported, so that my whole collection plays.
9. As a user, I want Wave to read title, artist, album, album artist, genre, year, track and disc number, duration, embedded artwork and embedded lyrics from tags, so that my library is organised the way I tagged it.
10. As a user, I want files without tags to still appear (using the file name as title and "Unknown Artist/Album"), so that nothing goes missing.
11. As a user, I want a renamed or moved file to keep its play history and favorite status, so that my statistics survive reorganising folders.

### Browsing (Library tab)

12. As a user, I want the Library tab to list Playlists, Artists, Albums, Songs, Genres, Folders and Favorites as entry rows like Apple Music, so that I can browse the way I think.
13. As a user, I want albums shown as an artwork grid with title and album artist, so that I can browse visually.
14. As a user, I want artists sorted alphabetically ignoring leading "The"/"A"/"An" and accents, so that sorting matches my expectations.
15. As a user, I want an album screen with large artwork, title, album artist, year, genre, track list ordered by disc and track number, and Play / Shuffle buttons, so that I can play an album properly.
16. As a user, I want an artist screen listing their albums and songs, so that I can explore an artist.
17. As a user, I want genre and folder screens listing their tracks, so that I can browse by genre or by my folder structure.
18. As a user, I want long lists (tens of thousands of songs) to scroll smoothly at 120 Hz, so that the app feels native on my phone.
19. As a user, I want a fast-scroll alphabet index on long lists, so that I can jump to a letter.
20. As a user, I want long-press context menus on tracks, albums, artists and playlists (Play Next, Add to Queue, Add to Playlist, Favorite, Go to Album/Artist), so that I can act without opening screens. The finger that long-pressed can stay down and slide onto an entry: lifting it there runs that entry, so one gesture does it (lifting anywhere else, or without sliding, leaves the menu open to tap; the list underneath holds still meanwhile).

### Playback

21. As a user, I want tapping a track to play it and queue the rest of its context after it, so that playback continues naturally.
22. As a user, I want gapless playback between consecutive tracks, so that live albums and mixes play without silence.
23. As a user, I want play/pause, next, previous and seek, so that I control playback.
24. As a user, I want "previous" to restart the current track if more than 3 seconds have played, so that it behaves like Apple Music.
25. As a user, I want shuffle that keeps the current track playing and shuffles the rest, so that toggling shuffle doesn't interrupt me.
26. As a user, I want turning shuffle off to restore the original context order from the current track, so that I can go back to album order.
27. As a user, I want repeat off / repeat all / repeat one, so that I can loop a context or a track.
28. As a user, I want Play Next and Add to Queue, so that I can line up tracks without losing the current context.
29. As a user, I want to see, reorder (drag) and remove items in Up Next, so that I can curate what plays.
30. As a user, I want playback to continue in the background with a media notification, so that I can use other apps.
31. As a user, I want lock-screen, notification, Bluetooth and headset-button controls, so that I can control playback without opening Wave.
32. As a user, I want playback to pause when headphones are unplugged or Bluetooth disconnects, so that music doesn't blast from the speaker.
33. As a user, I want Wave to pause or duck for calls and other apps' audio and resume afterwards where appropriate, so that it behaves well with the system.
34. As a user, I want my queue, current track, position, shuffle and repeat restored (paused) when I reopen Wave, so that I can pick up where I left off.

### Mini player and Now Playing

35. As a user, I want a floating glass mini player above the tab bar showing artwork, title and play/pause + next, so that playback is always reachable.
36. As a user, I want to swipe the mini player left/right to skip tracks, so that I can change tracks quickly.
37. As a user, I want to tap or swipe up the mini player to open Now Playing, and swipe down to dismiss it, with an interactive spring animation, so that it feels like Apple Music.
38. As a user, I want Now Playing to show large artwork that shrinks when paused, title, artist, a scrubber with elapsed/remaining time, and transport controls, so that I have full control.
39. As a user, I want the Now Playing background tinted with colours from the current artwork and to crossfade on track change, so that each album has its own mood.
40. As a user, I want to star the current track from Now Playing, so that favoriting is one tap away.
41. As a user, I want to tap the album or artist name in Now Playing to navigate there, so that I can explore what's playing.
42. As a user, I want a Lyrics view in Now Playing, so that I can read along.
43. As a user, I want synced lyrics to highlight and auto-scroll with playback, and tapping a line to seek there, so that lyrics work like Apple Music.
44. As a user, I want a Queue view in Now Playing with shuffle and repeat toggles, so that I can manage playback from one place.
45. As a user, I want a sleep timer (15/30/45/60 minutes, custom, or end of current track), so that music stops when I fall asleep.
46. As a user, I want to see the remaining sleep-timer time and cancel it, so that I stay in control.

### Search tab

47. As a user, I want a Search tab (separate glass pill, as in iOS 26) that searches songs, albums, artists, genres and playlists as I type, so that I find music fast.
48. As a user, I want search to ignore case and accents and match word prefixes, so that "beyo" finds "Beyoncé".
49. As a user, I want results grouped by type with the best match on top, so that I can scan results quickly.
50. As a user, I want my recent searches kept, so that I can repeat them.

### Playlists and favorites

51. As a user, I want to create, rename and delete playlists, so that I can organise music.
52. As a user, I want to add tracks, albums or a whole artist to a playlist, so that building playlists is quick.
53. As a user, I want to reorder and remove playlist tracks, so that I control the order.
54. As a user, I want playlist artwork to be a mosaic of its first albums, so that playlists are recognisable.
55. As a user, I want a Favorites list of all starred tracks, so that I can play my favorites.
56. As a user, I want to import `.m3u` / `.m3u8` playlist files (several at once) from Library › Playlists, each becoming a playlist named after its file with its songs in file order, so that playlists I made in another player come with me. Entries not in my library are skipped and listed in a summary, and a name I already use asks whether to replace that playlist or keep both.

### Home tab and play history

57. As a user, I want every play recorded with start time, listened time, how it ended (completed, skipped, stopped, interrupted) and its play context, so that statistics can be computed later over my full history.
58. As a user, I want a play to count once I have listened to a song for more than 15 seconds (or played a song of 15 seconds or less to the end), so that play counts reflect what I actually listened to.
59. As a user, I want a Home tab with Recently Added (albums), Recently Played, Most Played and Favorites sections, so that my most relevant music is one tap away.

### Look and feel

60. As a user, I want the app to follow the system light/dark theme, so that it matches my phone.
61. As a user, I want Wave to have its own visual identity (The Quiet Catalog: tinted grounds, a teal accent and an ember highlight for favorites and now playing), so that it feels like mine rather than a copy of another app.
62. As a user, I want calm, uncluttered screens with no heavy effects, so that the app stays smooth at 120 Hz.
63. As a user, I want small, exact typography and line icons, so that my library reads like a record label's catalog.
64. As a user, I want haptic feedback on key interactions (play/pause, favorite, long-press, scrubbing ends), so that the app feels tactile.
65. As a user, I want the entire interface in English, so that it is consistent.
66. As a user, I want every tap to animate, with the animation duration adjustable in milliseconds in Settings, so that the app responds the way I like.

### YT Music

67. As a user, I want Search to also look on YouTube Music and list matching songs below my library's results, so that I can find music that isn't on my phone.
68. As a user, I want songs I already have not to be repeated there, so that the section only shows what my library lacks.
69. As a user, I want a quiet line instead of an error when I'm offline or YouTube Music doesn't answer, so that searching my library is never in the way.
70. As a user, I want to turn YT Music off in Settings, after which Wave makes no YouTube requests at all, so that I decide what leaves my phone.
71. As a user, I want no ads, no Premium upsell and nothing held back for a free account, so that Wave stays my own player.
72. As a user, I want to sign in to my YouTube account if I choose, so that YT Music in Wave is my own YouTube Music, at my account's audio quality.

## Implementation Decisions

### Platform and distribution

- Android only. Minimum Android 12 (API 31, required for native blur), target the latest SDK. Tuned for the Galaxy S24+ (120 Hz).
- App name **Wave**, application id `dev.leoperez.wave` (permanent).
- Personal use, sideloaded APK. No Play Store, so `MANAGE_EXTERNAL_STORAGE` (all-files access) is acceptable.
- No backend of Wave's own. The Library works offline; the online features are listed under Network.

### Network

Wave uses the network for three features, each behind its own Settings switch (on by default) that stops every request it makes.

- **Artist photos** (Deezer's open API, free and keyless; below): sends artist names.
- **Lyrics and genre** (LRCLIB and Deezer's open API, free and keyless; below): sends a song's title, artist, album and duration.
- **YT Music** (YouTube Music, below): `music.youtube.com/youtubei/v1/*` for search (and, as later tickets land, browsing, song details and the player), `www.youtube.com` for the player script and visitor data, `*.googlevideo.com` for audio, `accounts.google.com` for sign-in. It sends what's typed in Search, the video ids of songs it plays or downloads, YouTube's visitor data and, once signed in, the account's session cookie. It never sends the Library's contents, play history or stats. Offline, or when YouTube fails, the YT Music parts show a quiet line and the Library works as before.

### Artist photos

- Wave downloads a photo of each artist from **Deezer's open API** (no account or key): it searches the artist's name and takes the best match's picture. Artist names are the only thing sent. A "Download artist photos" switch in Settings (on by default) says so; off, Wave makes no requests and artists show their album artwork. "Clear artist photos" deletes the downloaded ones.
- **Matching** is Core's (`artistPhoto.ts`): names compare with case, accents, a leading "The", punctuation and "&"/"and" ignored; only an exact match counts, and of namesakes the most followed one (its photo or none). "Various Artists", "Unknown Artist" and names without letters are never looked up.
- **Caching.** Lookups run in the background after each library scan, three at a time, and stop after a few failures in a row (offline). Photos are saved beside the album artwork (`files/artwork/artists/`) as a thumbnail (lists, menus) and a large image (artist page), and are never fetched again. A lookup with no match is retried after a week, a failed one after a day (`artist_photos` table, by artist key).
- **Fallback.** Until a photo arrives, without a match, offline or with downloads off, the artist's album-artwork image shows.

### Lyrics and genre

- **Find Lyrics and Genre** (a song's long-press menu and the selection bar) looks a song up online and writes what it finds into the file, replacing the lyrics and genre there. Settings › Lyrics and genre runs it on the whole Library in the background, with progress and Cancel, and ends with a summary: updated, not found, failed. It stops early when the services can't be reached (three lookups failing in a row).
- **Sources.** Lyrics come from **LRCLIB** (`lrclib.net`, free, no key): synced (LRC) lyrics are preferred, plain lyrics are taken when that's all there is. The genre is that of the song's album on **Deezer's open API**: a track search, then the matched album's first genre. A song's **title, artist, album and duration** are the only things sent, and "Unknown Artist" / "Various Artists" songs are never looked up. A "Find lyrics and genre online" switch in Settings (on by default) says so; off, Wave makes no lookups and the menu entry is gone.
- **Matching** is Core's (`lyricsAndGenre.ts`): titles and artists compare like artist photos (case, accents, punctuation, a leading "The" ignored), plus featured artists ("feat. X") and version notes in brackets or after a dash ("(Live)", "- Remastered 2011"). Lyrics must be within 2 seconds of the song's length; then synced beats plain, the song's own album beats another, and the closest length wins. The genre's album is the matched track's, preferring the song's own album, then the closest length. No match leaves that field alone; no match at all leaves the file untouched.
- **Writing** is native (`SongTagWriter`, jaudiotagger): only the lyrics and genre fields change, and the audio and every other tag stay as they were (JVM tests check this for MP3, FLAC, M4A, Ogg Vorbis and WAV). A WAV file's lyrics go into an ID3 chunk (RIFF INFO has no lyrics field) and its genre into both. A format Wave can't write tags to (Opus, raw AAC) gets the lyrics in a sidecar `.lrc` and no genre, and the summary lists those songs. A sidecar already beside a file is replaced too, since it would win over the tags in the Lyrics view.
- **After writing** the file is read again as a scan reads it and its index entry updated, so Genres, Search and an open Lyrics view show the new values without a rescan.

### YT Music

- YouTube Music has no official API. Wave talks to it the way Metrolist does: through **innertubex** (MetrolistGroup/innertubex, from JitPack), from the native module. innertubex sends requests and handles sessions, ciphers and stream extraction; reading the answers into songs is Wave's (`YtSearchParser`, after Metrolist's page parsers). Metrolist is the reference for anything the library leaves to the app.
- **Licence.** innertubex is GPL-3.0, and so is any Metrolist code Wave ports, so the APK that ships them is a GPL-3.0 combined work.
- **Wave is its own client, not YouTube's app.** Nothing YouTube serves as an ad is ever requested, shown or played (Wave plays the audio stream itself), there is no Premium upsell or nag, and nothing is limited because the account isn't Premium; the only difference is the audio bitrate YouTube's servers send. Wave doesn't report plays to YouTube.
- **Search.** Below the Library's results, a YT Music section lists the songs YouTube Music's "Songs" search finds: artwork, title, artists · album, length. It asks once typing pauses (300 ms), never blocks typing or the Library's results, keeps the last results up while the next query loads and drops answers to queries no longer typed (Core's `stepYtSection`). Offline, or when YouTube fails, the section shows a quiet line (`ytSectionView`). With nothing in the Library matching, the section still shows under a "nothing in your library" line.
- **Already in the Library.** A YT Music song is left out when a Library song has its title (case, accents, punctuation and a "feat." credit aside), shares an artist with it and, when both lengths are known, is as long within 3 seconds, so a live take or an edit still shows (Core's `libraryMatcher`).
- **Off switch.** Settings › YT Music › Use YT Music (on by default). Off, the section isn't shown and the native client refuses every request before it reaches the network; the switch is kept natively too, so the playback service obeys it without JS.
- **Account.** Signing in is optional; everything YT Music does also works signed out. Settings › YT Music › Sign In opens Google's sign-in page in a web view inside Wave (`YtSignInActivity`, as Metrolist does). Once the page reaches YouTube Music signed in, Wave takes the session cookie and the page's account (`YtSignInPage`), asks YouTube Music's account menu whose account it is (`YtAccountMenu`) and keeps the session; Settings then shows the account's picture, name and email, and Sign Out. The session is handed to innertubex (`replaceSession`), so every request the `YtClient` sends (Search, playback, downloads, Discover) goes out as the account; a Premium account therefore gets the audio YouTube serves Premium. Visitor data isn't the account's and is left as it is.
- **Session privacy.** The cookie lives only in the native module: in one file in the app's no-backup storage (`noBackupFilesDir`, never in an Android backup), never in the JS key-value store, never handed to JS (which only sees `{ status, account: { name, email, photoUrl } }`) and never logged. The sign-in web view starts and ends empty: its cookies and site storage are cleared before the page opens and when it closes, so its only copy is the native one. Sign Out deletes the file and clears the web view's cookies and storage again.
- **Expiry.** A session YouTube stops accepting expires instead of failing: when a request comes back HTTP 401, or the account menu has no account (checked each time Settings opens), the session's credentials are dropped, the request is asked again signed out (once), and Settings shows "signed out" with Sign In Again. Signed out, nothing can be rejected again, so there's no error loop. Without an answer (offline, YouTube failing) the session stays as it was. What Settings shows is Core's (`stepYtAccount`, `ytAccountView`); with YT Music off there is no Sign In, but a signed-in account can still be signed out of.
- **Native shape.** One process-wide `YtClient` (package `expo.modules.wavenative.yt`) owns the HTTP client and innertubex's session; the `WaveYtMusic` Expo module exposes it to JS (`setEnabled`, `searchSongs`, `session`, `checkSession`, `signIn`, `signOut` and the `onSessionChanged` event; failures reject with `ERR_YT_OFFLINE`, `ERR_YT_FAILED` or `ERR_YT_DISABLED`), wrapped by the app's `YtMusic` Effect service. Building it needs Kotlin 2.4 (innertubex's), set through `expo-build-properties`.

### Stack (mirrors the T3 Code mobile app)

- pnpm monorepo. Expo (SDK matching T3 Code), React Native, React, TypeScript strict with erasable-syntax-only, Expo Router, uniwind (Tailwind), Effect, Legend List, Reanimated, Gesture Handler, React Native Skia, expo-sqlite + Drizzle ORM, expo-haptics. Linting/formatting with oxlint/oxfmt.
- Code, UI copy, docs, issues, PRs and commits are in English.

### Modules

1. **Core** (workspace package, pure TypeScript, **zero runtime dependencies**). Holds all decision-heavy domain logic behind a small public API, so it can be tested anywhere with plain Node:
   - _Queue engine_ — a pure state + command reducer: start playback from a context at a given track; next/previous (with the 3-second restart rule); seek; shuffle on/off (current track stays first, original order restorable); repeat off/all/one; Play Next; Add to Queue; reorder; remove; track-ended transitions. It outputs the ordered list the native player should hold.
   - _Play-event classifier_ — given start, listened time, duration and end reason, decides whether a play is counted.
   - _Library model_ — grouping (album identity = album title + album artist, album-artist fallback, compilations), sort keys (articles and accents ignored), disc/track ordering, unknown-tag fallbacks.
   - _Scan reconciliation_ — given the known index and a scan result, produces adds/updates/removals, and matches moved/renamed files (same size + duration + title + artist) so history and favorites carry over.
   - _Search_ — normalisation (case, accents, punctuation), word-prefix matching and ranking across entity types.
   - _Lyrics_ — LRC parsing (timestamps, multiple stamps per line, offsets) and current-line lookup.
   - _Sleep timer_ — deadline/end-of-track logic.
   - _YT Music_ — YT Music song ids (`ytTrackId`, `parseTrackId`), whether a song is already in the Library (`libraryMatcher`), the Search section's state (`stepYtSection`, `ytSectionView`) and the account in Settings (`stepYtAccount`, `ytAccountView`).
   - _M3U import_ — parsing `.m3u` / `.m3u8` (`#EXTM3U`, `#EXTINF`, comments), resolving entries (absolute, relative to the playlist file, `file://`, Windows separators) and matching them to Library tracks by path (case-insensitively, as Android's storage is), the playlist's name, Keep Both's numbered name and the import summary (`m3u.ts`). The native module's file picker reads the files and their paths.
2. **Native player** (local Expo module, Kotlin, Media3). A `MediaSessionService` hosting ExoPlayer, so notification, lock screen, Bluetooth/headset buttons, audio focus and becoming-noisy handling come from Media3. The JS side owns ordering (from the queue engine) and pushes the ordered item list; the native side plays it gaplessly and reports state, throttled position, item transitions with a reason (auto-advance, skip, seek, error) and errors. Native shuffle is not used. The audio pipeline keeps a hook for custom audio processors so equalizer, crossfade and ReplayGain (v2) slot in without restructuring.
3. **Native scanner** (same Kotlin module). Walks the scan roots minus exclusions, reads tags with a JVM tag library that also supports writing (needed by the v2 tag editor), extracts embedded artwork once per unique image (hashed, cached as files) together with a small colour palette (Android Palette) for the Now Playing tint, and finds sidecar `.lrc` files. It streams results to JS in batches of ~500 and supports an incremental mode driven by known path + modification time + size. The same module holds the YT Music client (`yt` package, see YT Music).
4. **Library store** (app, Drizzle on expo-sqlite). The single owner of the schema and migrations. Tables for tracks, albums, artists, genres, folders, artwork (path + palette), playlists and playlist items, favorites, play events, scan roots/exclusions, recent searches, and persisted playback state. Home sections and play counts are queries over play events.
5. **App services** (app, Effect). Wrap the native modules as typed services and event streams; orchestrate scans (core reconciliation → store); drive the queue engine and sync it to the native player; record play events through the classifier; persist and restore playback state.
6. **UI** (app, Expo Router). Three tabs — Home, Library, Search (Search rendered as a separate glass pill). A custom glass tab bar, a floating glass mini player and a full-screen Now Playing presented over the tabs with an interactive drag-to-dismiss gesture. Detail screens for album, artist, playlist, genre and folder. Settings for scan roots, exclusions and rescan.

### Play event shape

One row per playback start: track, started-at, listened milliseconds, track duration, end reason (`completed` | `skipped` | `stopped` | `interrupted`), counted flag, and play context (type + id). Append-only; nothing is aggregated away.

### Visual design

- The visual world is **The Quiet Catalog** (ECM Records' cover program as the reference): artwork in calm, tinted fields, small and exact type. The decision, its direction contract and the product record live in `apps/mobile/PRODUCT.md` and `apps/mobile/.impeccable/`; `apps/mobile/DESIGN.md` documents the built system.
- Components are fully custom (Apple Music is inspiration only); system and predictive Back always work.
- Theme follows the system. Fog ground in light (`#e0ecef`), true black in dark (`#000000`); on it, dark grouped areas (`#0a1113`, a ramp step only dark mode uses, so light mode's text is untouched), cards and fills, and separators climb one ramp step each. Every neutral comes from one tonal ramp; teal accent, ember highlight. Text, accent and highlight meet WCAG AA on the ground and cards in both themes. Tokens live in `apps/mobile/global.css`, mirrored and contrast-checked in Core (`packages/core/src/theme.ts`); the launch splash uses the same grounds. Settings › Theme picks a background per mode (true black is the dark default; Slate, the night slate ground Wave shipped before, is still offered and looks as it did), a primary and a secondary from preset swatches; a background chosen before the default changed is kept. For the other backgrounds Core (`themeChoice.ts`) derives cards, groups, fills, separators, text and the dialog scrim by keeping each token's contrast against the ground, and deepens or brightens inks that wouldn't read. The choice is applied at runtime over the CSS defaults. The launch splash shows the chosen backgrounds from the next cold start: Android draws it before Wave's code runs, so the app ships a splash style per pair of preset backgrounds and, whenever the theme changes, saves the choice natively (Core's `launchTheme`: the style to open with and each mode's ground, primary and secondary) and picks that style with `SplashScreen.setSplashScreenTheme`. That needs Android 13; on Android 12 the splash keeps the default theme. The splash ships a style per choice, so its logo wears the chosen primary (top wave) and secondary (bottom wave) too, and the logo moves: its waves flow from the first frame until the first screen is ready, then the splash fades out, never before the first sweep ends; with Remove animations on, the logo stands still (Core's `launchLogo.ts`). The launcher icon follows the primary (top wave) and secondary (bottom wave) on black: Wave ships an icon per pair as activity aliases and switches when it leaves the screen, warning first if the launcher drops the home-screen icon on a switch.
- Inter as the typeface, with a light large title and tracked-caps catalog lines; Tabler line icons.
- Signature move: a thin A–Z spine on long lists that sets one huge letter in the field while scrubbing, with a haptic tick per letter.
- Every tap animates through one press primitive whose duration comes from Settings (0–600 ms, default 140 ms) and respects the system's reduce-motion setting.
- Glass is reserved for what floats: the tab bar, the mini player, and dialogs and menus, which are floating glass cards (rounded, sized to their content, clear of the system bars) over a lightly dimmed app. They are drawn at the app root, not in a separate window, so the blur shows the app behind live. Below Android 12 (no blur) the cards are an opaque surface.
- Now Playing background: gradient from the artwork palette, animated on track change; controls use the app palette.

### Build and CI

- GitHub Actions on every PR and on `main`: install, typecheck, lint, core tests, Kotlin unit tests, and assemble an APK uploaded as a build artifact that I install on the phone.

## Testing Decisions

- A good test exercises a module only through its public interface and asserts observable behaviour (resulting queue, counted/not counted, search results order, reconciled changes) — never internals. Tests should survive refactors of the implementation.
- **Primary seam — Core.** Every decision-heavy rule lives in Core and is tested there with `node:test`, run directly by Node's TypeScript type-stripping. Because Core has zero dependencies, these tests run anywhere, including environments without package-registry access. This is where most tests live.
- **Library store.** Migrations and the Home/play-count queries are tested in CI against a real SQLite database through Drizzle, seeded with fixture data.
- **Native module.** Kotlin JVM unit tests in CI for tag reading (small fixture audio files per format) and for scan diffing; Media3's test utilities for the player command/event mapping where practical.
- **UI.** No automated UI tests in v1. Each ticket has acceptance criteria verified manually on the S24+ using the CI-built APK.
- Prior art: none yet (new repository). The first ticket establishes the test setup for each seam.

## Out of Scope

- v2 features: equalizer and presets, crossfade, ReplayGain, tag editor, smart playlists, M3U export, Last.fm scrobbling, home-screen widgets, album artwork download, statistics/metrics screens (v1 only records the data).
- iOS, desktop, web.
- Streaming services other than YouTube Music (see YT Music), cloud libraries, network shares.
- Accounts, sync, backup.
- Play Store distribution.
- Chromecast / casting; Android Auto beyond what Media3 provides for free. Android Auto is one of the two primary listening scenes, so a browsable Auto library is the first v2 candidate.
- Localisation (English only).

## Further Notes

- **Glass on Android** (no longer a default material; see Visual design) **was the main technical risk.** Sampling the native views behind a surface is not straightforward in React Native Skia. The first UI work is a spike comparing approaches (for example, Android `RenderEffect` blur with an AGSL refraction shader versus a Skia snapshot of the backdrop) for visual quality and 120 Hz performance on the S24+. Acceptable fallback if refraction is too costly: blur + tint + specular rim highlight.
- **Track identity** is the file path in v1, with moved/renamed files matched by Core's reconciliation so history survives.
- **Development environment constraint:** the agent session working on this repository cannot reach the npm registry or the Android/Gradle repositories. GitHub Actions is the build and test environment of record; Core's zero-dependency design keeps its tests runnable inside the agent session as well.
- Library sizes in the tens of thousands of tracks are the design target for scan batching, list virtualisation and query indexes.
