# #724 Downloads, Discover and background fill

Ticket #724, parent #712. Branch `feat/724-repeated-work`, based on
`origin/feat/712-faster-lighter` at `874fb375`.

## Budgets and scenarios

Download recovery must read only completed jobs' candidate files and recordings, once after
a run finishes. Progress polls and individual landings during a run must issue zero recovery
queries. A later Library edit may trigger one new recovery read. The desktop fixture has
1,000 unrelated songs; its moved-file, alias and deleted-file recovery returns fewer than ten
candidate rows and uses the recording-title index.

Discover registers one focus worker per screen. With artist and genre rows shown together,
one focus warms the known videos, Library and graph once. Ordinary rerenders do no focus work;
turning YT Music off suppresses it. A newly known played-state input retains the existing
refresh behavior. Queue section actions must return exactly the Songs tab's SQL order for
every saved sort, including missing songs and ties.

Background fill must wait for a free turn before reading its playlists. A settled search
removes its key's occurrences from the index, without computing unrelated song keys again.
The existing one-search-per-second pace, failure order and refusal pauses remain in force.
These are work budgets, not measured phone latency claims.

For the owner's S24+ run, keep the same Library, downloaded jobs, playlists, Home arrangement,
YT Music settings, saved mixes and song sort in both builds. Use #546's release-build and
hardware preflight procedure. Capture startup, tab switches, Queue and imported-playlist
navigation in idle and import variants:

```sh
node scripts/perf/perf.ts run --serial <phone> --apk <release.apk> \
  --commit <source-sha> --scenario startup,tab-switch,queue,push-playlist \
  --playlist "<visible imported playlist>" --variant idle,import --label 724-before
```

Use the corresponding after label on the changed build. Confirm scenario names with
`node scripts/perf/perf.ts scenarios`. Also record a completed multi-song download run with
Library edits afterwards, repeated Home/Library Discover focus, all Songs sort choices through
Play/queue section, and an unsearched playlist settling while the phone is in use.
Compare first-frame/response latency, long tasks and frames against the repeated baseline;
any latency/frame budget set by #713 applies. #546 supplies no numeric S24+ baseline, so this
ticket does not invent one.

## Before

Phone measurements pending the owner's S24+ run. Source baseline `874fb375` rereads the whole
Library as downloads land, registers the same Discover focus work in both mix-row hooks,
sorts Songs section rows in JavaScript, and filters every playlist's songs after a fill answer.

## After

Phone measurements pending the owner's S24+ run. No device before/after improvement claimed.

Desktop verification uses Node and sql.js, not Hermes or Android SQLite. Targeted store tests
cover candidate reads and every SQL sort; work-count tests cover completed-run coalescing,
read failures and stale answers, focus registrations, shared finder identities and free-turn
playlist reads. Core tests cover indexed settlement and unchanged fill order/pauses. Existing
source guards retain exact owners and include the new `listSortedSongs` capability.

## Behavior kept and limits

Moved or retagged files, recording aliases, missing-song identity and download generations
retain the existing recovery rules. Artist pages prefer their own just-downloaded rows;
scoped finders do not replace the known full-Library finder. Rows, menus, sorting choices,
refresh affordances and fill search priority are unchanged.

The owner still needs to check the download UI, Discover refresh and section playback order
on the S24+. Synchronous SQL statements and building a fresh playlist index remain indivisible;
this change schedules their read on a free turn, without claiming a hardware time limit.
No phone, emulator or native build was run for this JavaScript-only ticket.
