---
name: Wave
description: A local-file music player whose library is set like a record label's catalog.
colors:
  background: "#e0ecef"
  foreground: "#121b1d"
  secondary: "#454f52"
  tertiary: "#778385"
  separator: "#c1cdd0"
  fill: "#d3dfe2"
  accent: "#006a5f"
  highlight: "#a14f09"
  destructive: "#b3261e"
  scrim: "#121b1d"
  background-dark: "#000000"
  foreground-dark: "#e0ecef"
  secondary-dark: "#a5b0b3"
  tertiary-dark: "#606b6e"
  separator-dark: "#1c2628"
  fill-dark: "#121b1d"
  accent-dark: "#59c0ad"
  highlight-dark: "#ec9d53"
  destructive-dark: "#f2867a"
  scrim-dark: "#000000"
typography:
  display:
    fontFamily: "Inter"
    fontSize: "56px"
    fontWeight: 300
    lineHeight: "64px"
  headline:
    fontFamily: "Inter"
    fontSize: "36px"
    fontWeight: 300
    lineHeight: "44px"
    letterSpacing: "-0.6px"
  title:
    fontFamily: "Inter"
    fontSize: "28px"
    fontWeight: 300
    lineHeight: "34px"
    letterSpacing: "-0.4px"
  entry:
    fontFamily: "Inter"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: "26px"
  body:
    fontFamily: "Inter"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "22px"
  body-strong:
    fontFamily: "Inter"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "22px"
  subheadline:
    fontFamily: "Inter"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "20px"
  footnote:
    fontFamily: "Inter"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
    fontFeature: "tnum"
  label:
    fontFamily: "Inter"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "1.4px"
  spine:
    fontFamily: "Inter"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: "14px"
    letterSpacing: "0.7px"
rounded:
  none: "0px"
spacing:
  cell: "8px"
  gutter: "16px"
  margin: "24px"
  state-cell: "32px"
  thumb: "40px"
  row: "56px"
  spine: "24px"
  spine-inset: "24px"
  spine-hit: "48px"
  spine-slot: "16px"
  spine-plate: "80px"
components:
  entry-row:
    textColor: "{colors.foreground}"
    typography: "{typography.entry}"
    height: "{spacing.row}"
    rounded: "{rounded.none}"
  track-row:
    textColor: "{colors.foreground}"
    typography: "{typography.body-strong}"
    height: "{spacing.row}"
    rounded: "{rounded.none}"
  track-row-playing:
    textColor: "{colors.highlight}"
  track-row-missing:
    textColor: "{colors.secondary}"
  album-artwork:
    backgroundColor: "{colors.fill}"
    rounded: "{rounded.none}"
  catalog-line:
    textColor: "{colors.secondary}"
    typography: "{typography.label}"
  icon-button:
    textColor: "{colors.accent}"
    size: "48px"
    rounded: "{rounded.none}"
  icon-button-disabled:
    textColor: "{colors.tertiary}"
  alphabet-spine:
    textColor: "{colors.secondary}"
    typography: "{typography.spine}"
    width: "{spacing.spine}"
  alphabet-spine-active:
    textColor: "{colors.accent}"
  alphabet-spine-plate:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.foreground}"
    typography: "{typography.display}"
    size: "{spacing.spine-plate}"
    rounded: "{rounded.none}"
---

# Design System: Wave

## Overview

**Creative North Star: "The Quiet Catalog"**

Wave sets the owner's library the way a record label sets its catalog (the ECM cover program is the touchstone): artwork sits in wide, calm, tinted fields and the type around it is small and exact. Calm here comes from alignment, not from emptiness. Every margin, row, tile and the A–Z spine snaps to one 8dp cell, so a screen of tens of thousands of tracks still reads as ordered furniture rather than density.

The light ground is tinted, never plain white: fog blue-grey. The dark ground is true black, so an OLED screen goes dark around the artwork, and everything raised from it (groups, cards, hairlines) climbs the same tinted ramp. Every neutral is a step on that one ramp. Hierarchy is quiet. The large title is light, not bold; lists use one type size and rank by weight and tint; labels are small tracked capitals, like the catalog line printed under a sleeve. Two chromatic voices only: a deep teal for what is active, an ember for what is loved or playing.

The world rejects the category default it was chosen against: bold large titles, chevron-and-icon rows, rounded "card" chrome around artwork, and a single accent on pure white. (The app icon sits on black too: two waves, teal over amber, so it holds up among other launcher icons; see #94.) Components are fully custom (chosen over Material 3), but Android's own conventions still hold: system and predictive Back work, touch targets are 48dp, and the theme follows the system light/dark setting.

**Key Characteristics:**

- Fog ground in light, true black in dark; neutrals from one ramp (OKLCH hue ~215).
- One 8dp cell module for every dimension.
- Artwork as photographs: square, unrounded, unframed (artists are circles; the mini player's thumbnail follows its pill).
- Light large titles; one size per list, rank by weight and tint.
- Small tracked-caps catalog lines for section heads and cover captions.
- Teal for active, ember for favorite and now playing; nothing else is coloured, save the red on a Delete or Remove button.
- Flat: no shadows, no gradients (the Now Playing ground is the one exception). Glass only on what floats: the chrome (tab bar, Search pill, mini player) and dialog and menu cards.
- Every press sinks and dims for a duration the owner sets in Settings.

## Colors

A cool, low-chroma tonal ramp carrying two small, saturated voices: teal and ember.

### Primary

- **Darkroom Teal** (`accent`; deep in light, a lifted mint-teal in dark): the active state. Icon buttons, the selected tab underline in segmented views, the active letter on the A–Z spine, toggles and progress. It marks what you can act on or what is currently selected, never decoration.

### Secondary

- **Ember** (`highlight`; burnt orange in light, a warm apricot in dark): favorite and now playing. The playing track's title and its wavy underline, the favorite star. Ember means "this one is yours, or this one is sounding".

### Destructive

- **Signal Red** (`destructive`; brick red in light, a soft coral in dark): only the label of a confirmation's action that deletes or removes something (Delete, Remove). Never a fill, never decoration.

### Neutral

- **Fog / True Black** (`background`): the ground of every screen. Fog blue-grey in light (tone-1), true black (`#000000`) in dark.
- **Ink** (`foreground`): titles, track titles, entry labels, the large title.
- **Graphite** (`secondary`): artists, counts, durations, furniture lines, catalog lines, inactive spine letters, helper copy.
- **Pewter** (`tertiary`): non-text only. Disabled icon buttons, the missing-file glyph, the placeholder note on artless covers.
- **Rule** (`separator`): one-pixel hairlines between entries and around setting rows.
- **Card divider**: on overlay cards (menus, dialogs) the separator tone vanishes on glass, so their rules are the ink laid at about a quarter strength, two pixels thick (Core's `overlayDivider`). `Hairline` draws it by itself inside any overlay card; one sits between each pair of entries, never after the last.
- **Field** (`fill`): the square behind artwork that has no image, and empty cover slots.

The full ramp lives in `global.css` as `tone-0` (lightest, `#eff4f6`) to `tone-11` (darkest, `#0a1113`); each semantic token is a step on it, in both themes. Light mode uses `tone-0` to `tone-10` (its ink is `tone-10`); `tone-11` is used by dark mode only. On the black dark ground, grouped areas sit on `tone-11`, cards and fills on `tone-10` and hairlines on `tone-9`, so each stands off the ground and light mode never changes when dark mode gets darker. The ground dark mode shipped with before, Night Slate (`tone-11`, with grouped areas sharing it), is kept in Core as `NIGHT_SLATE` and offered as the Slate swatch. Core's `packages/core/src/theme.ts` holds the same values (`DEFAULT_THEME`, `TONES`) and checks WCAG AA for every pair the app draws (`themeContrastIssues`); an app test fails if `global.css` or the launch splash drift from it. `surface` is the tint laid over the glass of the floating chrome (at about 72%); `scrim` is the veil behind dialog and menu cards, laid at a quarter strength: the ink in light mode, the ground in dark. `grouped` and `on-accent` are also declared there but are not yet used by this world's components.

These are the shipped colours. In Settings › Theme the owner picks a background for each mode and a primary (`accent`) and secondary (`highlight`) from preset swatches; True black is the marked default for dark mode, and Slate gives Night Slate exactly; for any other background Core's `themeFor` derives every other token from it (each neutral keeps the contrast it has on fog or Night Slate, so cards stand off any ground) and deepens or brightens an ink until it meets its contrast minimum. The app lays the result over `global.css` at runtime with `Uniwind.updateCSSVariables`, so every class and `useThemeColor` reader recolours at once; `global.css` stays the shipped theme. The launch splash follows the whole choice from the next cold start (Android 13 and later; Android 12 keeps the shipped theme): a config plugin (`plugins/withLaunchSplash.ts`) ships a splash style for each choice Settings › Theme can make (Core's `LAUNCH_SPLASH_THEMES`): its ground, and the logo's top wave in the primary and bottom wave in the secondary, each as readable on that ground as in the app. Every theme change saves Core's `launchTheme` natively (`modules/wave-native`, `launch/LaunchThemeStore.kt`), which picks the matching style for Android to open with, so the app opens on one ground from the splash to the first screen. See Launch Screen for the logo's motion. The launcher icon follows too: its top wave takes the primary and its bottom wave the secondary (their dark tones; the shipped pair keeps #94's teal and amber), still on black. Android can't recolour an icon, so Wave ships one per pair (Core's `LAUNCHER_ICONS`, vector drawables and activity aliases written at prebuild by `plugins/launcherIcons.ts`) and switches when Wave leaves the screen. Where the launcher drops the home-screen icon on a switch (`LAUNCHER` in `src/settings/launcherIcon.ts`), Settings asks first.

### Named Rules

**The One Ramp Rule.** Every neutral is a step on the tone ramp. No ad-hoc greys, no opacity-on-black greys; if a new neutral is needed, pick a ramp step.

**The Ground Rule.** The ground is fog in light and true black in dark. Never ship a screen on `#ffffff`, and never put a card, group or hairline on black without a ramp step between them.

**The Two Voices Rule.** Teal means active, ember means favorite or playing. If a colour on screen means neither, it should be a neutral. The one exception is the destructive red on a Delete or Remove button.

**The Pewter Is Not Text Rule.** `tertiary` sits near 3:1 on the ground: enough for an icon, not for words. Text uses `foreground` or `secondary`.

## Typography

**Display Font:** Inter (bundled by the expo-font plugin, weights 300–800)
**Body Font:** Inter
**Label/Mono Font:** Inter, tracked caps for labels; tabular figures for every number that lines up

**Character:** One workhorse grotesk speaking at low volume. Light weights carry the big type, so size reads as calm rather than loud; small sizes do the exact work.

### Hierarchy

- **Display** (300, 56/64): the letter on the A–Z spine's plate while the spine is dragged. Nowhere else.
- **Headline** (300, 36/44, -0.6 tracking): the large title of a tab screen ("Library"), top-left, scrolling with the content.
- **Title** (300, 28/34, -0.4 tracking): the title of a pushed screen, under the Back button.
- **Entry** (400, 20/26): Library entries and settings row labels; one quiet line each.
- **Body** (400 / 500, 16/22): track rows (title at 500, artist at 400, same size), album titles under covers (500), the settings stepper value (500).
- **Subheadline** (400, 15/20): entry counts and empty-state messages.
- **Footnote** (400, 13/18): album furniture lines, track durations, helper text under settings. Numbers use tabular figures.
- **Label** (600, 12/16, 1.4 tracking, uppercase): the catalog line. Section heads ("Recently added", "Motion") and the artist line on a cover.
- **Spine** (600, 10/14, 0.7 tracking): the letters of the A–Z spine.

Sizes are in dp and scale with the system font size; at font scale 1.3 album furniture lines and song artists truncate to one line by design.

### Named Rules

**The One Size Per List Rule.** Within a list, title and secondary line share one size; rank comes from weight (500 vs 400) and tint (`foreground` vs `secondary`), never from a second size.

**The Light Title Rule.** Large titles are weight 300. Bold large titles are the category default this world was chosen against.

**The Catalog Line Rule.** Tracked caps label a section or a cover's metadata. They never sit as a kicker above a headline.

## Layout

Everything is a whole (or half/quarter) multiple of the 8dp cell (`CELL` in `src/catalog/grid.ts`): side margin 24dp, tile gutter 16dp, row height 56dp, a 32dp state cell, 40dp track thumbnails, and a 24dp-wide spine. Vertical rhythm uses the same steps: 12dp between artwork and its caption, 40dp above "Recently added", 24dp between album rows. Scrolling screens pad their bottom so the last row clears the floating chrome plus 24dp (`useChromeInset()` in `src/chrome/chrome.tsx`).

Album grids are two columns. Tile width is computed from the window: screen width minus the left margin, the spine's touch target and its inset, and one gutter, halved. Each tile reserves a fixed 96dp caption block (catalog line, two lines of title, furniture line), so every furniture line lands in the same place.

Rows are fixed-height (56dp), so long lists can be laid out by index and scroll at 120 Hz. Every track row reserves the same cells whether or not they are filled: leading thumbnail or track-number cell (in selection mode, a check cell before it), title and artist, a favorite cell, and a right-aligned 40dp duration (a 72dp play count on a ranking by plays). The playing track needs no cell of its own: it is marked on the title itself (ember, with a wavy underline). A missing file's glyph takes the track-number cell in album lists and, in Songs lists, sits after the text, taking its room from the title. State never moves the favorite or duration cells.

The A–Z spine sits 24dp in from the right edge, not on it, to stay clear of Android's system Back gesture zone (Android only lets an app exclude 200dp per edge). The spine's touch target is 48dp wide even though only 24dp is drawn, and lists that carry a spine keep their rows clear of all of it: they pad their right side by the touch target plus the inset (72dp), so rows end a margin short of the letters and a scroll or tap near a row's right edge never lands on the spine.

### Named Rules

**The One Module Rule.** If a dimension isn't a multiple of 8dp (or a half/quarter of it, for type-adjacent gaps), it's wrong.

**The Fixed Cell Rule.** Each piece of row state drawn as a glyph (favorite, check, track number) owns a fixed cell in every row; reserve the cell even when empty. Playing is marked on the title, not in a cell.

**The Back Zone Rule.** Nothing draggable lives in the outer 24dp of a screen edge.

## Elevation & Depth

The world is flat. There are no shadows, no elevation and no gradients (save the Now Playing ground, below); depth comes from the tone ramp (field squares and hairlines a step off the ground) and from artwork itself. Three things float: the spine's letter plate (a field square in the `fill` tone beside the finger, with no shadow), the floating chrome at the bottom, and dialogs and menus; the last two are glass.

**Glass** (the floating chrome, dialogs and menus): a live blur of the content underneath, a slight lens-like refraction at the rounded edge with a specular rim lit from the top left, and the `surface` tone laid over it so text stays legible. It is native (`modules/wave-glass`, RenderEffect + AGSL on the RenderThread) and sized for 120 Hz; blur, refraction, tint and rim are tuned in Settings › Glass (defaults in Core `GLASS_SETTINGS`), and refraction 0 is the blur + tint + rim fallback. See `docs/glass-spike.md`. Below Android 12 (no RenderEffect) glass is an opaque `surface`.

**Dialogs and menus** float as glass cards over the app: rounded (24dp), sized to their content, centred a margin clear of the system bars (a card with a text field, like the playlist name prompt, sits a margin below the status bar instead, and any card stays clear of the keyboard; a long-press menu opens next to its row or tile instead: below it, or above when there is no room, clear of the floating chrome too), over the app dimmed lightly (the scheme's darkest tone at 25%). They fade and grow in over the tap duration (fade only with reduce motion, instant at 0). They are drawn at the app root by `src/overlay/OverlayHost.tsx` rather than in a `Modal` (a separate window the blur can't see through). Back or a tap outside closes them, and screen readers move into the card. A long-press menu keeps the finger that opened it: slide onto an entry and lift to run it (`src/overlay/useSlideToChoose.ts`, hit-testing in Core's `slideEntry`); lists hold still while that finger is down (`useListScrollable`). What a card was opened from stays clear of the veil, washed with the accent at 16%, so a menu opened from a row, tile or button has no heading and starts at its entries (a Library entry's menu keeps its heading, the only place that counts its songs); one opened with nothing highlighted starts with its item (artwork, title, subtitle) over a divider (`src/overlay/CardHeading.tsx`, Core's `cardShowsHeading`).

### Named Rules

**The Flat Field Rule.** Surfaces never cast shadows. Separate things with a ramp step or a hairline. Glass belongs to what floats (tab bar, Search pill, mini player, dialog and menu cards); content surfaces stay flat.

## Shapes

Square everywhere. Artwork, empty cover slots, track thumbnails and placeholder fields have no corner radius and no frame, with two exceptions that take the shape of what holds them: artists' circles (below) and the mini player's thumbnail, whose corners are concentric with its glass pill. Structure is drawn with one-pixel hairlines in the separator tone, running the full content width between entries; there are no boxed cards and no chips. What floats is the exception: the chrome's glass surfaces are pills (fully rounded ends) and dialog cards have 24dp corners, set apart from the square content beneath. Artists are circles: their image (their downloaded photo when there is one, else Core's `artistArtwork`: the cover of their own album with the most songs, else the album they appear on most), or their initial in graphite on a `fill` circle when they have no artwork, so artists read apart from albums. Rows lead with a 40dp circle, Home's artist shelf and the artist page head with a large one. The YouTube account's picture in Settings is a 40dp circle too, a person like an artist. The recurring silhouettes are the thin vertical column of spine letters on the right and the pills at the bottom.

### Named Rules

**The Photograph Rule.** Artwork is a photograph: square, unrounded, unbordered, never inside card chrome. Two exceptions, both deliberate: an artist's image is a circle, so artists read apart from albums; and the mini player's thumbnail rounds its corners concentric with the glass pill around it (the pill's radius minus the thumbnail's inset, Core's `concentricRadius`), so it follows the pill's curve. Nowhere else does artwork round.

## Components

Every tappable element is built on one press primitive, so the whole world feels the same under the thumb.

### Press (the motion primitive)

- **Behaviour:** on press-in the target dims to 65% opacity and sinks (scales down) by its depth; on release it returns. Ease-out exponential: fast to respond, quiet to settle.
- **Duration:** the owner's tap animation setting (0–600 ms in 20 ms steps, default 140 ms). 0 ms makes it an instant dim; the system reduce-motion setting removes the scale and keeps the dim.
- **Depth by size:** small icon buttons sink most (0.1), the default is 0.04, album tiles 0.02, track rows 0.015. Big targets move less.
- **Haptics:** `selection` for light taps (entries, tabs, icon buttons), `impact` (light) for actions such as play or favorite; a selection tick per letter on the spine.

### Buttons

- **Shape:** a 48dp square target, no visible container (0px radius, no fill).
- **Icon button:** a 24dp line icon (1.5 stroke) in teal; disabled drops to pewter. Used for Settings, Back and the stepper's minus/plus.
- **Text button:** a Body 500 label in teal (red for a destructive action, graphite when disabled), no container, a 48dp target.

### Alert Dialog

A glass dialog card (`src/overlay/alert.tsx`, opened from anywhere with `showMessage` / `confirmAction`): the title in Title3 ink, the message below in Subheadline graphite, then the buttons as text buttons right-aligned along the bottom. A message has a single OK; a confirmation has Cancel then the action, which is red when it deletes or removes. Back or a tap outside does what Cancel or OK does. A confirmation may rename Cancel when dismissing it does something gentler than nothing: an imported playlist whose name is taken asks Keep Both / Replace (red). Screen readers hear the title and message as it opens. There are no system alerts.

Import Playlists ends on a summary card of the same make (`src/library/importPlaylists.tsx`): the title, then one section per picked file (its name in Body 500 ink, what it became in Subheadline graphite, then each entry left out in Footnote graphite), scrolling when long, and OK.

### Artist Choice

What Go to Artist opens on a song or album credited to several artists, and what the artist lines of Now Playing and an album's page open for them (`src/library/ArtistChoice.tsx`). A glass card laid out like Add to Playlist: a "Go to Artist" catalog line, then one artist row per credited artist in credit order (the 40dp artist circle, the name in Body 500 ink over the song count in Body graphite, 56dp), each after a card divider. Tapping one closes the card and opens their page. It follows up on the menu or link it came from, so that row stays highlighted, and it opens once the artists' rows are read, so it never grows under the finger. The artist page you're on is left out, and a choice of one is no choice: the link opens that artist straight away (Core's `artistLink`).

- **Hover / Focus:** touch only; the Press dim-and-sink is the whole feedback.

### Entry Row

The Library's entries (Playlists, Artists, Albums, Songs, Genres, Folders, Favorites, then Discover while YT Music is on) and settings links. One quiet line of Entry type, 56dp tall, with a right-aligned tabular count in Subheadline graphite whose column stays reserved when the count is unknown. A hairline below each; the list opens with a hairline above. No icon, no chevron.

### Track Row

56dp, fixed cells, one type size. Songs lists lead with a 40dp square thumbnail; album track lists lead with the track number in a 32dp cell. Playing: title in ember with a thin ember wavy underline spanning its visible text, rippling while music plays and still when paused (static under reduce motion or tap animation 0 ms). Missing file: title in graphite, artist line reads "File not found", a file-off glyph in pewter (after the text in Songs lists, in place of the number in album lists), and the row is disabled. Favorite: a small filled star in ember in its own 24dp cell. Duration in tabular Footnote, right-aligned. A ranking by plays leads with plays: its rows show the counted plays the ranking was ordered by ("12 plays", "1 play") in the duration's place, in the same tabular Footnote graphite, right-aligned in a cell widened to 72dp for every row of the list, and the second line is the artist alone (Core's `trackRowTrailing`). Home's Most played uses this with the thumbnail row; Stats' song rankings and the artist page's Most played use the numbered row with the rank as the number (the top one in ember, 500). Every other list shows the length.

In Search, YT Music songs sit below the library's results under a "YT Music" catalog line, as Songs-list rows: YouTube's cover as the thumbnail (square, like any artwork), the artists and album as the second line ("Artist & Artist · Album"), the length in the duration cell (left empty when YouTube doesn't give one). Instead of songs the section can show one quiet line in Footnote graphite (searching, nothing found, all already in the library, offline, no answer); never an error card. When the library has nothing for the query, the same quiet line says so above the section. A YT Music row plays like a Library song's (tap streams the section from it, the playing one in ember). Playing, a streamed song looks like any track (mini player, Now Playing with its cover's tint) but has no star and plain-text artist and album. When it can't stream, playback pauses and the line under the title (the artist in the mini player, the album in Now Playing) says why in graphite ("You're offline. YT Music songs need the network."); never a dialog.

A YT Music song's long-press menu is the track menu's card (quiet entries under the highlighted row; cover, title and credit first when nothing is highlighted): Play Next and Add to Queue, then Download, or Cancel Download while it's waiting or downloading, Retry Download and Cancel Download after a failure, nothing while it's being saved. While a download is on its way the row's second line says where it is instead of the credit ("Waiting to download", "Downloading · 42%", "Saving to the Library", "Download failed: offline"), and a 2dp teal rule under the two lines fills up as the audio arrives (on a separator-coloured track, only once the size is known). Once saved, the song is in the Library and leaves the section. The system notification shows the same: "Downloading" with the title and a progress bar, then "Saving to the Library".

### Album Tile

A square cover at the computed tile width, then 12dp, then the caption: artist as a catalog line, the title in Body 500 with two lines always reserved, then the furniture line in Footnote graphite ("1975 · 9 · 41 min", tabular). Covers without art show a field square with a thin music note in pewter.

### Catalog Line

Small tracked caps (Label) in graphite by default, with teal and ember tones available. One line, truncating. Used as section heads and cover captions.

### Navigation

- **Tab screens** open on a light large title at top-left, with at most one trailing icon button on the title line.
- **Pushed screens** show a Back icon button aligned so its glyph sits on the 24dp margin, then the title in Title type. System and predictive Back both work.
- **In-screen switches** (Albums / Songs) are text tabs in Body: selected is 600 ink with a 2dp teal underline, unselected is 400 graphite; each tab is at least 48dp tall.
- **Tab bar** floats a cell above the system inset with 24dp side margins: Home and Library share one 64dp glass pill (24dp line icon over a Caption 600 label, teal when current, graphite otherwise), joined by the shortcut tab (a Library section chosen in Settings, with its section's icon) when there is one, and Search sits beside it, a cell apart, in its own 64dp round glass pill with the icon only. Tabs press with `selection` haptics.
- **Shortcut tab:** what it opens (an artist, an album…) is pushed inside the tab, under the tab bar, and stays open while another tab is showing; the same screens opened from the Library are pushed over the tabs.
- **Mini player** floats a cell above the tab bar (or above the system inset on pushed Library screens) in a 56dp glass pill with the same side margins: a 40dp thumbnail whose corners are concentric with the pill (Core's `concentricRadius` works the radius out from the pill's height, radius and the thumbnail's 12dp inset; the no-artwork placeholder has the same corners), title (Body 500) over artist (Body 400 graphite), then play/pause and next as icon buttons. Tap it, or swipe it up, to open Now Playing. Swipe left for the next track, right for the previous one: the content follows the finger and fades, and a skip leaves the way it was pushed with a light `impact` haptic; a short slow drag springs back. Screen readers get "Next track" / "Previous track" actions instead of the swipe.

### Now Playing

- **Presentation:** a full-screen sheet over the tabs (`src/nowPlaying/NowPlayingSheet.tsx`, mounted once over the app and kept out of sight below the screen while closed, so a tap only starts its spring and the first frame already has the track's colours and artwork; motion in `src/nowPlaying/sheet.ts`, lifecycle in Core's `stepNowPlayingSheet`). It follows the finger up out of the mini player and down to dismiss, and springs (no wobble) to wherever it settles: a quarter of the screen or a flick commits, a flick back cancels (Core's `settleSheet`). The chevron and system Back slide it away too. Lists inside it (Up Next) keep their own scrolling; everything else drags the sheet.
- **Ground:** the one gradient in Wave. Top to bottom from two artwork palette swatches (dark swatches in dark mode, light ones in light), toned toward the ground until ink, graphite and teal all keep 4.5:1 on it (Core's `paletteGradient`); artwork without a palette leaves the plain ground. On a track change it crossfades over 700 ms. Everything set on it uses the app palette, never the artwork's.
- **Player view:** the artwork as the largest square the space allows (still a photograph: square, unframed), stepping back to 84% on a soft spring while paused. Under it the title (Title3 500, ink) with the favorite star in its own 48dp cell, then the artist and the album (Body graphite), each opening its screen (a song credited to several artists opens the Artist Choice).
- **Scrubber:** a 2dp rule: the elapsed part is a still teal wave, the playing-song underline's shape scaled up (Core's `elapsedWavePath`), that meets the flat pewter remaining line at the playhead, with no thumb. Flat at 0:00, all wave at the end. Touching anywhere scrubs (wave and line thicken together to 4dp and the join follows the finger), and the track seeks when the finger lifts, with a light `impact`. Elapsed and remaining (`-m:ss`) in tabular Footnote graphite below.
- **Transport:** previous, play/pause and next as filled glyphs in ink (32 / 48 / 32dp), each in a target a cell and a half larger on every side, with `impact` haptics. Previous restarts the track after its first three seconds.
- **Sleep timer:** the Zzz glyph beside Lyrics at the bottom left (graphite when off, teal while a timer runs, with the time left beside it in tabular Footnote teal, or "End of track"). It opens a glass dialog card laid out like the long-press menu: a "Sleep timer" catalog line over what the running timer will do, then 15 / 30 / 45 / 60 Minutes, Custom… (a stepper: minute steps under 10 min, 5 under an hour, 15 above, up to 12 h), End of Track and, while one runs, Turn Off Timer. The playback service enforces it, so it pauses with Wave in the background.
- **Queue view:** the Queue icon (teal while open) swaps the player view for the playing track in a small row, Shuffle and Repeat as labelled toggles (teal and 600 when on, graphite when off; Repeat cycles off → all → one), then the Up Next catalog line with its count and the list. Each Up Next row is a Songs-list row with a remove X and a drag handle (both graphite, 48dp). Dragging the handle lifts the row onto the `surface` tone under the finger while the others step aside; near the list's edges the list scrolls. Screen readers get Remove / Move up / Move down actions.
- **Lyrics view:** the Lyrics icon (bottom left, teal while open) swaps the player view for the same small track row, then the lyrics in Title2 500. Synced lyrics (embedded LRC or a sidecar `.lrc`; Core's `pickLyrics` prefers synced, then the sidecar) tint the sung line ink and the rest graphite, easing over 240 ms, and keep the sung line a third of the way down as the song plays. A pause between lines shows as three 4dp squares. Scrolling by hand stops the follow until three seconds after the finger lifts; tapping a line seeks there with a `selection` haptic. Unsynced lyrics are plain ink text to scroll; a song without lyrics shows the empty state. Lyrics are read from the file each time the view opens, so a newly added `.lrc` shows up without a rescan, and again as soon as Find Lyrics and Genre writes new ones.

### Launch Screen

The splash Android draws while Wave starts: the chosen ground (see Colors) with the logo centred, its still shape as wide as the shipped splash's (80dp from the centre to its furthest edge, inside Android's 192dp icon circle). The logo moves from the first frame: both waves flow left together, one wavelength a second, between round caps that stay where the still logo's are, so the logo keeps its outline and only the water moves (Core's `launchLogoWaves`; `plugins/launchLogoDrawable.ts` writes it as an animated vector, which Android plays on its RenderThread). Each sweep starts and ends on the still logo, so wherever the motion stops, the logo is whole.

The waves keep moving until Wave's first screen is ready, then the splash fades out over 400 ms and the first screen is underneath, already drawn. A quick start doesn't cut the first sweep short: the splash stays until the fade can end as the first sweep does (Core's `launchLogoExit`, run natively by `launch/LaunchSplashExit.kt`). With the system's Remove animations on, the logo stands still and the splash goes as it always did. Android 12 stops the motion after ten seconds and leaves the still logo.

### Stepper (Settings)

An Entry-type label, then minus / value / plus. The value is Body 500 tabular, centred in a minimum 72dp column on one line so it never wraps at large font scales; the buttons disable at the range ends. Helper text in Footnote sits below the row's closing hairline.

### YT Music account (Settings)

Below Use YT Music and its helper text, three cells down, between hairlines (`src/settings/YtMusicSettingsSection.tsx`; what shows is Core's `ytAccountView`):

- **Signed out:** a Sign In text button in a 56dp row, and Footnote graphite under the closing hairline saying signing in is optional and what it changes. While Google's page is open the button reads "Signing In…" in graphite, disabled. A sign-in that didn't work only changes that footnote (no connection, or YouTube didn't confirm it); never an error card.
- **Signed in:** the account as a 56dp row: its picture as a 40dp circle (a person, like an artist; their initial on a `fill` circle without one), the name in Body 500 ink over the email in Body graphite. Under the closing hairline, Sign Out as a text button in teal (it forgets a session, it doesn't delete anything) and a footnote saying what uses the account.
- **Expired:** like signed out, with Sign In Again and a footnote saying the session ended.
- **YT Music off:** no Sign In (it would talk to Google); a signed-in account still shows, so it can be signed out of.

Sign In opens Google's own page full screen over Wave (a plain web view in the system's light or dark theme, clear of the system bars and the keyboard); Back steps back through Google's pages and then out. It closes by itself once the account is signed in.

### Discover

The YouTube account's recommendations, YouTube Music's home set in Wave's own layout (`src/app/library/discover.tsx`; what shows is Core's `discoverView`). The Library lists it as a plain entry row after Favorites, without a count; with YT Music off the row is gone.

- **Screen:** a pushed screen with Back and the "Discover" title, then YouTube Music's shelves in its order, each under its catalog line (the shelf's name, as Home's sections are titled). Nothing YouTube serves as a prompt is drawn: no taste builder, no moods, no banners, no Premium. Pull to refresh asks again, in teal, and keeps the shelves up meanwhile.
- **Song shelves** (Quick picks and the like, Core's `layout: "songs"`): Songs-list rows in columns of four, the columns scrolling sideways edge to edge, the next one peeking in a 32dp margin from the right (one column fills the width). A song the Library has is drawn as its Library row (its star, its menu) and plays the file; the others are YT Music rows (YouTube's cover, artists · album, the download line and rule while one is on its way) and stream.
- **Cover shelves** (mixes, albums, playlists, or a shelf that mixes them): Home's shelf of album tiles, 152dp covers with the next one peeking in. The catalog line is who made it (the artists, the playlist's maker without YouTube's view count) and the furniture line says what it is ("Album · 2024", "Playlist", "Song"; Core's `discoverTileCaption`). A song tile plays the shelf's songs from it and long-presses to its menu; an album or playlist opens its songs. An album tile long-presses to the album's menu (`src/ytmusic/YtAlbumActions.tsx`), the track menu's card with the cover, title and artists first when the tile isn't highlighted: Play Next and Add to Queue (the album's songs, the Library's files for those it has), then Download Album, Cancel Album Download while its songs are waiting or downloading, Retry Failed once the batch has ended with failures, and no download entry once the Library has every song (Core's `ytAlbumDownload`). The card opens once the album's page is read (at once the second time), so its entries never shift under the finger; offline or without an answer, a message card says so instead.
- **States**, each Wave's empty state (pewter line icon, Entry title, Subheadline graphite message), never an error card: signed out, "Recommendations come from your account" with Open Settings as a text button (an account sign-in, never a Premium upsell); offline, "You're offline"; no answer, "No answer from YouTube Music" and pull to try again; nothing to show, "Nothing to recommend yet". Until the first shelves arrive a quiet Subheadline graphite line says Wave is asking.

An album or playlist from Discover opens a pushed screen laid out like a Library album (`src/ytmusic/YtSongList.tsx`): the cover as wide as the margins allow, the title in Title type, who made it in Body 500 graphite (plain text, not a link), the furniture line ("Album · 2013 · 12 songs · 52 min", "Playlist · 62 songs · 260 min"), Play and Shuffle, then its songs: an album's by number with the artists as the second line, a playlist's with their covers. They behave as on the shelves (the Library's file for songs it has, a YT Music song's menu with Play Next, Add to Queue and Download for the rest). The cover and title the tapped tile had show at once; offline or without an answer, the empty state takes the songs' place.

### YT Music on the artist page

The artist page is the Library's and opens without the network; YT Music only ever comes after it, at the end of the page, below the artist's songs (`src/ytmusic/YtArtistSection.tsx`; what shows is Core's `ytArtistSectionView`).

- **Button:** while YT Music is on, the page ends with **Show on YouTube Music**, a text button (Body 500 teal, no container, 48dp target) 16dp below the last row. Nothing is asked before it's tapped. "Various Artists", "Unknown Artist" and names without letters get none.
- **Section:** once tapped, a "YT Music" catalog line heads the section as the page's other sections are headed, then the artist's top songs the Library doesn't have as YT Music rows (YouTube's cover, artists · album, no length, since an artist page doesn't give one): tap streams the section from that song, long-press opens the YT Music song menu (Play Next, Add to Queue, Download), and a download shows its line and rule like anywhere else. While Library songs are being selected the rows do nothing.
- **Quiet lines,** one Footnote graphite line under the catalog line, never an error card: "Looking on YouTube Music…" while it asks, "Your library already has this artist's top songs.", "YouTube Music lists no top songs for this artist.", "Not found on YouTube Music.", "You're offline. Try again when you're back online." and "YouTube Music didn't answer. Try again in a moment.". Offline or without an answer the button stays under the line, to try again.
- **Albums and singles:** under the top songs (or their quiet line), two shelves headed like the page's sections, "Albums" then "Singles & EPs", each Discover's row of 152dp album tiles scrolling sideways edge to edge with the next cover peeking in, newest first (undated last; Core's `ytArtistShelves`). The catalog line is the release's artists, the furniture line its year ("Album" or "Single" without one). A release the Library already has (an album by this artist with its title, case, accents, punctuation and version notes aside; Core's `libraryAlbumFinder`) reads **In your Library** in the furniture line: tap opens the Library album, long-press its album menu. Any other tile opens the YT Music album page (the Library's files for songs it has, as from Discover) and long-presses to the YT Music album menu (Play Next, Add to Queue, Download Album). A shelf with nothing on it isn't drawn. While Library items are being selected the tiles do nothing. The shelves come from the same saved artist page as the songs, so they show, and expire, with them.
- **Saved:** the answer is kept for a week. Opening the artist meanwhile shows the section straight away with no button; after a week the button is back and the section goes until it's tapped again. With YT Music off the section and the button are gone.

An album's page downloads it whole: after Play and Shuffle a third teal line-icon action, the album's first download entry named short (Core's `ytAlbumDownloadButton`): "Download" (download icon) while the Library lacks songs, "Cancel" (cross) while they're on their way, "Retry Failed" (refresh) once the batch has ended with failures, nothing once the Library has every song. While songs are on their way a Footnote teal line under the furniture says how far the album is ("Downloading · 3 of 10", tabular figures), and each song row keeps its own download line and rule. The system notification adds "N songs left" while more than one song is to come.

### Alphabet Spine (signature)

Wave's signature move: a thin column of tracked letters (Spine type, graphite) on the right, 24dp from the edge (`src/catalog/AlphabetSpine.tsx`, wired to a list by `src/library/useSpine.ts`).

- **Fixed places.** Every letter has its place, A to Z then `#` (where Core files names that start with a digit, a symbol or a non-Latin letter), so "M" sits at the same height in Artists, Albums and Songs and stays there after a scan. A list sorted Z to A gets the spine the same way up: `#`, then Z to A. A letter the list has is drawn; a missing one is a 2dp graphite dot that jumps to the next letter the list has (Core's `spineLayout`). Long lists only (24 rows and at least two letters, Core's `spineEntries`).
- **Fit.** Each place is 16dp tall when there is room. The spine is centred in the list's height above the floating chrome, and when 27 places don't fit they shrink and only every other (or every third…) present letter is drawn, the rest dots. Spine letters follow the system font size up to 1.3×, then thin out instead of overflowing.
- **Scrub.** The touch target is 48dp wide and the rows stay clear of it (see Layout). A touch on the spine jumps the list to the letter under the finger (Core's `spineSlotAt`) and moves on with it, once per letter change: a selection haptic, the letter on the spine turns teal, and the list jumps (no animated scroll: scrolling through thousands of rows on the way would trail the finger). The gesture runs on the UI thread; the JS thread only hears where the finger is and acts when the letter changes.
- **The plate.** Beside the finger, 16dp left of the touch target, an 80dp field square in the `fill` tone holds the letter (Display, ink), square like artwork and with no shadow. It follows the finger on the UI thread, centred on it and kept within the spine's height, and leaves the list in view so you see the rows you are landing on. It fades and grows in (from 92%) over the tap duration and fades out in half that; with reduce motion it only fades, and at 0 ms it appears and goes at once.
- **Accessibility.** A single adjustable control ("Alphabet index", hint "Swipe up or down to jump to a letter"). Increment and decrement step to the letter after or before the one at the top of the list on screen (Core's `spineStep`), and the new letter becomes the control's value and is announced. The plate is hidden from screen readers.

### Empty State

A 40dp line icon in pewter, an Entry-type title in ink, a Subheadline message in graphite, centred with generous top space. On the Library, empty cover slots in the field tone stand in for Recently Added until the first scan.

## Do's and Don'ts

### Do:

- **Do** size every margin, gap, row and tile from the 8dp cell (24dp margins, 16dp gutters, 56dp rows).
- **Do** take every neutral from the tone ramp and name it by its semantic token (`background`, `foreground`, `secondary`, `tertiary`, `separator`, `fill`).
- **Do** keep teal for active state and ember for favorite / now playing.
- **Do** rank list text by weight and tint at one size, and use tabular figures for counts, durations and furniture lines.
- **Do** reserve every row's leading, favorite and duration cells even when empty; mark the playing track on its title, not in a cell.
- **Do** build every tappable element on Press, so the owner's tap animation setting reaches it.
- **Do** keep draggable controls at least 24dp in from the screen edge, clear of the Back gesture zone.
- **Do** give every target at least 48dp, even when the drawn element is smaller.

### Don't:

- **Don't** put a screen on plain `#ffffff` or `#000000`.
- **Don't** round, frame or shadow artwork, or wrap it in a card. The only rounded images are artists' circles and the mini player's thumbnail, concentric with its pill.
- **Don't** use bold large titles; titles are weight 300.
- **Don't** add icons or chevrons to Library entry rows.
- **Don't** set text in `tertiary`.
- **Don't** add shadows, gradients or blur; separate with a ramp step or a hairline. Glass is for the floating chrome and dialog cards only, and the artwork gradient for the Now Playing ground only.
- **Don't** introduce a third accent colour. The destructive red is for Delete and Remove buttons only.
