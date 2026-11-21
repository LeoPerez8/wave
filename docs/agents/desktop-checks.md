# Checking desktop tickets without the owner

Drive the built app with Playwright's Electron support (`apps/desktop/e2e`): launch it, click,
read the page and take screenshots, on Windows and on Linux under WSLg. Label every result with
the system and the commit. Audio is checked by the engine's tests, not by ear.

## Commands

From the repo root:

```sh
pnpm --filter @wave/desktop typecheck
pnpm --filter @wave/desktop test       # node:test units in src/
pnpm --filter @wave/desktop lint
pnpm --filter @wave/desktop test:e2e   # builds out/, then runs the Playwright smoke test
pnpm --filter @wave/desktop test:perf  # isolated launch, scroll and whole-app memory check
pnpm --filter @wave/desktop dev        # the app with hot reload
```

`test:e2e` builds first, so it always drives the current code. Screenshots and failure traces go
to `apps/desktop/test-results/`, which git ignores; read the PNGs to check what the window
shows. Add a check as a test in `apps/desktop/e2e/` rather than a throwaway script, so CI runs
it too.

The performance check runs separately from `test:e2e`. Its limits, fixture, memory accounting
and CI artifact names are in [Desktop performance in CI](../performance/1166-desktop.md).

## The audio engine

The engine is Rust in `apps/desktop/native` (Symphonia decodes, cpal plays), loaded as a Node
addon by the audio utility process (`src/main/audio/process.ts`). It needs Rust (stable), CMake
(libopus builds from source) and, on Linux, ALSA's headers (`libasound2-dev`).

```sh
cargo test --manifest-path apps/desktop/native/Cargo.toml   # decoding and seeking golden tests
pnpm --filter @wave/desktop build:native                     # builds native/wave-audio.node
```

Build the addon before `test:e2e`: without it the app runs, but every player call fails with
`[unavailable]`. `WAVE_AUDIO_ADDON` points main at another build. `e2e/audio.spec.ts` plays each
fixture in `native/engine/tests/fixtures`; its `device` annotation (`--reporter=json`) names the
output that played it, or `none` when the engine kept time without one, as on CI.

### Output device

`settings.outputs()` answers `{outputs, chosen}`: the system's outputs as the engine last listed
them and the one picked (`connected` false while it is away). `settings.setOutput(id | null)`
takes an id from that list, or null for System default. The engine decides where to play
(`target_device` in `native/engine/src/output.rs`); the audio process pushes the list as an
`outputs` event and takes the choice as the `setOutput` call, which a restarted process gets
again. `e2e/outputDevice.spec.ts` picks one of the machine's real outputs with a paused song and
checks the position and a restart; its `outputs` annotation is 0 on a machine without one, where
it stops after the list. Its screenshot is `output-device-<platform>.png`. Unplugging is checked
against a fake in `src/main/bridge.test.ts`, and on real hardware by the owner.

## The JVM

The shared Kotlin (`packages/kotlin-shared`) runs in a JVM main starts with the app
(`src/main/kotlin/`), over JSON lines on stdio. `build:jvm` needs `JAVA_HOME` set to a JDK 21 for
the system you check on (CI uses Temurin 21).

```sh
pnpm --filter @wave/desktop build:jvm   # jvm/wave-kotlin.jar and jvm/runtime (jlink)
```

Build it before `test:e2e`: without it main keeps restarting a JVM that can't start, and every
Kotlin call fails with `[ERR_UNEXPECTED]`. `WAVE_JVM_RUNTIME` and `WAVE_KOTLIN_JAR` point main at
other builds. `e2e/kotlin.spec.ts` reads the tag fixtures the phone's tests read, kills the JVM
mid-call, and records its resident memory at rest as the `jvm-resident-mb` annotation.

`e2e/ytmusic.spec.ts` checks YT Music against the live YouTube Music: the setting, the sidebar's
entries, Search's results, and (off CI) a song that plays, seeks and moves on. Its `yt-search`
annotation gives the number of songs, or the quiet line when YouTube asked for a bot check.
Streamed audio is cached under `audio/` in the cache folder (`WAVE_DATA_DIR` in tests).

## Data

`WAVE_DATA_DIR` points the app at a folder of its own instead of the user's data folder; the
Library is `wave.db` in it. Seed one before launching with `libraryLayer` from
`src/main/database.ts` and `addTrack` from `@wave/client/testing`, as `e2e/smoke.spec.ts` does.
Pass `--lang=en-US` (or `pt-BR`) to fix the app's language.

## Library scans

Main provides `DesktopLibrary` through `desktopLibraryLayer`, which consumes `Database` and
`Kotlin`. It starts an incremental scan immediately, using Electron's `app.getPath("music")`
for the system Music folder. `WAVE_MUSIC_DIR` overrides that first-run default for isolated
checks; an existing database keeps its chosen roots. First launch opens no permission dialog.

The service watches recursively from each root's parent on Windows and watches each directory
on Linux. It reconciles after 2 seconds without changes. Unavailable roots and failed watcher
registrations are retried every 10 seconds, followed by that quiet period. Handles are rebuilt
after a scan so a remounted directory's new inode is watched. Closing the service closes the
handles and waits for its current tag read before releasing the database.

`e2e/library.spec.ts` checks a 1,200-file first scan with the real JVM, progress, paging, live
file changes, root disappearance/recovery, F5, changes while closed and folder settings. The
folder-picker result is supplied by the test; checking the actual native dialog and physically
unplugging a drive remain owner checks. Screenshots are `library-progress.png`,
`library-scanned.png` and `library-unavailable.png` in `test-results/`.

The bridge adds `library.scanStatus`, `refresh`, `songs`, `roots`, `exclusions`, `addRoot`,
`exclude`, `removeRoot` and `include`. List calls take `(offset, limit)` and accept at most
200 rows. `addRoot` and `exclude` open the native picker; paths for removal/inclusion must
already belong to the stored settings. `player.load` and `player.play` reject unavailable
folders with `[folder-unavailable]`. `scanStatus.revision` changes after a saved batch and at
completion; views re-read their pages on that revision, while visible.

Core's `scanPath`, `scanPathKey`, `scanPathWithin` and `scanFileState` own desktop path and
availability decisions. Client's `db/desktopScan` reuses Core reconciliation and the phone's
saving, leaving-song, credit and playlist rules. `db/desktopFolders` applies the shared root
and exclusion plans with Windows identity. Canonical links inside selected roots are followed
once; targets outside those roots need their own root. Hidden files and folders are ignored,
and voice notes use Core's existing filter and Client's skipped-file index.

## Library layout checks

`e2e/layout.spec.ts` seeds 50,000 songs through SQLite and drives the real window. It checks
bounded rendered rows, scrolling (the `scroll-p95-ms` annotation), row selection and keyboard
movement, letter jumps, history, every Library page and hero, the 960×600 window, the 760 px
content breakpoint, search focus, Appearance and empty-library keyboard navigation.
Light and dark screenshots are `layout-<platform>-<scheme>-<page>.png` in `test-results/`.
Run it on Windows and WSLg and inspect the PNGs, including Settings and the heroes.

The `library.browse(scope, offset, limit)` bridge call returns `BrowsePage`: one `Page<BrowseRow>`
and an optional hero. Scopes are `songs`, `albums`, `artists`, `playlists`, `genres`, `favorites`,
`album`, `artist`, `playlist`, `genre` and `search`; detail scopes require a positive `id`, and
Search accepts `query` (up to 500 characters). Reads accept at most 200 rows. The table requests
100 at a time, retains at most seven pages, and renders the viewport plus overscan. It is one
tab stop, using `aria-activedescendant` for virtual rows. `library.letter(scope, letter)` returns
the row offset for a jump. Main registers Core's `sortKey` as SQLite's `wave_sort_key`.

`library.artwork(hash, large)` returns a cached data URL or null. It only accepts SHA-1 hashes
already in the artwork table. The shared JVM's `readTags` adds optional `artworkBase64` for covers
up to 8 MiB; the phone's metadata map stays unchanged. Desktop scans keep the original bytes,
300 px thumbnails and 640 px medium JPEGs, preserving aspect ratio. The cache is under
`%LOCALAPPDATA%/Wave/artwork` or `$XDG_CACHE_HOME/wave/artwork` (`~/.cache/wave` by default).
`WAVE_DATA_DIR` also isolates this cache for tests. Existing indexes get a tag reread once to
fill artwork; unavailable roots postpone completion of that upgrade.

`settings.appearance()` and `settings.setAppearance(system|light|dark)` persist in the
device-local `desktop_settings` table. Main applies the choice to Electron's `nativeTheme`,
including the Windows title bar overlay. The renderer uses Core's default theme derivation.
The other Settings sections and player controls are placeholders for their tickets. Row
activation is the `onOpen` callback on `VirtualTable`; the playback ticket connects song
activation and the hero's Play/Shuffle controls to a play context.

## Wave account

A build has Sign In only when its environment names the sync service and Google's Desktop OAuth
client: `MAIN_VITE_WAVE_SYNC_URL` and `MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_ID`, plus
`MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_SECRET` if Google asks the Desktop client for one
(`src/main/account/config.ts`). electron-vite puts them in main's bundle; the renderer never sees
them. Without them Settings › Accounts says accounts aren't set up. An unpackaged run may point
elsewhere with `WAVE_SYNC_URL`, `WAVE_GOOGLE_DESKTOP_CLIENT_ID` and
`WAVE_GOOGLE_DESKTOP_CLIENT_SECRET`, and only there may the service be `http://127.0.0.1`.
Release builds take them from the repository variables `WAVE_SYNC_URL`,
`WAVE_GOOGLE_DESKTOP_CLIENT_ID` and `WAVE_GOOGLE_DESKTOP_CLIENT_SECRET` (CI's "Package the desktop
release"), and `scripts/package-release.ts` refuses a release without the first two. Never commit
their values. An unpackaged run may also name a stand-in for Google's token
endpoint with `WAVE_GOOGLE_TOKEN_URL`, taken only when it is `http://` on this computer.

Main holds the session in `wave-session.bin` under the data folder, sealed by `safeStorage`. With
no keyring (Linux without a Secret Service, or `basic_text`) nothing is written: the session
lasts until Wave quits and Settings › Accounts says so. The window reads it all through
`wave.account.view()`, and Sign In, Cancel, Sign Out, Sign Out on All Devices, Delete Account
and the invitation's Not Now are the other `wave.account.*` calls.

The sync (`src/main/sync/desktopSync.ts`) pulls on opening, on focus after five minutes away and
every 15 minutes, and pushes after a scan, a play that ended or a star. `bridge.test.ts` signs in
through a fake browser against the real sync service in memory (`src/main/account/testAccount.ts`
and `apps/sync/src/testing.ts`); real Google sign-in needs the owner's client.

`e2e/accountDeletion.spec.ts` runs Delete Account in the real window: it serves that sync service
and a fake token endpoint on `127.0.0.1`, answers the browser's redirect itself, and uses a
temporary data and music folder. Check Delete Account only this way, never on a real account or
the deployed service. `WAVE_SHOTS_DIR` says where its screenshots go.

## Spotify account

Register `http://127.0.0.1/spotify/callback` in Spotify's app dashboard. Wave adds a random
port at sign-in. Set the public client ID in the `WAVE_SPOTIFY_CLIENT_ID` repository variable
for releases, or in the same environment variable for an unpackaged run. Release builds pass
that ID to main as `MAIN_VITE_WAVE_SPOTIFY_CLIENT_ID`. Spotify PKCE needs only the client ID.
See [Spotify's redirect URI rules](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
and [Development Mode requirements](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

`e2e/spotifyAccount.spec.ts` fakes Spotify's browser and API responses and uses a separate data
folder for each test. It checks the profile, restart, Sign Out, Sign In Again, and the no-keyring
notice. The owner can verify the system browser and consent screen with a registered Spotify app.

## From Spotify

Import Playlists on the Playlists page offers From Files and, while YT Music is on, From Spotify.
Main reads the account with Spotify's Web API (`src/main/spotify/spotifyImport.ts`, Core's
`readSpotifyWebLibrary` and `readSpotifyWebPlaylist`) and the window uses
`wave.spotifyImport.library`, `run`, `cancel`, `artwork` and `missing`. `run` accepts only
sources the last `library` listed. A playlist Spotify answers 403 or 404 for is skipped, which
is what Development Mode does for playlists the account doesn't own.

A playlist page hides songs the Library lacks until YT Music has them, so its hero counts them
("2 not in your library") and lists them. Reading that list has main look them up on YT Music;
each one found takes its place among the page's rows.

`e2e/spotifyImport.spec.ts` fakes Spotify's browser and Web API. It checks the choice with YT
Music off and on, the sign-in before the picker, the rows, Import, the Imported label, Try Again
and Sign In Again. Its two absent songs are looked up on the live YT Music when the JVM is
built; the check holds whether or not it answers. Import & Download's queueing is covered in
`src/main/spotify/spotifyImport.test.ts`. A real account and a real download are owner checks.

## Share to Spotify

A playlist's menu has Share to Spotify when the build names a Spotify client ID. Main matches the
songs with Spotify's search (Core's `spotifyWebShareMatch`), makes a public playlist or updates
the one it made before, and copies its link (`src/main/spotify/playlistShare.ts`). The window
calls `wave.spotifyShare.playlist(id)` and hears only how it went. The Spotify playlist made for
each Wave playlist is remembered in `desktop_settings` as `share.spotify.<playlist id>`.

`e2e/spotifyShare.spec.ts` fakes Spotify's sign-in and Web API in main. It checks the sign-in
question, the playlist Spotify got, the toast, the clipboard, a second share and a failure. The
owner can verify a real account: the playlist appears public in Spotify with the matched songs.

## Song menus and keys

`e2e/songMenus.spec.ts` opens a song's menu by right-click, Shift+F10 and the Menu key, queues
and stars from it, checks selection (Select, Select All, unchecking, Esc, Remove with its
question), lists the shortcuts with Ctrl+/ and quits with Ctrl+Q. Playwright's keys go through
the page, so the spec sends Ctrl+Q with `webContents.sendInputEvent`: main reads it in
`before-input-event`, before any field can take it. The screenshot is
`song-menus-<platform>.png`.

`songs.actions(target, surface)` returns Core's entries for a menu or the selection bar;
`songs.run(target, action, playlistId?)` runs Play Next, Add to Queue, Favorite, Unfavorite, Add
to Playlist and Remove from Library. A target is `{scope, ids}` or `{scope, all: true, except}`
(at most 10,000 ids). Remove from Library adds a file exclusion, so later scans skip the file
until Settings includes it again; the file stays on disk. The renderer's keys go through Core's
`desktopKey`, with focus read by `keys.ts`.

## Sorting a page's songs

`e2e/pageSort.spec.ts` sorts a playlist's, an artist's and a genre's songs from their headers,
checks that Move Up and Move Down show only in a playlist's Custom order, that Play queues the
order shown, and that each choice survives a restart. Screenshots are
`page-sort-<page>-<platform>.png`.

`library.sortBy(kind, key, playlistId?)` takes a playlist's id for its own sort, which is kept
in the synced `settings.playlistSongs.<n>` preferences as the phone keeps it; artists and genres
share `tableSort.artist` and `tableSort.genre` on this computer. `BrowsePage.sort` is the order
shown, and a row's `order` is its place in the playlist's own order or its Popular rank. A
sorted playlist and an artist's Popular are ordered by Core in main, which reads the whole list
for each page. The Release date sort reads the file's date tag, else its Year.

## Listening History

`e2e/listeningHistory.spec.ts` seeds 3,000 counted plays, a streamed play with YT Music off, a
play of a song removed since and one that never counted. It checks the day headers, the dimmed
rows, that scrolling reads more pages while few rows are drawn, the search, Go to This Moment
with its 3-second tint, Back to the results, a double click that plays, and the Settings entry.
Screenshots are `listening-history-<platform>.png` and `listening-history-moment-<platform>.png`.

`history.page(from, query)` returns 50 plays: the newest (`{ before: undefined }`), older than a
cursor, newer than one (`{ after }`) or around a play (`{ around }`). `history.play(playId)`
replays that play's song alone; main reads the play again and does nothing for a dimmed one.
The rows come from `src/main/library/history.ts`, over Client's `db/listeningHistory`; the
paging is Core's `listeningHistoryReads`, which the phone uses too.

## Downloads and Fix Songs

`Downloads` (`src/main/downloads/downloadsLayer.ts`) follows the shared JVM's durable download
journal. Main answers its leased prepare, confirm, publish and import decisions using Core's
rules. The JVM runs the shared YouTube and Soulseek transfers and tag writers; audio stays in
files. Completed files are imported immediately through `DesktopLibrary.importFile`, preserving
a missing song's identity. The scanner also refreshes lyrics search text after a tag write.

The window uses `wave.downloads.view/rows/album`, `yt`, `missing`, `missingAction`, `retry`,
`cancel`, `clearFailed`, `folder/pickFolder` and `bestQuality/setBestQuality`. `missingAction`
accepts `downloadAll`, `retryFailed` or `cancel`, optionally for an album. Rows are paged, up to
200 per read. Settings' selected target folder becomes a scan root. Main checks connectivity
every three seconds and stops or restarts the journal accordingly.

`songs.run` accepts `download` (the menu's Download for missing songs), `fixSong` and `fixSongs`.
Every song list's click goes through main's `Playback.activate`: a tapped missing song downloads
and plays once its file is imported. `songs.states(ids)` (up to 200) gives each visible row's
download and whether its file failed to play; `downloads.view().notice` drives the start toast. The shared client module
`@wave/client/downloads/lookups` supplies both apps' LRCLIB and Deezer requests and album caches.
The synced `settings.findLyricsAndGenre` switch gates lookups and Fix Song's menu entry.
Lyrics found online for a Library song are written through `tags.writeSong` and reimported too.

The JVM adds `downloads.*`, `download.album/watchSong/lyrics`, `soulseek.session/turnOn/turnOff/search`
and `tags.writeSong`. Its `downloadsChanged` events trigger journal reads. Soulseek credentials
are sealed by main's `seal/unseal` host calls through Electron's keyring; without a keyring they
stay in memory. Rebuild the JAR with `pnpm --filter @wave/desktop build:jvm` after Kotlin changes.

The Downloads page reads `downloads.rows(offset, limit, failedShown)`: Core's `downloadListRows`
then `failedDownloadRows`, the failed songs only while shown. `downloads.move` takes a waiting
song or a group onto another's place (`to`) or one step (`step`), and `downloads.failedReason`
retries or removes every song that failed for one reason. `downloads.view()` carries the run's
`panel`, the `summary` line and `pauseNotice`; main follows Core's `ytThrottle` and has the JVM
pause YouTube's jobs (`downloads.pauseYoutube`). `e2e/downloadsPage.spec.ts` checks the page
offline with 1,205 queued songs: the groups, a bounded list, a group and a song moved by drag
and by Move Up, and the failed section. Its screenshots are `downloads-<step>-<platform>.png`.

`e2e/downloads.spec.ts` checks a missing Search song waiting offline and resuming through the real
JVM, and a live YouTube download with its tags read back and its Library entry visible. The live
check stops after search on CI; inspect its annotations if YouTube refuses the machine.

## Recap and card images

`e2e/recap.spec.ts` seeds three months of counted plays, opens the Recap from Home's card and
from Stats' Recaps row, moves with Right and Left, waits for a story to move on after six
seconds and for the summary to stay, and closes with Esc. It reads the queue before and after,
and counts `play_events` once the app has closed. Save Image runs with `dialog.showSaveDialog`
replaced in main, so no dialog opens; the spec reads the file's size from its PNG header and
the clipboard's image through Electron. Screenshots are `recap-<platform>-home.png`,
`-songs.png`, `-summary.png`, `-stats.png`, and the saved story is `recap-<platform>-image.png`.

`stats.recaps()` lists the periods with a Recap, `stats.recap(id)` opens one (Home stops
announcing it), and `stats.recapStory(index)` and `stats.recapClosed()` drive its music.
`cards.saveImage(fileName, pngBase64)` and `cards.copyImage(pngBase64)` take a PNG of at most
1080 by 1920 and a file name of the form `Wave - <title> - <yyyyMMdd-HHmmss>.png`; main refuses
anything else. The window draws the PNG from a card element at the size it is laid out at
(`renderer/src/cardImage.ts`); a Recap story is 1080 by 1920.
The native save dialog itself is an owner check.

## Home's editor

`e2e/homeEditor.spec.ts` edits Home from its Edit Home dialog with the keyboard alone (Move Up,
Remove, Add, Discover's rows), drags a row, then edits again under Settings › Home. It checks
Home's headings after each change and, once the app has closed, that a section this Wave doesn't
draw kept its place in the stored arrangement. Screenshots are `home-editor-<platform>-light.png`,
`-dark.png` and `-settings.png`.

`home.arrangement()` gives Core's `HomeArrangement`; `home.edit(edit)` takes one
`HomeArrangementEdit`, which main checks with `readHomeArrangementEdit`, applies to the synced
`settings.homeArrangement` with `editStoredHomeArrangement` (`src/main/homeArrangement.ts`) and
stamps for sync. `bridge.test.ts` syncs it with a phone both ways.

## Lyrics translation

`e2e/lyricsTranslation.spec.ts` turns Translate on in the Lyrics tab and Now Playing against a
stand-in for Google Translate (it replaces `globalThis.fetch` in main, which the translation
reads at call time). It checks the skeleton, each line's translation, the sung line, the
"already in" line, a failed request with Try Again, that nothing is sent while Translate is off,
and that a restart keeps the switch and shows the saved translation with Google out of reach.
The real endpoint is an owner check. `wave.lyrics.translateOn`, `setTranslateOn` and
`translation(trackId, language)` are the calls; main reads the lyrics itself
(`src/main/lyrics/translation.ts`).

## Theme editor

`e2e/themeEditor.spec.ts` edits the theme in Settings › Appearance: a background in each mode, a
custom colour typed and saved by keyboard alone, a saved colour applied and removed, the colour
well, and Reset. It reads the window's `--color-*` tokens after each pick; screenshots are
`theme-editor-light.png`, `theme-editor-dark.png` and `theme-editor-picker.png`.

`settings.editTheme(edit)` takes one of Core's `ThemeEdit` values, which main checks with
`readThemeEdit`, applies to the synced `settings.theme` with Core's theme choice rules
(`src/main/theme.ts`) and stamps for sync. It returns the stored theme, the value
`account.view().theme` then holds. `bridge.test.ts` syncs it with a phone both ways.

## Links

`e2e/links.spec.ts` pastes and drops each kind of link the phone opens (a YT Music song and
playlist, a Spotify track, playlist and short link) with YT Music off, so every one answers with
the same card and no service is asked anything. It also checks that pasted text that is no link
does nothing, that a paste into the search field stays a paste, and that Copy Link reaches the
system clipboard. What a link opens with YT Music on is tested in
`src/main/links/links.test.ts`, against a fake JVM and `fetch`.

## Online lyrics search

`lyrics.searchOnline(query)` asks Genius through the sync service with the Wave session
(`src/main/lyrics/geniusLyricsSearch.ts`, the phone's `requestGeniusLyricsSearch` from
`@wave/client/geniusLyricsSearch`), and `lyrics.openOnlineHit(id)` plays or opens a hit of the
last answer. The window waits for the typing pause and lists the hits (`OnlineLyrics.tsx`).

`e2e/geniusLyricsSearch.spec.ts` runs it against the sync service in memory and a fake Genius
(`e2e/geniusFixture.ts`), with YT Music off: the three-word rule, the signed-out, failed and
offline lines, five hits then twenty, the hit a Library Lyrics row hides, a Library song that
plays and a Genius page that opens. A hit that plays from YT Music is tested in
`src/main/lyrics/geniusLyricsSearch.test.ts` against a fake search; the live one is an owner
check.

## Opening files

`e2e/openFiles.spec.ts` starts Wave with a file outside the Library as its argument, then launches
it again with more files while it runs: they play in the running window as a new queue with
Undo, a text file among them is ignored, and only the Library's song leaves a counted play. The
screenshot is `open-files-<platform>.png`. `Playback.openFiles` is main's entry
(`src/main/playback/playback.ts`); `src/main/system/openedFiles.ts` gathers the files of
launches that come close together. What the installer registers and the AppImage declares is
`scripts/file-types.ts`, tested in `src/fileTypes.test.ts` without building an installer; "Open
with" after a real install is an owner check.

## Recognize

Main runs the phone's session (`@wave/client/recognizeSession`) over the JVM's Shazam client
(`DesktopRecognize.kt`): `src/main/recognize/desktopRecognize.ts` decides what is captured and
`capturePermissions.ts` allows the window only that. The window captures in
`renderer/src/recognizeCapture.ts` and shows `Recognize.tsx`. A development build passes
`WAVE_SHAZAM_URL` to the JVM as `--shazam-url`, so Shazam's requests go to a fake; a packaged
one never does. The JVM in `apps/desktop/jvm` must be rebuilt (`pnpm build:jvm`, JDK 21) after a
Kotlin change, or point `WAVE_KOTLIN_JAR` at a build that has it.

`e2e/recognize.spec.ts` runs with Chromium's fake microphone
(`--use-fake-device-for-media-stream`) against a fake Shazam: the card listening with Cancel,
playback paused and resumed, a Library match with its actions, Add to Shazam creating the
playlist, No match and No connection with Try Again, and no microphone for the page outside a
session. A refused microphone, a capture failure and a YT Music match are tested in
`src/main/recognize/desktopRecognize.test.ts` and Core. Recognizing a real song from the
microphone and from what the computer plays is an owner check.

## The dev window

To look at `pnpm dev` from an agent, start it in the background with a debugging port and a
scratch data folder, then read the page over the Chrome DevTools Protocol
(`http://127.0.0.1:9333/json` lists the targets):

```sh
WAVE_DATA_DIR="$(mktemp -d)" pnpm --filter @wave/desktop exec electron-vite dev --remoteDebuggingPort 9333
```

Stop the Electron processes it started when done: a second launch only focuses the first
window (the single-instance lock), so a leftover one hides your new code.

## Tray and system media controls

`e2e/system.spec.ts` covers close-to-tray, the one-time notice, the second launch, the `--hidden`
start and Settings › Window. Two variables add the real system controls to it:

- Windows: `WAVE_SMTC_PROBE=<path to smtc-probe.exe>`. Build the probe with
  `cargo build -p wave-media-node --example smtc-probe` in `apps/desktop/native`. It reads Wave's
  session from Windows and presses its buttons, so no other player may be running. The cover must
  be 71 px or more, or Chromium drops it.
- Linux: `WAVE_PLAYERCTL=1`, with `playerctl` installed and a session bus (WSLg has one; elsewhere
  wrap the run in `dbus-run-session --`). The addon needs `libdbus-1-dev` and `pkg-config` to
  build; `WAVE_MEDIA_ADDON` points Wave at one built elsewhere. With no session bus Wave logs
  `[system] Media controls unavailable` and uses Chromium's session.

The spec never turns on Start with the system, so it writes no login entry. `autostart.test.ts`
covers what the switch registers.

## Mini player

`e2e/miniPlayer.spec.ts` opens the mini player from the player bar and from the tray menu's
entry (read off the menu template Wave builds, since Playwright can't click a tray), checks that
it is above other windows with the main window's web preferences and CSP, drives its buttons and
Space, hides and brings back the main window, and checks the position after a restart and after
a stored position that is on no screen. The screenshot is `mini-player-<platform>.png`. Find the
windows by title: the main one is "Wave", the mini player is the catalogue's "Mini Player".
`src/main/system/miniPlayer.test.ts` covers the window's placement against fake screens.
Dragging it by hand and unplugging a monitor remain owner checks.

## Linux under WSLg

Windows' `node_modules` can't run in WSL. Clone into WSL's own disk and install there (worktree
branches are in the main checkout's refs, so commit first):

```sh
git clone --branch <branch> /mnt/c/projects/wave ~/wave-check && cd ~/wave-check
pnpm install --frozen-lockfile --filter "@wave/desktop..."
pnpm --filter @wave/desktop test:e2e
```

WSLg provides the display (`DISPLAY=:0`) and a PulseAudio server (`RDP Sink`). That server has no
cookie in your home, so point `PULSE_COOKIE` at any 256-byte file
(`head -c 256 /dev/zero > ~/pulse-cookie`); without it the engine finds no device and plays
silently. Without sudo, unpack `libasound2-dev` with `dpkg -x` and point `PKG_CONFIG_PATH` at its
`alsa.pc`. Electron's binary downloads on the first run. CI runs
the same set on `ubuntu-22.04` under `xvfb-run` and on `windows-latest` (the Desktop jobs in
`.github/workflows/ci.yml`).

## Packaging a release locally

Build the native addon and JVM as above on the target OS. Set `WAVE_DESKTOP_CHANNEL` to the
release channel and `WAVE_DESKTOP_UPDATE_PUBLIC_KEY` to a test Ed25519 public key in PEM form.
Keep the test key separate from keys used for distribution. The version must match Android's
version in the checkout. Use the stable tag without the `-ti` suffix for a promotion build.

```sh
pnpm --filter @wave/desktop build
pnpm --filter @wave/desktop exec node scripts/package-release.ts v0.72.0-ti /tmp/wave-desktop
```

The output contains the installer, the Windows blockmap on Windows, and `build.json` with
the release evidence. Linux packaging uses Ubuntu 22.04 with the ALSA and D-Bus headers
and the FUSE 2 runtime.
See [Release provenance](../release-provenance.md#desktop-installers) for publication and rollback.

## Kinds of shuffle

`e2e/shuffleKinds.spec.ts` opens the kinds of shuffle from a hero's Shuffle and the player bar's
by right-click, Shift+F10 and the Menu key, picks one, reads the queue Even Shuffle made, and
changes the choice in Settings › Playback. It plays silent WAV files it writes, so it needs the
audio addon. Screenshots are `shuffle-kinds-menu-<platform>.png` and
`shuffle-kinds-settings-<platform>.png`.

The choice is `shuffleKind` in `settings.playback()`, the phone's synced `settings.shuffleKind`.
A pick on the menu also sends the queue command `{ type: "reshuffle" }`. `bridge.test.ts` syncs
it with a phone both ways and checks the order Even Shuffle gives.
