# #729 Guards for the mechanical performance rules, and the size report

Ticket: #729 (parent #712). Branch `feat/729-perf-guards`, based on `origin/feat/712-faster-lighter`
at a6333827.

## What changed

- **Guards** (`apps/mobile/src/perf/performanceGuards.test.ts`, exceptions in
  `performancePolicy.ts`). Each compares exact owners (`path#declaration`) with a reviewed
  list, so a new site fails and a stale entry fails too:
  - Song rows: `SongRow` is drawn only by `useSongRows` (SongList, SongPreview, the lifted drag
    copy), the Queue's History and Up Next rows, and the Design preview. Core's `songRowView`
    runs only in `songs/songListModel.ts`. The per-screen rows #715 and #716 deleted
    (`TrackRow`, `YtSongRow`, `SwipeTrackRow` and the rest) can't be declared again.
  - Row subscriptions: a component named `…Row`, or anything in `songs/SongRow.tsx`, follows no
    whole set or whole state (playing ids, favorites, pending favorites, the song list's
    downloads, the journal, playback and queue state, scan progress), directly or through its
    own hooks, and names no whole store itself. One narrow per-id hook stays allowed.
  - Artwork URIs: only `catalog/artworkUri.ts` calls Core's `fileUri`; no other code has a
    `file://` or artwork-provider literal or sets an image `source`'s `uri` straight from
    `thumbPath`, `mediumPath` or `artworkPath`. `<Artwork uri={path}>` stays fine: Artwork
    resolves paths through the helper.
  - Buttons: every owner of a raw `Press`, or React Native's or Gesture Handler's
    `Pressable`/`Touchable…`, is `IconButton`, `TextButton` or a listed control whose face or
    gesture is its own (rows, tiles, links, the cover, lyric lines, the tab bar, developer
    screens), each with its reason.
  - How often: every whole-Library exception's `howOften` is filled in and names no per-event,
    per-download or per-focus trigger ("never per event" is a bound, not a trigger).
- **The audit** (`sourceAudit.mjs`) names a dependency's exports by package
  (`react-native#Pressable`) along its re-exports, records a seed used as a receiver
  (`queueState.get()`), returns its reference graph (`follows`), and adds `rowSubscriptions` and
  `handBuiltArtwork`.
- **Three buttons moved to `IconButton`**: Search's clear and Recap's Share slide and Close had
  `IconButton`'s exact face, so the guard would have flagged them. Same size, glyph, ink, haptic
  and depth (Recap's keep Press's 0.04). TalkBack now also hears them as enabled.
- **Size report** (`scripts/ci/app-size.ts`, budget in `scripts/ci/size-budget.json`). The
  Android APK job measures the APK and its `index.android.bundle` and puts a table in the sticky
  comment and in every run's summary (a release's too, which has no PR comment).

## Budgets

| What          | Measured from   | Bytes      | Budget (+5%)          |
| ------------- | --------------- | ---------- | --------------------- |
| APK (arm64)   | v0.33.5 release | 77,022,799 | 80,873,938 (80.87 MB) |
| Hermes bundle | v0.33.5 release | 16,833,905 | 17,675,600 (17.68 MB) |

Measured from the published `wave-0.33.5.apk` (the latest stable release when this landed): the
asset's size and the length of its `assets/index.android.bundle`. Over budget is a warning
(`::warning::` and ⚠️ in the table), never a failed build. Raise the budget by editing
`size-budget.json` with the release a new baseline comes from.

## Tests

- Each guard has planted offenders through the real APIs (one scan of only the planted files)
  and machinery fixtures in `sourceAudit.test.ts`: a row reaching a whole set through a hook, a
  store named by a row, a narrow hook reading a store (allowed), renamed and namespace imports
  of React Native's `Pressable`, artwork literals and raw paths against the helper and Artwork.
- `scripts/ci/app-size.test.ts`: the table, over-budget flags and warnings, the command's output
  file, and the saved budget's shape.
- The guards add one full scan of the sources (about 20 s on a loaded 8-core box) and one small
  planted scan (about 2 s) to `performanceGuards.test.ts`.

## Not verified

- No phone run: this ticket changes no runtime path except the three buttons. Their look,
  press feedback and TalkBack labels are for the owner's S24+ check (Search › type › Clear;
  Stats › a Recap › Share and Close).
- The size step hasn't run in CI yet; the first APK build on this branch's PR shows it.
