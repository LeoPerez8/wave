# ADR 0005: A collaborative playlist's rows stay in the owner's account

Date: 2026-11-20. Status: accepted. Spec: `docs/spec.md` (the collaborative playlists section, not
written yet). Research: `docs/shared-playlists.md`.

## Context

Every synced row is keyed `(account_id, id)`, and the change counter, the pull cursor and the row
caps are per account. A collaborative playlist is edited by several accounts, so its rows have to
merge in one place for all its members.

## Decision

- The playlist row and its entries stay in the owner's account, under the key they have today.
  Members hold no copy on the service.
- Making a playlist collaborative moves nothing. It creates a collaboration record with the member
  list; ending the collaboration deletes that record and leaves the rows where they are.
- A member pushes and pulls each collaborative playlist with requests of its own and a cursor per
  playlist. The service checks membership on each one.
- The owner's push and pull don't change. Members' changes land in the owner's account with the
  owner's change numbers.
- Each entry records the account that added it, written by the service from the session.

Turned down:

- A copy of the playlist in every member's account, kept equal by the service. It needs no
  protocol change, but storage grows with the member count and the service has to keep the copies
  equal.
- A partition per playlist, outside any account, with its own change counter and caps.

## Consequences

- Entries and tombstones count against the owner's row caps, so a member can fill them.
- Deleting the owner's account would delete the playlist for every member, so the service first
  moves the rows to the member who joined first, who becomes the owner. Moving rows between
  accounts happens only then.
- A member who is removed keeps only what is on their devices, as a private copy in their own
  account.
- A refused request (removed member, ended collaboration) stops that playlist only; the member's
  own account sync goes on.
- A member's desktop or older phone, which makes no per-playlist pull, receives nothing of the
  playlist.
