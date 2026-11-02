# Release-date lookup (#929)

Run `node scripts/release-lookup/sample.ts` from the repository root to repeat the live sample. It makes sequential requests, waits at least one second before each request to either service, and stores only the response fields used for matching and dates. The checked-in recording is from 2026-11-02. Tests replay it without network access.

## Live coverage

40 deliberately selected well-known songs, including 20 Brazilian songs across MPB, samba, rock, sertanejo and recent pop. This is a coverage check, not a representative library or an accuracy benchmark.

- All songs: 36/40 (90%) had matching Deezer candidates; 34/40 (85%) had a MusicBrainz first-release date.
- Brazilian songs: 17/20 (85%) had candidates; 15/20 (75%) had a first-release date.
- Other songs: 19/20 (95%) had candidates and a first-release date.
- No service errors were encountered. No fallback album requests were made in this measurement, so these numbers exclude fallback coverage.

The existing matching rules retained more candidates than the parent's 7/10 sample; the filter was not loosened. Coverage is not correctness: Hey Jude still returned 1970; several Brazilian recordings had recent dates (Evidências: 2016, Anunciação: 2022, Asa Branca: 2010). They may describe later recordings or reflect incomplete MusicBrainz data. Manual correction remains necessary (#931).

The client serializes concurrent callers, spaces Deezer starts by 350 ms (under the documented 50 requests/5 seconds allowance), and spaces MusicBrainz starts by 1,000 ms. See [MusicBrainz's rate-limit and User-Agent requirements](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting) and [Deezer's API documentation](https://developers.deezer.com/api).

## Acceptance criteria

1. Met in client tests: serialized host allowances, MusicBrainz identifying User-Agent; live sample used an even slower cadence. Combined traffic from other Wave services was not measured on a phone.
2. Met: bounded ISRC queries, recursive splitting for HTTP 414 and saturated result sets, pagination even for a single ISRC with more than 100 recordings. Tests cover splitting and pagination.
3. Unverified on device: answers persist synchronously in SQLite KV storage, index dates survive rescans, and restart deadlines are covered through serialized Core values. A full kill/relaunch run was not performed.
4. Unverified on device: progress and offline/unavailable text are wired to the playlist header, disappear on completion, and are hidden outside Release date sort.
5. Unverified on device: a shared notice promise gates the first request and its dismissal is persisted. The sort button awaits the notice before changing the sort; restored/synced sorts use the same gate.
6. Met in implementation and eligibility/paused-client tests: only Release date playlists enter the worker; original/typed index dates skip lookup. New entries are discovered after playlist edits or the next 15-second read. #931 has not been built.
7. Met: unknown answers/fallbacks persist a 30-day retry deadline; service failures persist a one-minute deadline. Core tests check both across serialization. Retries are discovered within the next 15-second read while Wave runs.
8. Unverified on device: stable entry keys remain intact, row handlers use the displayed order, and visible-content anchoring is enabled under Release date. Touch, swipe and scroll behavior during live reordering needs a phone.
9. Met: Core owns matching, bounded batching, saturation decisions, date precedence and retry timing. node:test replays the recorded 40-song responses. HTTP transport tests cover pagination, query splitting, pacing and refusal recovery.
10. Met: new text is in both catalogues; app and Core literal-text checks pass with zero findings.
11. Met: docs/spec.md Network documents both services and their payloads.

The 2,000-song / approximately 11-minute target remains unverified; no device or large-library timing run was performed. #930 file-tag writing and #931 typed-date editing are intentionally absent. Each cached answer records `source` as first-release, year, album, unknown or failed; only first-release results are copied into the track's dedicated release-date index field. Fallbacks never enter that field or any file tag. Streamed entries use the same persistent answer cache for ordering and row years.

## Validation

- `pnpm typecheck`: passed (all workspace packages plus CI/performance scripts).
- Focused node:test run: 142 passed, 0 failed. Files: releaseLookup, playlistSongSort, lyricsAndGenre and untranslatedText in Core; releaseLookupClient, db/releaseDates, db/tracks, db/missingSongs and untranslatedText in mobile.
- Red/green cycles observed for candidate matching, batching and request timing, precedence/retry eligibility, database persistence, and concurrent request serialization.
- Full test suites and device tests were not run. No speed-budget failures occurred in the focused run.
