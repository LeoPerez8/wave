---
version: 1
slug: "src-app-tabs-library-tsx"
primary_target: "src/app/(tabs)/library.tsx"
related_targets: []
---

## Scope

Library tab (`src/app/(tabs)/library.tsx`) and its list/grid screens (Albums, Artists, Songs, Genres, Folders, Playlists, Favorites). Visitor mode: **Operate**. First surface of Wave's new visual world; Home, Search and Now Playing inherit it later.

## Audience and job

The owner, one-handed on the go, browsing a library of tens of thousands of local tracks to start playback fast. Must scroll at 120 Hz, start working mid-scan, and stay calm: no dense screens, no heavy effects (both explicit anti-goals). Fully custom components; system/predictive Back still works.

## Direction contract

THESIS: The library set like a record label's catalog (ECM's cover program): artwork in wide, calm fields, type small and exact. Refuses the category default of bold large titles, chevron rows and a single accent on black/white.

OWN-WORLD: Tinted ground, never plain white/black: fog blue-grey in light, night slate in dark. Every neutral snaps to one fixed tonal ramp tinted from that ground (raise, darkroom exposure record). Artwork is treated as photographs, square, no rounded "card" chrome. Labels are small tracked caps catalog lines; one deep-teal accent for active/progress, one ember for favorite/now playing. One cell module that the grid, rows and spine all snap to (raise, Crouwel specimen).

STORY: The owner sees their collection as a catalog worth browsing, knows where everything is at a glance, and gets from opening the tab to playing in two taps.

FIRST VIEWPORT: Quiet large title "Library" top-left; entry rows (Playlists, Artists, Albums, Songs, Genres, Folders, Favorites) as one-line catalog entries with hairline separators; below, "Recently Added" as a two-column artwork grid, each cover with a catalog line (ARTIST · Album) and the fixed furniture line (year · tracks · length) in the same place everywhere (raise, character catalog). In Songs, one type size per list, rank by weight and tint (raise, timetable rack); playing / favorite / missing-file each own a fixed cell in every row (raise, ticket wallet). Signature move: a thin letter-spaced A–Z spine on the right edge; every letter keeps a fixed place, and dragging it sets the letter on a quiet plate beside the finger, with a haptic tick per letter, while the list stays in view. Mini player and tab bar sit at the bottom in the same world.

FORM: The Quiet Catalog (ECM Records cover program), position 3 of 7 on the ordered list; assigned by the roll, chosen by the owner. Seed key 39cb8acf. Code-led (no image generation available).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Typeface: Inter is bundled but no longer binding; confirm or replace during the build (Operate surface, workhorse grotesk is fine).
- Exact palette values are proposals (#E4E9EA fog, #121A1F night slate, #2E8C80 teal, #D9822B ember) to be validated for contrast in the build.
- Glass: not part of this world by default; whether the mini player/tab bar get any blur is decided in the build against the 120 Hz budget.
- Every press feedback in this surface runs at the fixed 140 ms and respects reduce motion.
