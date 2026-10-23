# Startup work after settlement (#595)

The app keeps the startup registration order: scan, link imports, YT-library
resume, followed by the existing sync/playlist/lookup registrations. Downloads
and background fill retain their service registration positions. Replacement
duplicate checks still require the launch scan and replacement journal to finish.

`lib/startupWork.ts` gates startup starts and each startup job's resumable turn
on WaveTiming's actual global settlement. First content alone, Home's local
payload readiness, and the old three-second content cap cannot release it.
After settlement it requires three consecutive quiet frame intervals (four
callbacks). A gap over 1.5 display intervals restarts the window. The native
refresh interval supports 30/60/90/120Hz; unavailable cadence falls back to 60Hz.
Navigation/backgrounding cancels outstanding frame/free-turn callbacks and
starts a fresh window after the next actual settlement. The gate has no idle
frame loop. The original Core touch-aware free-turn scheduler still supplies
one turn per callback. Existing gesture/headless `freeTurnEffect` consumers,
including #593's live taste and #594's work, retain their contracts.

The final #594 merge retains its existing `libraryFinderSteps` contract and
`settledTurnEffect`. Imports use the distinct `libraryImportFinderSteps`, which
also yields while matching individual title candidates. Neither replaces the
other owner's API.

CPU iterators use the existing `runSteps`: four ms of work plus two ms headroom
toward the six-ms JS target, with a 512-operation cap and iterator closure on
interruption. Scan normalization, reconciliation, membership/native-column
construction, import Library indexing/matching/completion, favorite selection,
duplicate pairing/history membership, and recorded-deletion classification yield per input. Scan saves split to one track/artwork
per atomic transaction; link imports append one song per transaction. Each successful append publishes a scoped burst, including a partial import stopped before completion. A restart
can repeat appends without duplicating entries. Replaced/dismissed imports
stop at the next turn and cannot overwrite a replacement's kept state. A YT
batch retains its offline pause, ordered sources, failed rows, and filled
Import & Download resumption. Filled imports build their download membership with the same stepped matcher, checking that their kept batch token is still current before dispatch. The downstream download service retains its own queue/journal lifecycle. Native read/merge errors retain the duplicate
check's existing next-launch retry policy.

An unchanged scan now skips `filesGone([])`: its whole-Library credit pruning
is unnecessary when no file changed or went missing. Changed scans retain
atomic pruning. Saved batch IDs still drive #593's targeted invalidations.
The first-content perf milestone, timing content/transition milestones and
#582's counters are unchanged. #592 still performs zero Home reads for its
first frame. #584 adds only the exact stepped import-index capability.

## Boundaries JavaScript cannot preempt

These are named exceptions, not six-ms promises:

- Synchronous Expo SQLite/drizzle source statements and row decoding:
  `knownFiles`, `indexedFiles`, `duplicateCheckFiles`, import `listSongs`,
  playlist/source/journal-setting reads. CPU indexing after these reads yields.
- Atomic store transactions: one track/artwork `saveBatch`, one entry
  `addToPlaylist` (including its held-entry source read), one favorite/pending
  favorite write, one duplicate's history merge and deletion record. Their
  SQL may still be expensive even with a one-item input.
- A changed scan's `filesGone` credit/orphan-pruning transaction and the scan's
  `linkPlaylistEntries` transaction. The latter matches and links a consistent
  source snapshot atomically. The unchanged cleanup is omitted entirely.
- Native `startScan` bridge marshalling/dispatch (the three JS input arrays
  now build in steps), one pair's `readAudioLengths`, individual recorded file
  deletion and the replacement journal's `jobsSnapshot`. Native scanning and
  decoding execute outside JS; bridge delivery remains indivisible.
- Native YT playlist source delivery, Spotify page transport/JSON delivery,
  synchronous KV JSON parse/stringify/storage and one native log append (including the final built-in string join of a recorded-deletion summary).
  Promise wrappers do not split these calls. Source readers retain their
  existing caps/uncapped-Liked-Songs policy; Spotify yields between pages.

A source call, one record with pathological metadata, GC or OS preemption can
exceed six ms. Desktop task maxima include these costs. Owner-exported ti logs
and device acceptance are pending; desktop measurements do not establish that
the first taps on the owner's phone have no startup-caused slow line.

## Desktop evidence

The extended `homeOpening` cold case loads the chosen revision's real
LibraryStore, Stats and Core. It uses current production startup effects when
available and a named faithful replay of ti's startup source/store sequence
otherwise. The scenario is an existing Library, unchanged incremental scan,
one retained 20-song Spotify link import, one kept YT-library source paused
offline and a due duplicate check with zero pairs. The duplicate source read
and pairing still visit the eligible Library files. Pair repair, scan changes,
interruption and retry are covered separately by actual store tests.

Inputs are 1,000/12,000/50,000 songs with 10,000/54,000/200,000 play events.
Fixture credit keys are normalized once before measurement to match production
filing; the import is reset outside each sample. Setup, source-module loading
and database seeding are excluded. Source SQL statements/returned rows, CPU,
complete synchronous task maxima and total synchronous JS time are reported.
Final playlist readback is included as a semantic verification read. The SHA-256
key covers the complete Home payloads and startup results and must agree across
before/after and repeated samples.

The replay serializes startup source stages to measure deterministic work;
production starts scan/import/resume in registration order without waiting for
each earlier job to complete. Native filesystem discovery emits no changed or
missing files in this scenario. Native audio/bridge time, Android services,
KV serialization, subscriber notifications, React/layout/native paint and the
real quiet/animation waits are excluded. `notifications: 0` means no subscribed
observer in the replay, not zero production invalidations. Controlled-clock
scheduler/job tests establish settlement and navigation ordering separately.

Run:

```sh
pnpm --filter @wave/mobile bench:fast-again --bench homeOpening --before <v0.19.0-ti worktree>
```

Numbers and revision identities are recorded in the #595 section of
`579-fast-again.md` and `results/595-homeOpening-desktop.jsonl`.
