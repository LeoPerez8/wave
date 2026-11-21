# ADR 0006: A removed playlist entry stays removed

Date: 2026-11-20. Status: accepted. Spec: `docs/spec.md` (the collaborative playlists section, not
written yet). Research: `docs/shared-playlists.md`.

## Context

`mergeRows` is last writer wins on the whole row, and a tombstone is a change like any other: an
edit stamped after a removal brings the row back. Between one person's phones that is rare. In a
collaborative playlist it means a member who moves a song without having seen another member's
removal puts the song back.

## Decision

- For playlist entries, a removal wins over any edit of the entry, whatever their times.
- Restore in the Graveyard and the undo right after removing are the only changes that bring an
  entry back. They bring back the same entry, at its kept position and with who added it.
- Between a restore and another removal, the later one wins.
- The rule holds for every playlist, collaborative or not, so the phone and the service keep one
  merge function with one behaviour.

Turned down: keeping the later change as the winner, which needs no new rule and lets a move
stamped after a removal revive the entry; and applying the rule to collaborative playlists only,
which makes the merge depend on the kind of playlist.

## Consequences

- Playlist entries are the one table where the later change does not always win. The merge has to
  tell a restore from any other edit of a removed entry.
- A move that loses to a removal disappears without notice; the song is in the Graveyard when it
  was removed by hand.
- An app released before this rule merges with the old one and can show an entry the service
  holds as removed.
