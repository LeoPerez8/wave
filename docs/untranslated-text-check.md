# Untranslated text check

Run from the repository root (Node and workspace dev dependencies installed):

```sh
node scripts/ci/untranslated-text-report.ts
TEXT_CHECK_PATH=apps/mobile/src/home/ node scripts/ci/untranslated-text-report.ts
TEXT_CHECK_PATH=packages/core/src/homeSections.ts node scripts/ci/untranslated-text-report.ts
node --test apps/mobile/src/untranslatedText.test.ts packages/core/src/untranslatedText.test.ts
TEXT_CHECK_STRICT=1 node --test apps/mobile/src/untranslatedText.test.ts packages/core/src/untranslatedText.test.ts
```

`TEXT_CHECK_PATH` is a repository-relative path prefix, for a file or folder. The
app and Core tests include the guards automatically. Report mode prints each
file's count and locations, then a total, and passes. Strict mode ignores path
filters and fails on findings. Launch changes `STRICT_UNTRANSLATED_TEXT` in
`scripts/ci/untranslated-text-report.ts` to `true`; the environment flag lets you
verify that behavior before launch.

The AST scanner checks Text-like children, visible property values, and toast,
alert and confirm arguments. In Core it also checks English-shaped literals in
return statements and arrow expressions. The scanner follows conditional and
concatenated values, but does not trace identifiers, imports or function calls.
Review indirect text and native resources during each translation ticket too.
Brand-only text, symbols/numbers, catalogue files, logs and error constructors
are excluded. `TEXT_ALLOWLIST` in `scripts/ci/untranslated-text.mjs` lists private
dev screens, diagnostic builders and geometry explicitly. Keep production UI
out of that list. Fixtures live under `scripts/ci/fixtures/untranslated-text`.

## Starting counts for the merger's PR description

Measured against integration `d8536886` on 29 October 2026, before area translation
tickets land. Counts are findings, not unique catalogue entries. They are a
starting inventory for #784–#788. No PR was opened, as the implementer brief
requires the merger to handle that.

| Area (path prefix)           | Findings |
| ---------------------------- | -------: |
| `apps/mobile/src/app`        |       80 |
| `apps/mobile/src/catalog`    |       17 |
| `apps/mobile/src/chrome`     |        1 |
| `apps/mobile/src/components` |       11 |
| `apps/mobile/src/home`       |       28 |
| `apps/mobile/src/library`    |      122 |
| `apps/mobile/src/log`        |        6 |
| `apps/mobile/src/nowPlaying` |       98 |
| `apps/mobile/src/overlay`    |        3 |
| `apps/mobile/src/playback`   |       11 |
| `apps/mobile/src/preview`    |        7 |
| `apps/mobile/src/recognize`  |        2 |
| `apps/mobile/src/search`     |        7 |
| `apps/mobile/src/selection`  |        6 |
| `apps/mobile/src/settings`   |      121 |
| `apps/mobile/src/share`      |       16 |
| `apps/mobile/src/stats`      |       41 |
| `apps/mobile/src/ytmusic`    |       12 |
| `packages/core/src`          |      309 |
| Total                        |      898 |

Core breakdown by module (use the same path filter):

| Module                                               | Findings |
| ---------------------------------------------------- | -------: |
| `packages/core/src/alert.ts`                         |        2 |
| `packages/core/src/appearance.ts`                    |        3 |
| `packages/core/src/artistStats.ts`                   |        2 |
| `packages/core/src/auto.ts`                          |        8 |
| `packages/core/src/backgroundFill.ts`                |        1 |
| `packages/core/src/blackPlayer.ts`                   |        3 |
| `packages/core/src/discoverMixes.ts`                 |        1 |
| `packages/core/src/downloadGroups.ts`                |        1 |
| `packages/core/src/downloadRun.ts`                   |        7 |
| `packages/core/src/downloadSource.ts`                |        6 |
| `packages/core/src/explicitPlayback.ts`              |        4 |
| `packages/core/src/favoriteToast.ts`                 |        2 |
| `packages/core/src/findInPlaylist.ts`                |        5 |
| `packages/core/src/followedArtists.ts`               |        2 |
| `packages/core/src/homeSections.ts`                  |       11 |
| `packages/core/src/importBatchLine.ts`               |        2 |
| `packages/core/src/importProgress.ts`                |        6 |
| `packages/core/src/launchLogo.ts`                    |        1 |
| `packages/core/src/launchTheme.ts`                   |        1 |
| `packages/core/src/launcherIcon.ts`                  |        5 |
| `packages/core/src/libraryShelf.ts`                  |        1 |
| `packages/core/src/lyricsAndGenre.ts`                |       24 |
| `packages/core/src/lyricsShare.ts`                   |        1 |
| `packages/core/src/m3u.ts`                           |        8 |
| `packages/core/src/magicQueue.ts`                    |        1 |
| `packages/core/src/mixRefresh.ts`                    |        1 |
| `packages/core/src/mixSliders.ts`                    |       10 |
| `packages/core/src/networkUse.ts`                    |        5 |
| `packages/core/src/playlistEntries.ts`               |        4 |
| `packages/core/src/playlistImport.ts`                |       13 |
| `packages/core/src/playlistLayout.ts`                |        3 |
| `packages/core/src/playlistLinks.ts`                 |        3 |
| `packages/core/src/playlistRecommendationSession.ts` |        5 |
| `packages/core/src/playlistShare.ts`                 |        9 |
| `packages/core/src/playlistSort.ts`                  |        4 |
| `packages/core/src/playlists.ts`                     |        9 |
| `packages/core/src/qualityReplacement.ts`            |        9 |
| `packages/core/src/recognize.ts`                     |       12 |
| `packages/core/src/replacementDuplicates.ts`         |        5 |
| `packages/core/src/searchAllowance.ts`               |        9 |
| `packages/core/src/settingsPages.ts`                 |       16 |
| `packages/core/src/sleepTimer.ts`                    |        3 |
| `packages/core/src/songDeletion.ts`                  |       12 |
| `packages/core/src/songRowView.ts`                   |        3 |
| `packages/core/src/songSort.ts`                      |        1 |
| `packages/core/src/spotifyLibrary.ts`                |        1 |
| `packages/core/src/stats.ts`                         |        4 |
| `packages/core/src/statsSeeAll.ts`                   |        3 |
| `packages/core/src/swipeActions.ts`                  |        1 |
| `packages/core/src/syncWire.ts`                      |        1 |
| `packages/core/src/themeChoice.ts`                   |       25 |
| `packages/core/src/throttledFailures.ts`             |        2 |
| `packages/core/src/tryAgainUnavailable.ts`           |        1 |
| `packages/core/src/unsearchedPlaying.ts`             |        3 |
| `packages/core/src/waveAccount.ts`                   |        9 |
| `packages/core/src/ytDownload.ts`                    |        1 |
| `packages/core/src/ytDownloads.ts`                   |        9 |
| `packages/core/src/ytLibraryBatch.ts`                |        2 |
| `packages/core/src/ytPlaylist.ts`                    |        2 |
| `packages/core/src/ytQueue.ts`                       |        1 |
