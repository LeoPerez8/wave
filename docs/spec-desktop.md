# Wave desktop: spec

Status: approved by the owner on 2026-11-18 · Owner: @LeoPerez8

This spec covers Wave on Windows and Linux. It is a companion to `docs/spec.md`, which stays the
source for the glossary, the shared rules (queue, counted plays, search, sorting, scan
reconciliation, lyrics, sleep timer, Magic Queue, Normalize Volume, sync), Build and CI, and
Security. Where this file says "as on the phone", the phone's story or rule applies unchanged.
The decisions were made in a planning effort on 2026-11-17 and 2026-11-18 and are recorded here
and in `docs/adr/`.

## Problem statement

I listen to my local music on my phone with Wave, and on my computer with whatever player is
there. The computer holds a bigger collection, and none of its players has Wave's queue, Magic
Queue, lyrics, YouTube Music, or the Wave account, which already keeps my playlists, favorites
and play history across phones. Listening on the computer adds nothing to my stats, and a
playlist made on the phone doesn't exist there.

## Solution

Wave desktop is a full player for the music files on the user's own computer, on Windows x64 and
Linux x64. Its first release (v1) does what the phone does with the Library, playback, the Wave
account and YouTube Music, in a desktop layout after Apple Music for desktop: a sidebar, a fixed
player bar, table lists and keyboard shortcuts. It joins the Wave account as one more device,
with no new sync features.

It is an Electron app. The decisions stay in `packages/core`, shared Effect services and the
database move to `packages/client`, an own Rust engine plays the audio, and the phone's Kotlin
for YouTube Music, Soulseek, downloads and tags runs on a Java runtime bundled in the installer.

The desktop grows on the `ti` channel with every push to `main`, and reaches the `main` channel
only when all of v1 is done.

## Glossary

The glossary in `docs/spec.md` applies. It changes in four places so the same word reads right
on both devices:

- **Library**: every music file on this device (phone or computer) that Wave knows about. Each
  device has its own Library; the Wave account syncs what it syncs today.
- **Track**: one song in the Library: an audio file on this device, or, while signed in to a
  Wave account, a missing song.
- **Folder**: a directory on this device.
- **Missing song** and **non-D** say "this device" where they said "this phone".

Desktop terms:

- **Player bar**: the fixed bar along the bottom of the window with the playing song, the
  transport, the scrubber and the volume. It takes the mini player's place. _Avoid_: mini
  player (on desktop), footer.
- **Side panel**: the panel on the right of the window holding Lyrics and Queue as two tabs. It
  pushes the content instead of covering it.
- **Tray**: the system tray (notification area) icon Wave keeps while running. _Avoid_:
  menu bar icon.
- **Unavailable folder**: a scan root that isn't reachable now (an unplugged drive, an offline
  network share). Its songs stay in the Library and can't play until it returns. _Avoid_:
  missing folder (a missing song is something else).
- **Device id**: the random id each signed-in device gets. The sync service still calls it
  `phone_id`; UI text says "device" ("Sign Out on All Devices").

## User stories

### The phone's stories in v1

Numbers are `docs/spec.md` User Stories.

| Section                             | In v1                                                                                                                                                                             | Later                                                                 | Not on desktop                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| First run and library (1–11)        | 1a account invitation; 2–11; 10a voice-note filter                                                                                                                                | 1b Bring your music card                                              | 1 all-files access; 1c, 1d Android link settings; 7 pull to refresh (a Refresh command and F5 instead) |
| Browsing (12–20)                    | 12–17; 19 jump to a letter; 20 menus, opened by right-click, with their toasts                                                                                                    |                                                                       | 18 as worded (smooth scrolling); slide-to-choose                                                       |
| Playback (21–34)                    | 21–29; 21a Undo; 22 gapless; 22a crossfade; 22b Buffer; 22c Normalize Volume; 29a Magic Queue with continuation; 30–31 system media controls and the tray; 34 restore             |                                                                       | Android Auto parts of 31; 32 unless the engine gives it free; 33 audio focus                           |
| Mini player and Now Playing (35–46) | 38 cover, scrubber, transport; 39 tinted background; 40 star; 41; 42–43 synced lyrics; 44 Queue with History; 44a Related; 45–46 sleep timer; 46a Add to Playlist and Download    | 46b configurable slots (the synced preference is ignored)             | 35–37a mini player gestures; 38a double tap; 38b; 38c finger sizes                                     |
| Search (47–50)                      | 47–50; local lyrics phrase search                                                                                                                                                 | Genius phrase search                                                  |                                                                                                        |
| Playlists (51–56)                   | 51–56; playlist image; `.m3u` and `.m3u8` import; Graveyard                                                                                                                       |                                                                       |                                                                                                        |
| Home and history (57–59)            | 57–59; Discover                                                                                                                                                                   | Recap, Stats, Listening History (plays are still recorded and synced) |                                                                                                        |
| Look and feel (60–66)               | 60, 61, 62, 63, 65                                                                                                                                                                | 66 animation duration (follows the system)                            | 64 haptics                                                                                             |
| YT Music (67–78)                    | All: search, streaming, Soulseek and YT downloads, YouTube sign-in, artist pages, playlists with YT entries, playlist import by link                                              |                                                                       |                                                                                                        |
| Wave account (79–87)                | 79–87                                                                                                                                                                             |                                                                       |                                                                                                        |
| Other                               | Fix Songs; lyrics online (LRCLIB, YT); share a song or playlist as a copied link; open a YT Music or Spotify link by pasting or dragging it in; offline behaviour as on the phone | Spotify account and imports; Recognize; Karaoke; Genius; lyrics image | BlackPlayer import; Android Auto; owning https links                                                   |

### Desktop stories

#### First run and the Library

D1. As a user, I want Wave to index my Music folder on first launch without asking, and to browse while the scan runs with its progress on Home, so that I see my music at once.
D2. As a user, I want to add other folders (another disk, a network share) with the system's folder picker, and to remove them or exclude sub-folders in Settings, so that the Library covers where my music really is.
D3. As a user, I want the Library to notice files I add, change or delete while Wave runs, and to catch up on what changed while it was closed, so that I never press a refresh button for normal use.
D4. As a user, I want songs on an unplugged drive to stay in the Library, greyed with a folder glyph and their plays, stars and playlist places kept, and to play again when the drive is back, so that unplugging a disk loses nothing.
D5. As a user, I want the account invitation after the first scan, as on the phone, so that I can bring my playlists and history over if I have an account.
D5a. As a user, I want the Bring your music card after the invitation, with From Spotify and From YT Music, so that my playlists come over from the app I used before. Continue, Not Now and Escape answer it for good on that computer; the answer is kept there and never synced, and a computer that used Wave before the card existed never gets it, nor does a build that can't sign in, which has no invitation.

#### The window

D6. As a user, I want a sidebar with Search, Home, the Library's kinds, YT Music's pages, my playlists and Settings, so that everything is one click away.
D7. As a user, I want a player bar always at the bottom with the song, the transport, the scrubber, the sleep timer, Lyrics, Queue and the volume, so that playback is always in reach.
D8. As a user, I want songs, albums, artists, playlists and genres as tables with 40 px rows, where a double-click or Enter plays a row and a single click selects it, so that the computer works the way I expect.
D9. As a user, I want a play glyph over the thumbnail or track number when I hover, select or focus a row, so that I can see that a row plays without learning to double-click.
D10. As a user, I want Lyrics and the Queue in a side panel next to what I'm browsing, so that I can read lyrics and keep browsing.
D11. As a user, I want Now Playing (artwork, title, lyrics) to open from the player bar's artwork or title and close with Esc, so that I can focus on the song.
D12. As a user, I want a window as small as 960×600 to stay usable, the sidebar turning to icons below 1120 px and the tables dropping the Album column when the content gets narrow, so that Wave fits beside other windows.
D13. As a user, I want right-click, Shift+F10 or the Menu key to open a song's menu, and Select to turn on checkboxes and the selection bar as on the phone, so that I can act on several songs.
D14. As a Windows user, I want Wave's own title bar with the system's window buttons and Snap Layouts; as a Linux user, I want my system's window frame, so that Wave behaves like my other windows.

#### Keyboard

D15. As a user, I want Space to play and pause, Ctrl+←/→ to skip, Ctrl+L to star, Ctrl+F to search, Enter to play the focused row, ↑/↓ to move between rows, a letter to jump to it, Alt+←/→ to go back and forward, F5 to rescan, Esc to close, Ctrl+Q to quit and Ctrl+/ to list the shortcuts, so that I can use Wave without the mouse.
D16. As a user, I want Space to press a focused button instead of pausing, and ↑/↓ to change the volume only when no list has focus, so that the keys never surprise me.

#### System integration

D17. As a user, I want my keyboard's media keys and the system's media controls (Windows' media flyout, the Linux desktop's media controls) to show the song and play, pause, skip and seek it, so that I control Wave from anywhere.
D18. As a user, I want closing the window to keep Wave playing in the tray, with a one-time notice saying so and how to change it, and a setting that makes closing quit, so that music doesn't stop when I close a window.
D19. As a user, I want the tray icon to show or hide the window on click, and its menu to show the playing song with Play/Pause, Next, Previous, Show Wave, Mini Player and Quit, so that I can control playback without the window.
D20. As a Linux user without a tray, I want the desktop's media controls and launching Wave again to bring it back, so that a hidden Wave is never lost.
D21. As a user, I want launching Wave while it runs to show the running window, so that I never get two players.
D22. As a user, I want to choose in Settings whether Wave starts with the system, hidden in the tray and not playing, off by default, so that it is ready when I want it.

#### Account, links and updates

D23. As a user, I want Sign In to open my default browser on Google's sign-in and come back to Wave by itself, so that I sign in where I already trust the page.
D24. As a user, I want my plays on the computer to count in my account's history and stats on the phone, so that the stats show all my listening.
D25. As a user, I want a playlist made on the phone to show on the computer with the songs I have there, and the ones I don't as missing songs I can download, so that my playlists are the same everywhere.
D26. As a user, I want to paste a YT Music or Spotify link with Ctrl+V, or drag it onto the window, to open it as the phone opens a shared link, so that a link from a chat gets into Wave in one step.
D27. As a user, I want Wave to update itself on its channel and to refuse an update that Wave didn't sign, so that updates are safe without my attention.

## Implementation decisions

### Stack and processes

ADRs: `docs/adr/0001-desktop-stack.md`, `0003-desktop-process-model.md`, `0004-kotlin-on-a-bundled-jvm.md`.

- Electron on Windows x64 and Linux x64. One Chromium on both systems, so what the owner checks
  under WSLg is what Linux users get.
- The main process builds the app's Effect Layers: the database (better-sqlite3 with Drizzle),
  scan, sync, YT Music and settings.
- The renderer runs with context isolation, sandbox and no Node. It reaches services only
  through a typed bridge in the preload (contextBridge over IPC; Effect RPC is a candidate). The
  bridge's types are the contract between UI and services. Every UI read crosses IPC, so list
  reads return pages, never whole tables.
- The audio engine is a Rust napi-rs addon loaded in its own Electron `utilityProcess`, so a
  stall or a panic in audio never takes the window down, and playback goes on with the window
  closed. CI builds its binaries per OS on that OS, never cross-compiled.
- The Kotlin code runs in one JVM child process on a jlink-trimmed runtime bundled in the
  installer (see Kotlin on the JVM).
- Rust is added only where it earns its place. The audio engine is the first; the bridge to the
  system media controls (`souvlaki`) sits beside it.

### Shared code

ADR: `docs/adr/0002-shared-client-package.md`.

- `packages/core` is reused whole and keeps its rules: zero runtime dependencies, erasable
  TypeScript, decisions only.
- `packages/client` (`@wave/client`) holds the platform-free Effect services, the database layer
  (schema, migrations, Drizzle queries) and the view-model logic both apps use. It depends only
  on `@wave/core`, `effect` and `drizzle-orm`, never on Expo, React Native, Electron or React. A
  guard fails a PR that breaks this.
- Platform pieces (player, scanner, SQLite driver, settings store, connectivity, files) are
  Effect Layers each app provides.
- Code moves out of `apps/mobile` area by area, pulled by the desktop ticket that needs it, each
  in its own PR that also points the phone at the package. The phone's tests stay green and its
  releases go on as usual. No re-export shims are left behind.
- The desktop UI is new React DOM, styled with Tailwind 4. No `.tsx` is shared with the phone.
  The colour tokens live in `packages/theme/colours.css`, imported by each app's stylesheet;
  Core's `theme.ts` mirror and its drift test stay.
- `apps/desktop` holds the Electron app (`src/main`, `src/preload`, `src/renderer`) and a Cargo
  workspace in `apps/desktop/native/`.

### Kotlin on the JVM

ADR: `docs/adr/0004-kotlin-on-a-bundled-jvm.md`.

- The phone's Kotlin for YT Music (innertubex), Soulseek, downloads and tags (jaudiotagger)
  moves from the Expo module to `packages/kotlin-shared`, a plain Kotlin/JVM Gradle module the
  Android module consumes and the desktop ships as a JAR. A fix there reaches both apps.
- The scanner reads tags through the same Kotlin, so both devices read the same fields from the
  same file and recording keys match. The JVM is therefore required even with YT Music off.
- Both apps use innertubex 0.11.9 or later. On the JVM it needs no QuickJS natives, so one JAR
  serves every OS, and its first web lookup takes 0.5 s instead of 5 to 7 s.
- Per platform, outside the shared module: `YtClient`'s HTTP, the proof-of-origin token
  provider, the YouTube sign-in (Sign-in), where the session is kept (Security), the player's
  stream source and cache.
- Protocol: a child process speaking JSON lines over stdio, with requests both ways (the JVM
  asks the host for tokens) and the phone's error codes in `error.code`. The main process
  supervises it and restarts it after a crash. Audio bytes never cross the pipe.
- Measured in the experiment (2026-11-18, Windows and WSLg): about 17 MB more to download
  (about 89 MB on disk); about 60 MB of memory at rest and 105 MB after a search with a 128 MB
  heap cap; ready 190 to 290 ms after spawn, first search done in 1.2 to 1.3 s. The JVM starts
  with the app, so the start is hidden.
- Proof-of-origin tokens are minted in a hidden Electron window running the phone's
  `wave_po_token.html`, as the phone does in a web view.

### Audio engine

- An own engine on Symphonia (decoding) and cpal (output) applies the phone's playback rules one
  to one: gapless, crossfade on a second voice, the per-song gain Core computes for Normalize
  Volume, Buffer, and the counted-play events Core expects.
- Buffer: the engine fetches a YT Music song whole into its audio cache, so on the desktop the
  setting says how many songs ahead are fetched, not how much audio is held. Core's
  `songsWithinBuffer` names the songs after the current one until they play for as long as the
  Buffer (library files count for their time; a song of unknown length ends the reach), and the
  audio process fetches the streamed ones one at a time, in order. A queue or Buffer change
  sends a new list. Songs a change leaves out stay in the cache until it needs the room.
- Formats: MP3, AAC/M4A, FLAC, Vorbis, Opus (libopus through an adapter) and WAV. ALAC and
  HE-AAC are not in v1.
- Gapless AAC in M4A: Symphonia ignores the encoder delay and padding, so the engine reads them
  from the `elst` box or the `iTunSMPB` tag and trims the decoded PCM. The experiment
  (2026-11-18) played a 4-song AAC album sample-exact with this, on Windows (WASAPI) and under
  WSLg (PulseAudio); untrimmed it had 162 ms of gaps.
- The PCM carries its song's identity up to the gain stage, so a per-song gain switches on the
  first frame of the song. Measured: no mismatching sample across 619,534 frames.
- Loudness measurement for Normalize Volume runs in the engine, which already decodes.
- Output device: the system default, following changes, unless Settings › Playback › Output
  picks another (#1230). The list is the system's outputs, System default first, read again
  every second. Picking one moves the stream to it and the song goes on from where it is. While
  the picked device is away the engine plays on the system default and returns to the device
  when the system lists it again; the same holds for a device that won't open. The choice is
  this computer's: its id and name are in `desktop_settings` (`outputDevice`), never synced.
- Streaming: the Kotlin resolver returns the stream address and its headers. The engine fetches
  the bytes by range, writes them to the bounded audio cache (1 GB, as on the phone) and asks the
  main process to resolve again on a 403 or 410.

### The Library on a computer

- Scan roots: the system Music folder by default (Windows' Music known folder, Linux's
  `XDG_MUSIC_DIR`), plus folders the user adds with the native picker, at first run or in
  Settings. Excluded folders work as on the phone.
- Changes: an incremental scan when Wave opens, as on the phone, plus watching the roots while
  Wave runs; changes are reconciled after a few quiet seconds. Refresh (F5) forces a scan. On
  Linux each folder costs one inotify watch.
- A scan root that is missing as a whole is an unavailable folder: its songs stay, shown greyed,
  and playing one says the drive isn't connected. Only files missing while their root is present
  leave the Library.
- Paths are stored with `/` on every OS, so Core's path handling stays as is. On Windows, track
  identity compares paths case-insensitively, and the native path is built only to open a file.
- Moved and renamed files keep their plays and stars through Core's scan reconciliation,
  unchanged (story 11). The voice-note filter applies, on by default.
- First run asks for no permission.

### Wave account and sync

- The desktop is one more device with its own device id. A synced entry is the local Track with
  the same recording key, as between phones.
- An account song with no file here is a missing song, as on the phone: dimmed, a click
  downloads it through Core's `downloadSource`, with Download All and Download Missing Songs on
  album, artist, genre and playlist pages, with how many are missing (an album's in album order
  and under the album, a playlist's in playlist order and under the playlist).
- A star means downloaded, as on the phone (`docs/spec.md`, A star means downloaded): a missing
  song with a star downloads on its own under Favorites, when it is starred here, after a sync
  that brought stars or songs, and as Wave starts. Unstarring it before the file arrives cancels
  the download only the star asked for. What the stars asked is kept on this computer
  (`downloads.syncedStars`, `downloads.starAsked`), never synced.
- The Downloads page is the phone's (`docs/spec.md`, Downloads): the line counting the songs
  downloading and waiting, the run's panel with the paused line while YouTube limits downloads,
  the waiting songs under their source's header, and the failed section folded until shown,
  grouped by reason. It is one virtual list. A group's header drags among the groups and a
  waiting song among its group's songs, with the mouse or with Move Up and Move Down on the row,
  and the queue downloads in the order shown.
- Play and Shuffle on a list with missing songs play what can play (Core's `listPlay`): the
  songs with a file and, with YT Music on, the missing songs downloaded from a YouTube Music
  video, streamed in their place. A toast counts the ones left out and offers Download Missing
  Songs; when nothing can play, it says so and offers the same.
- Plays on the computer count in the account's history and stats with a new play `source` value,
  `desktop`. A phone release and a sync Worker that accept `desktop` go out first; the desktop
  sends plays only after that. Older phones that drop an unknown source must already accept it.
- Settings: the desktop uses the account-wide synced settings (language, YT Music, explicit,
  Normalize Volume, crossfade and the like) and neither shows nor writes the phone-UI ones (tab
  bar, swipe actions, long-press delay, glass, Now Playing slots). Desktop-only settings stay in
  the desktop's database and don't sync in v1.
- The desktop pulls on opening, on focus after five minutes away, and every 15 minutes while
  running. It trusts the system clock as the phone does, and conflicts follow Core's rules.
- Collaborative playlists (`docs/spec.md`, Collaborative playlists): the desktop shows and plays
  them and never edits them, for the owner and for the other members. In the sidebar one has a
  people glyph, and its row and page say "Collaborative" before the song count. Its menu has a
  line saying it is edited in Wave on the phone, its image entries and sharing. Rename, the
  Graveyard, Delete, Move Up and Move Down are left out. Add to Playlist doesn't list it, and a
  playlist's page doesn't offer Remove from Playlist. An M3U or link import with its name makes
  a playlist of its own. Main refuses every change to its name, entries or order, whatever the
  window asks (`src/main/library/collaborativePlaylists.ts`). Its image stays this computer's
  own, as for any playlist. The sync cycle reads the account's collaborations on every pull. A
  member's desktop then pulls each playlist with its own cursor, in the same cycle, and pushes
  nothing of it (`pushCollaborative: false`), so it shows the playlist after a sync and follows
  later changes.

### Sign-in

- Wave account: Sign In opens the default browser on Google's sign-in with a Desktop OAuth
  client, returning to a loopback address (`127.0.0.1`, random port) with PKCE. Google blocks
  sign-in inside an embedded window, so none is used. The app exchanges the code for an ID token
  and sends it to `POST /v1/session`.
- The sync Worker accepts the Desktop client id beside the phone's. That Worker change is
  deployed by hand before the desktop release that needs it.
- Sign out and Sign Out on All Devices use the Worker's existing routes.
- Delete Account shows only when signed in and asks first, with the phone's confirmation in the
  computer's words. The Worker's `DELETE /v1/account` wants a fresh Google sign-in to the
  account's own Google account, so the browser opens once more; Cancel stops that wait. Then the
  service deletes the account and the desktop signs out, keeping its songs, files and plays. A
  different Google account, no network or a service error says so and leaves the account
  signed in.
- YouTube sign-in is separate, and runs in the installed browser in two steps, not in a window
  of Wave's. Google refused the sign-in both in an embedded Electron window and in a browser
  started with a debugging port (checked with a real account on 2026-11-18, #1141), so neither
  is used.
  1. Sign In starts the installed Chromium-family browser as an ordinary window on Google's
     sign-in, on a profile folder Wave makes for this one sign-in, with no debugging flag. It
     uses the user's default browser when that is Chromium-family (on Linux, from `xdg-settings`),
     so the sign-in page opens where they already trust it, and otherwise the first installed of
     Chrome, Edge, Brave or Chromium, in that order. Settings tells the user to close that window
     when they're done, and offers Cancel.
  2. Once that browser has exited, Wave starts it again on the same profile, headless and with a
     debugging port, and the main process reads the session cookies and YouTube's page
     configuration from it. Then it closes the browser and deletes the profile folder, however
     the sign-in ended; a folder a crash left behind is deleted at the next start.
- On Linux, Sign In first tries the default browser's own session, so someone already signed in
  to Google there signs in to Wave with no window and no second step. The main process reads that
  browser's cookie store (a read-only copy, since the live one is write-locked) and unseals its
  `v11` cookies with the browser's "Safe Storage" key, which it reads from the Secret Service
  directly over D-Bus (no `secret-tool` needed; gnome-keyring and KWallet both serve it); a
  signed-in `music.youtube.com` session among them is used as is. This reuse has no page
  configuration, so the account and channel stay at their defaults (`sessionIndex` 0, no
  `dataSyncId`), which a later full sign-in replaces. Anything missing — no Chromium-family
  default browser, no keyring, a locked or absent store, or no session in it — just falls through
  to the two steps above, so the fast path never narrows what already works. Other platforms seal
  the store so another app cannot open it (Windows ties the key to the browser binary), and there
  Sign In always opens the window.
- A window closed without signing in leaves the account as it was. The page's channel id can be
  slow to appear; Wave waits for it and signs in without it when it never comes, as the phone
  does.
- With no Chromium-family browser installed, Sign In opens nothing and Settings › Accounts says
  which browsers work. Windows always has Edge; a Linux desktop may have none. A browser
  installed as a snap gets its profile folder under `~/snap`, the only place it can write.
- The shared Kotlin `YtClient` accepts the session, and the account's YT Music playlists show
  under it in Settings › Accounts; one opens the same import card as its pasted link.

### Window and layout

The prototype was approved on 2026-11-18 after an Impeccable critique; its decisions are these.

- Player bar at the bottom, full width. Left: artwork, title, artists and album (artwork and
  title open Now Playing), the star. Centre: shuffle, previous, play/pause, next, repeat, and the
  wavy scrubber with elapsed and remaining time. Right: sleep timer, Lyrics, Queue, the song
  menu, mute and volume.
- Sidebar: Search field (Ctrl+F) and Home; Library (Playlists, Artists, Albums, Songs, Genres,
  Favorites); YT Music (Discover, Magic Queue, Downloads, whose count shows the download
  percentage); the user's playlists with New Playlist; Settings pinned at the bottom. Back and
  forward arrows sit in the title bar. Every entry has its own icon. The sidebar scrolls as one
  when the window is short, keeping the Search field and Settings in view.
- The Playlists page counts its playlists and has the phone's Sort by (Name, Recently Added,
  Recently Played, Custom) and a switch between its table and a grid of covers. In Custom a row
  or a cover drags into another's place, and a playlist's menu has Move Up and Move Down. The
  sidebar lists playlists in the same order. As on the phone, the sort, the arranged order and
  the layout stay on the computer (Core's `PLAYLIST_ORDER_SETTING`, `PLAYLIST_LAYOUT_SETTING`)
  and don't sync. Large Cards reads as the grid.
- Lyrics and the Queue share the side panel, toggled from the player bar and closed by the
  panel's own control on every tab. Now Playing (artwork,
  title, lyrics) opens from the bar's artwork or title and closes with Esc. Focus lands on Now
  Playing itself, so Space still plays and pauses; Tab reaches its close button.
- Share in the Lyrics view (the panel's tab and Now Playing, after Karaoke and Translate) picks
  up to five lines next to each other as the phone does (Core's `tapLyricLine`); while picking, a
  click picks instead of seeking and synced lyrics stop following the song. Cancel, Esc or a new
  song leaves picking. Next previews the phone's lyrics card, 1080 px wide; a click on it moves
  to the cover's next colour, and Save Image (the save dialog, at the phone's file name) and Copy
  Image (the PNG on the clipboard) stand in for the share sheet.
- Minimum window 960×600. Below 1120 px wide the sidebar shows icons only, a playlist as
  its first letter, and Ctrl+F opens the Search field in the title bar. When the content is
  narrower than 760 px, tables drop the Album column, the search top result stacks and hero
  artwork shrinks to 168 px.
- Title bar: on Windows Wave draws its own with Electron's `titleBarOverlay`, which keeps the
  native window buttons and Snap Layouts. On Linux the system frame stays and Wave's bar sits
  under it.
- Scrollbars are Wave's own everywhere: an 8 px rounded thumb with no track and no arrow buttons.
- Theme: the phone's tokens, light and dark following the system or the Appearance setting. The
  accent follows the synced theme, so the default theme gives a white accent in dark and the ink
  colour in light, as on the phone. Settings › Appearance edits that theme as the phone does: a
  background for each mode, Primary and Secondary from Default, the saved colours or a custom
  one, and Reset to defaults. Each row of swatches is one tab stop the arrows move through; a
  saved colour has a Remove button where the phone has a long press. The app icon isn't offered.
- Tables: 40 px rows. Songs show title (with a thumbnail with 4 px corners), artist, album, the
  star and time; album pages show the track number instead of the thumbnail; on an artist's page
  the artist column shows only featured artists. A selected row has its own tint, separate from
  the keyboard focus ring. Songs keeps the A–Z spine.
- Songs and Favorites have the song count under their title, then Play and Shuffle in the accent
  as on a hero; both play the list in the order its table shows (#1220).
- Each list page (Songs, Albums, Artists, Genres, Favorites, Playlists, a playlist, an artist, a
  genre) has a Find field under its heading, the phone's pull-down Find: typing narrows the table
  with Core's matching (case and accents ignored, words matched from their start). Main filters
  in the page's query (`wave_finds`), so the table still reads pages; a playlist keeps each
  song's place in its "#". The count, Play, Shuffle and Select All go by the rows found, and a
  Find with none says so ("No songs match"). Esc clears it and gives the focus back to the list.
  It has no shortcut: Ctrl+F stays the Library Search (#1213).
- Artwork has 6 px corners on tiles and heroes, 4 px on row thumbnails, circles for artists.
- The song menu holds Play Next, Add to Queue, Add to Playlist, Favorite, Go to Album, Go to
  Artist, Start Magic Queue, Share, Select, Fix Song and Remove from Library.
- Release Date, on a Library song and on a streamed song (#1223), opens a small dialog with the
  date Wave has (or a line saying none is known) and the phone's Year, Month and Day fields, read
  by Core's `readTypedReleaseDate`. It keeps the date as the phone does: in the synced
  `releaseDates.typed.*` preferences, and for a Library song in the index (not in its file), so it
  reaches the phone and a playlist's Release date sort places the song by it.
- Show in Folder (#1224) is on the menu of one Library song with a file here, never a missing or
  streamed one. The window asks with the song's id (`songs.showInFolder`), never a path: main
  reads the file from the index and opens the system's file manager with it selected
  (`shell.showItemInFolder`), on Windows and Linux. A song in a folder whose drive isn't connected
  says so, and one whose file has gone asks for a Refresh.
- Share, on a Library song and on a streamed song (#1209), is a submenu in place of the phone's
  share sheet: Copy Link (song.link), Copy Spotify Link (Spotify's own search as #1201's
  account), Copy YT Music Link, then Save Image (the system's save dialog) and Copy Image, which
  draw the phone's song card 1080 px wide. A link that can't work is disabled and says why under
  its label (No Match, Signed Out, Offline, Unavailable); offline every link reads Offline. With
  YT Music off the submenu holds the two image items only.
- Selection takes albums, artists, genres and playlists too (#1216): Select, Ctrl+click and
  Shift+click check their rows in the tables and their tiles in Search, where they check together
  with the songs. One collection checked alone keeps its menu's entries. Several, or collections
  with songs, get one bar whose actions run on every song the checked items hold, a song two of
  them hold once: Play Next, Add to Queue and Add to Playlist always; Download while one of those
  songs has no file; Fix Songs when the checked items are one kind of collection. Favorite and
  the other song entries show only while songs alone are checked (Core's
  `desktopSelectionActions`, the phone's mixed selection rules).
- A song row drags onto a playlist in the sidebar, wide or collapsed to icons, to add it there;
  onto an Up Next row, the playing row or the end of the Queue tab, to go in Up Next at that
  place (#1217); or onto the player bar's Queue button, for Add to Queue. A checked row brings
  every checked song, and on Search the collections checked with them, in the order shown.
  Streamed songs drag the same way. A target is highlighted only while it can take the drop,
  dragging over the Queue tab opens it, and the toasts are the menu entries' own. Add to
  Playlist and Add to Queue stay in the menus for the keyboard.
- On a playlist's page in its own order (#1218), a row drags to a new place, with a line where it
  will land; a checked row brings every checked song, together and in the playlist's order. The
  list scrolls while a drag is held near its top or bottom. Alt+Up and Alt+Down move the focused
  row, as in the Queue tab, and Move Up and Move Down stay in its menu. The order is the
  playlist's synced one, so it reaches the phone. A sorted page moves nothing.
- Home shows the phone's sections in the phone's order, following the account's synced
  arrangement: shelves of tiles, Most played as a table. Edit Home, on Home and under Settings ›
  Home, is the phone's editor: the sections shown, Discover's rows under Discover, then the ones
  not on Home. A row is dragged to its place or moved with Move Up and Move Down, removed, or
  added back at the bottom. Each change is kept and synced as it is made. A section or row the
  stored arrangement names that this Wave doesn't have stays in it, in its place.
- Home's New from Artists You Follow and Upcoming Shows use the phone's rules and the account's
  follows, hidden releases and switches. Each computer runs its own checks, looks shows up in the
  country chosen in Settings › Followed artists (the system's region until one is chosen) and
  posts no show notification. A release opens its Library album or its YT Music page; a show
  opens its ticket page in the browser. Hiding a release stays on the phone.
- A Library artist's page and a YT Music artist's page have a Follow button in the hero's
  actions. It reads Follow or Following and opens a card with the levels (Core's
  `followLevelEntries`): New music, New music and shows while a Wave account is signed in, and
  Unfollow once followed. Settings › Followed artists has the account's switch, the Country for
  shows (kept on this computer, as each phone keeps its own), Find artists to follow, and the
  artists followed A to Z, each with its level in a menu and Unfollow. Unfollow shows the toast
  "Unfollowed <artist>" with Undo. The search lists the Library's matches and Deezer's, and
  its one line is Core's `followSearchLine`: searching, no answer from Deezer, or no artists
  found. With the switch off no artist page has the button, the search is disabled and the
  follows are listed but can't change. Follows sync with the Wave account as any change does.
  The phone's level icons, their legend and Suggested aren't on the desktop.
- Album, artist and playlist pages have a hero: artwork, a light title, and the kind in the line
  under it ("Album · Indie Folk · 1995 · 7 songs · 33 min", or "36 h 43 min" from an hour up, Core's `listDuration`; a table's Time
  column reads "36:43:09"), with no label above the title. Play
  and Shuffle are text buttons in the accent, without a filled box.
- A playlist's page ends with Recommended songs while YT Music is on (#1193), by the phone's
  rules (docs/spec.md, Playlist recommendations): five offers with Add and Dismiss, Refresh in
  the heading, saved offers shown at once on a return, and the failure line with Try Again. The
  page then scrolls as one, the table first, and Go to Suggestions shows while the section's
  heading is below what it shows. Main holds the visit (`main/yt/playlistSuggestions.ts`, the
  phone's shared visit in `@wave/client/playlistSuggestionsVisit`), keeps its saved offers and
  seed draws in the device settings and reads each seed's radio as the Magic Queue does. The
  artist graph and genre lookups aren't on the desktop, and an offer isn't played from the
  section.
- Search: a top result (artwork and name, no card), a Songs table, then Albums, Artists and
  Playlists shelves, then YouTube Music results. An empty field lists recent searches.
- Settings is a page with its own side list: Library, Appearance, Window, Playback, Lyrics and
  tags, Downloads, Accounts, Version History.
- Offline, the YT Music parts of Home, Search, artist pages, Discover and Magic Queue become one
  quiet line saying they come back online, and downloads pause. A missing song is dimmed, with
  no × (a download on its way shows its progress on the row); the × marks only a file that failed
  to play.
- A YT Music album page has Play, Shuffle and Download, and a YT Music artist page Play and
  Shuffle, as on the phone. Download follows Core's album rule (Download, Cancel, Retry Failed,
  Downloaded) and the head counts the songs saved while they're on their way; the songs land
  as one album, tagged from its page. A page YT Music didn't answer has Try Again on its quiet
  line. On an artist page's Albums and Singles & EPs, a release the Library has opens the
  Library's album page.
- A Library album with more than one disc heads each disc's songs "Disc n", its track numbers
  starting again on each (#1221). With YT Music on, its hero has the phone's Library | Online
  toggle; Online asks for the album artist and the release only when picked, then lists the whole
  tracklist in the release's order, the songs the Library lacks streamed among its own (each
  Library song once, as the Library's), with the release's Download in place of Download Missing
  Songs. Play plays that list. Offline or after a failure Online is the quiet line, and picking it
  again asks again.
- No chips, no filled Play button, no card around the top result (Quiet Catalog, as on the
  phone).

### Keyboard

- Space play/pause, Ctrl+→/← next/previous, Ctrl+L favorite, Ctrl+F search, Enter plays the
  focused row, ↑/↓ move between rows, A–Z jump, Alt+←/→ back and forward, Ctrl+V opens a pasted
  link, F5 rescans, Esc closes Now Playing, menus and selection, Ctrl+Q quits, Ctrl+/ lists the
  shortcuts. The list can't be edited.
- Space plays or pauses unless focus is on a button, link, switch or field. ↑/↓ move between rows
  when a list has focus and change the volume elsewhere.
- Each list (table, queue, lyrics) is one tab stop with roving focus; Home, End, Page Up and Page
  Down work in it. The scrubber is a slider: ←/→ and ↓/↑ seek 5 seconds back and forward, Home
  and End go to the start and the end.
- Every icon button has an accessible name.

### System integration

- Close hides the window; Wave stays in the tray, playing or not. The first close shows "Wave is
  still running in the tray" once, and on Linux says to reopen Wave from the app menu or the
  tray. Quit is the tray menu's Quit or Ctrl+Q. Settings offers "Closing the window quits Wave".
- Starting with the system is off by default; the switch starts Wave hidden in the tray, not
  playing.
- The window shows once its page and Wave's services are ready, and after 5 seconds without
  them; it never waits for the JVM. When the services fail to start, Wave says "Wave couldn't
  start" and quits, so no hidden process is left holding the single instance.
- Single instance: a second launch shows the running window. A YT Music or Spotify link passed
  to the second launch is not handled; links arrive by paste or drag.
- The system media controls (SMTC on Windows, MPRIS on Linux) show title, artist, album, cover
  and position with seeking, with Play/Pause, Next and Previous. Media keys reach Wave through
  them, with no global shortcut. On Linux the bridge is the Rust `souvlaki` crate, in its own
  addon (`wave-media.node`). On Windows it is Chromium's Media Session with a silent audio
  element: the check in #1157 found `souvlaki` publishing the song there while the system's Pause
  never reached Wave. Linux falls back to Chromium's session when the addon doesn't load.
- Opening files (#1233). Wave is an "Open with" choice for the audio formats the engine plays
  (`.mp3`, `.m4a`, `.flac`, `.ogg`, `.oga`, `.opus`, `.wav`; not `.mp4`, which is a video more
  often than a song). It never takes a type's default from another player: the Windows installer
  adds Wave to each extension's `OpenWithProgids` and to `Applications\Wave.exe\SupportedTypes`
  under the user's own registry keys and leaves the extension's default alone, and uninstalling
  removes what it added; the AppImage's desktop entry lists the same formats as `MimeType`
  (`apps/desktop/scripts/file-types.ts`). The files a launch names play in order as a new queue,
  with "New queue playing" and Undo when a queue was there. A launch while Wave runs hands its
  files to the running window. The system starts Wave once per file when several are opened
  together, so files that arrive within half a second of each other play as one queue, and files
  that arrive while Wave starts wait for its services. A file the Library has plays as its
  Library song, so its play is counted. Any other file plays as itself (the queue id
  `file:<path>`, Core's `openedFiles.ts`): it joins nothing, its play isn't kept or synced, it
  shows by its tags' title and artist (its name until they're read), without a cover, and the
  star and the song menus are off for it. A path that isn't one of those formats, or isn't
  there, is ignored. A file left in the queue plays again after a restart while it still exists.
- No `https` link handler and no floating mini player in v1. Windows lets an app own `https`
  links only for a domain it proves it owns.

- No file associations and no `https` link handler in v1. Windows lets an app own `https` links
  only for a domain it proves it owns.
- The mini player (#1232) is a small frameless window that stays above other windows: artwork,
  title and artists, Previous, Play or Pause, Next, the star and a thin progress line. The player
  bar's Mini Player button and the tray menu's Mini Player entry open it, or show the one already
  open. Show Wave on it brings the main window back and leaves it open; Close Mini Player closes
  it, and Wave keeps running. The main window can be hidden while it is open. It drags from
  anywhere but its buttons. Space, the other player keys and Ctrl+Q work in it, and the media keys
  reach Wave as they do with the main window hidden. Its position is a device-local setting
  (`miniPlayer.position`), saved when it is moved and when it closes. It opens where it was left
  while the screens show all of it, else moved whole onto the screen showing most of it, or onto
  the primary screen when its own is gone, also when a monitor goes while it is open; never
  placed, it opens in the primary screen's bottom right corner (Core's `floatingWindowPosition`).
  It is a second page of the same renderer (`mini.html`) on the same preload, web preferences
  (`windowWebPreferences`), navigation guard and CSP as the main window, and main answers bridge
  calls from those two pages only. It adds `miniPlayer.open`, `close` and `showMain`, which take
  no arguments.

### Local data

- The database and settings: `%APPDATA%\Wave` on Windows, `~/.config/Wave` on Linux. Artwork and
  the audio cache: `%LOCALAPPDATA%\Wave` and `~/.cache/wave`, where the system and cleanup tools
  know they are caches.
- The desktop uses the phone's schema and migrations through `packages/client`, on better-sqlite3.
  Settings live in the database, not a separate key-value file.

### Language

- UI text comes from Core's catalogue in English and Brazilian Portuguese, as on the phone, and
  the untranslated-text check covers the desktop.
- The phone's text stays as it is. A string that names the phone ("This phone", "the phone isn't
  on Wi-Fi") gets a desktop variant ("This computer") in both languages, and strings about Wi-Fi
  and mobile data don't show on the desktop. New strings follow the glossary in `docs/spec.md` ›
  Language.
- Settings › Appearance has Language: System, English or Português (Brasil), each language under
  its own name (#1186). It is the account-wide synced setting `settings.language` (`en`,
  `pt-BR` or `system`, kept as a value so it replaces an earlier choice); signed out it stays on
  this computer. System follows the computer's preferred languages by Core's
  `resolveAppLanguage` (`--lang` overrides them for checks). Main decides the language once
  (Core's `chosenAppLanguage`) and the window asks it, so the window, the tray menu, native
  dialogs and the close-to-tray notice always agree, and a change or a pulled value applies
  without a restart. The phone doesn't read the setting yet; it follows Android's language.
- The Library stores "Unknown Album" and "Unknown Artist" for a missing tag; every list, the bar,
  Now Playing, the tray and the system media controls show them in the current language (Core's
  `displayTag`), and Library identity keeps the stored value.

### Build, release and updates

- Installers: an NSIS installer for Windows x64 (MSI can't carry a version like `0.68.0-ti`) and
  an AppImage for Linux x64, the only Linux format that updates itself without root.
- The desktop takes the Android version from the "Release Wave" commit, but builds its installers
  only when what it is built from changed since its previous release (`desktop.yml`, called by
  `ci.yml`; `docs/spec.md` › Build and CI, Phone and desktop builds). A push that changes only the
  desktop still gets a version and publishes only the installers; one that changes only the phone
  builds none. The desktop's release gate waits only for the shared jobs and the Desktop jobs, so
  the two apps never hold each other back. A desktop `feat/` PR makes the bump minor. Promote to
  main publishes the desktop too once v1 is complete (`app=both` or `app=desktop`), from its
  newest release at or below the promoted version.
  `apps/updates` serves the desktop's updates per channel.
- Updates are whole-app in v1 (the NSIS blockmap downloads only what changed); no JS-only
  bundles. electron-updater only downloads.
- Update signing: the release job signs the update manifest and files with Wave's updates key
  (Ed25519, in the release Environments), and the app checks them against the public key built
  into it before installing, on Windows and Linux alike, as the phone does. The channel is fixed
  in the build; Wave's code never sets the update endpoint or channel at run time.
- Roll back an update (`app=desktop`) republishes the previous version for the channel with
  downgrade allowed, and leaves the phone's update alone.
- Windows code signing: SignPath Foundation, free for OSI-licensed projects, once the GPL-3.0-only
  licence is in the repo (#1122). The key stays in SignPath's HSM and the release job asks for
  the signature. Until then `ti` builds are unsigned and Windows warns on each new version.
- PR runs typecheck, test and lint the desktop, run `cargo test`, and compile the Rust addon on
  both OS. They build no installer and hold no secret, as for the phone.
- Linux builds run on `ubuntu-22.04` so the AppImage runs on older distributions.

### Security

The threat model in `docs/spec.md` › Security applies. The desktop adds:

- The renderer is sandboxed with context isolation, no Node and a strict CSP. It can't navigate
  away from the app; external links open in the system browser. The bridge exposes only typed
  calls, never a generic IPC send.
- The Wave session and the YouTube session cookies are encrypted with Electron's `safeStorage`
  (DPAPI on Windows, the Secret Service on Linux) and stay in the main process, never in the
  renderer. With no Secret Service, Wave writes neither: they live in memory until Wave quits,
  and Settings › Accounts says a keyring is missing. Never plain text. The JVM uses the YouTube
  session but writes it nowhere: main hands it over each time that process starts and takes each
  change back.
- An update installs only with Wave's Ed25519 signature (Build, release and updates).
- The window gets audio capture only for Recognize, and main decides: its permission handlers
  allow the microphone (or Linux's monitor input) and a display capture's loopback audio only to
  the main window, only while a Recognize session is capturing that source, and never the camera
  or a screen's picture. The window drops the picture of the display capture at once.
- Out of scope: another program running as the same user. DPAPI doesn't protect against it.
- No installer holds a credential. A provider key a feature needs stays a secret of the sync
  Worker, as for the phone.

### Performance rules

The phone's rules in `docs/spec.md` › Performance rules apply where they are about the app's
logic (unseen is idle, narrow subscriptions, pure rows, write only what changed, bounded heavy
work, image sizes, bounded caches, virtualised lists, numbers not adjectives). The desktop adds:

- List reads cross the bridge as pages; nothing sends a whole table over IPC.
- Every table is virtualised.
- Measured targets, in a test that runs on CI's Windows and Linux runners: the window is ready in
  under 2 s from launch, ready meaning Home drawn with its sections and song count from a
  50,000-song library; scrolling the Songs table over 50,000 songs keeps up with the display;
  memory at rest (all processes) is recorded each release. No hard memory limit in v1.

## Testing decisions

- Core: as in `docs/spec.md`, with `node:test` through its public API. Most rules stay tested
  there.
- `packages/client`: its services and queries are tested in Node against a real SQLite database,
  seeded with fixtures. The phone's database tests move with the code.
- The audio engine: `cargo test`, including golden tests that compare the PCM the engine outputs
  with the expected samples (gapless boundaries, trims, the gain switch), as the AAC experiment
  did.
- `packages/kotlin-shared`: the phone's Kotlin JVM unit tests move with the code and run once for
  both apps.
- End to end: a small Playwright set drives the real app (launch, scan a fixture folder, play,
  pause and skip, search, sign in against a stub) on Windows and Linux.
- No React component tests. UI behaviour is checked by the end-to-end set and by agent checks.

## Agent checks

Agents check a desktop ticket without the owner by driving the built app with Playwright's
Electron support: launch it, click, read the page and take screenshots, on Windows and on Linux
under WSLg. `docs/agents/desktop-checks.md` documents how, as `docs/agents/emulator-checks.md`
does for the phone. Audio is checked by the engine's golden tests, not by ear.

## Out of scope

- macOS, iOS and a web version.
- In v1: Spotify (account and imports), Recognize, Karaoke, Recap, Stats and Listening History
  screens, Genius, the lyrics image, BlackPlayer import, the Bring your music card, configurable
  Now Playing slots and the animation-duration setting.
- ALAC and HE-AAC playback, and picking an output device, in v1.
- Android Auto equivalents, and owning `https` links of YouTube Music or Spotify.
- Handing playback from one device to another.
- New sync features beyond the `desktop` play source and the Desktop OAuth client.

## Further notes

### After v1

These come after v1, in an order decided when v1 is close to done: Spotify, Recap, Stats and
Listening History, Genius, Recognize, Karaoke, the lyrics image, Shift/Ctrl multi-select in
tables, sortable table columns, drag and drop onto sidebar playlists and the queue, Show in
Folder, a floating mini player, picking an output device.

### Risks

- Google refused YouTube's sign-in in an embedded Electron window and in a browser started with
  a debugging port (#1141), so it runs in the installed browser (Sign-in). Google can change
  what it accepts again; the sign-in then fails with a message and nothing else depends on it.
  A computer with no Chromium-family browser can't sign in to YouTube; the rest of YT Music
  works signed out.
- YouTube changes break the resolver now and then; the shared Kotlin module means one fix for
  both apps.
- The repo has no licence yet. GPL-3.0-only is the owner's direction (#1122); innertubex is GPL-3.0
  and SignPath's free signing needs an OSI licence.
- Until SignPath signs the installer, Windows warns on each new `ti` version.
