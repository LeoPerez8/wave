# #1529 An incremental scan that changes nothing doesn't link playlists again

Ticket #1529, part of #1528. Branch `feat/1529-skip-idle-playlist-link`.

## The owner's figures

On the reference phone (Xiaomi 25118PC98G, Wave 0.93.2-ti, 26 to 28 November), `read playlist
entries to link` ran after every incremental scan, including the ones that logged "0 read, 0
saved". It held JS for 2.4 s median, 5.1 s at most, and 34 s over 13 scans. None of those links
found an entry to link or drop.

## Cause

Since #1436 the scan's end has skipped the link when it saved nothing and playlists' entries
hadn't changed since the last link (Core's `scanEnd`). But the scan kept the revision that link
left (`linkedAtRevision`) only in memory, starting at null. So the first scan of each process
always linked. On this phone Wave's process often ends between uses, so most returns to Wave
began with a first scan. #1489 noted this gap.

## Change

- The whole-Library link (`LibraryStore.linkPlaylistEntries`) saves the entries' revision it left
  in the same transaction as its writes, in a reserved row of `playlist_revisions` (id -1,
  `markPlaylistsLinked`). No playlist uses that id and no trigger writes it, and the entries'
  revision (`selectPlaylistEntriesRevision`) sums only real playlists' rows. Revisions only rise,
  so "unchanged" means equal.
- The scan reads both numbers (`playlistLinkRevisions`), and Core's `scanEnd` decides. It links
  when the scan saved a file (new, changed or moved), when a file is gone, or when the entries'
  revision differs from the one kept (a sync, an import, or no link ever run on this Library). It
  skips the link otherwise, in this process or a later one.
- After the update, the first scan links once, since no revision is kept yet. Later scans that
  change nothing skip.
- A file gone now links too, as the ticket asks. Before, only a save did.

## Measurements

No emulator run was possible: `~/.android/avd/wave-run-903.avd` holds only `snapshots/` (no
config, so `emulator -list-avds` lists nothing), and `df -h /` showed 6.6 GB free, under the
12 GB `scripts/emulator-apk.sh` needs. The figures below are **desktop numbers** (Node 22 with
sql.js, base `61dfbf4ef` and this branch), not the phone's SQLite or Hermes:

`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/scanLink.ts`, on the
reference-size Library (`referenceSeed.ts`: 3,000 songs, 60 playlists, 26,700 entries). Each
launch gets a new store on the same Library, as a new process does. 7 launches each:

| End of a scan that changed nothing, per launch | Median   | Link ran |
| ---------------------------------------------- | -------- | -------- |
| Before (link on each process's first scan)     | 462.8 ms | 7 of 7   |
| After                                          | 0.4 ms   | 0 of 7   |

The PC's load average was 55 to 80 during the run, so the before figure is the order of the work
skipped, not a phone figure. The app test `apps/mobile/src/library/databaseTests/scanLink.test.ts`
covers the decision through the store on a real database. A new store on the same Library finds
no link due. Once an entry arrives, the link runs and the entry becomes the Library song.

The phone confirms this from the owner's next exported log on the `ti` release: after the first
scan following the update, a scan logged as "0 read, 0 saved" has no `Read "read playlist entries
to link"` line after it.
