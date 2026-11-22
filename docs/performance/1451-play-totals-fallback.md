# #1451 Read the play totals off the JS thread while the kept totals settle

Ticket: #1451 (parent #1432). Branch `feat/1451-play-totals-off-thread`.

## What held the thread

Until the kept play totals settle (`keptTotalsSettled`), "sum up played albums and artists" and
"sum up played artists" sum the history instead. Their statements already replay off the JS
thread, and the rows are mapped in steps (#1435, #1452). The summing, though, ran inside the
read's last pass: building the credit resolver, resolving every streamed song, summing albums and
artists and ranking them, all in one replay step. Resolving the streamed songs costs most of it.
On the desktop each song takes about 50 µs, and on a phone many times that.

## What changed

- `playedTotalsRead` (client) is the read alone. It gives the kept totals, or the rows to sum:
  credited totals, streamed totals and their songs, the Library's artists, albums and stored
  credits, and the downloaded songs' links. `playedTotalsSteps` turns it into the totals in
  Core's steps. Each stored credit, Library row, credited total and streamed song (resolved on
  its own step) gets a step, as does each ranked entry. Core gained
  `mergeCountedPlaysSteps`, `albumPlayTotalsSteps` and `artistPlayTotalsSteps` for it.
- `finishReplaySteps` (client, `offThreadReads.ts`) runs steps in slices of `REPLAY_STEP_MS`
  (8 ms) as replay steps, yielding between them. The block log names them "Library read replay".
- The Library store's two played-totals reads replay `playedTotalsRead`, then run its steps in
  those slices (`attemptStepped`). Desktop and the synchronous reads run the steps whole
  (`finishSteps`), so every reader gets the same totals.

## Numbers

`apps/mobile/bench/playedTotalsFallback.ts` covers 12,000 songs and their 90-day history, plus
4,000 streamed songs with four plays each. Every song is owed and the window is all time. The
numbers are desktop ones: Node with sql.js. Medians of 7 runs.

| Way                                    | JS held | Longest step |
| -------------------------------------- | ------- | ------------ |
| Before: the summing in the read's pass | 126 ms  | 99 ms        |
| After: the read, then steps in slices  | 115 ms  | 8 ms         |

The totals are equal both ways, and equal to the synchronous read's.

## Tests

- Core: the step variants give what the whole functions give, with a step per item.
- Client (`keptPlayTotals.test.ts`): while the kept totals settle, the stepped sum equals the
  settled kept totals in every window, downloads included. A replayed read plus its steps equals
  the synchronous read, settled and not, and the shared read is left as it was. Each streamed
  song adds steps of its own. `offThreadReads.test.ts`: slices stay within a replay step and
  yield between them.
- App (`databaseTests/offThreadReads.test.ts`): while the kept totals settle, both store reads
  give the synchronous store's totals off the thread, with no statement on the main connection.

## Not checked here

No block over 50 ms on the emulator. The seeded emulator (#1457) can check it, but that check
hasn't run on this change. The phone's timings need a phone.
