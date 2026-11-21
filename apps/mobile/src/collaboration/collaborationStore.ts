import type { Collaboration, CreatedInvite } from "@wave/core";
import {
  convertToCollaborative,
  forgetCollaboration,
  keepCollaborationMembers,
  keepInviteLink,
  leaveCollaborativePlaylist,
  selectCollaborations,
  selectInviteLink,
  type CollaborativePlaylist,
} from "@wave/client/db/collaborations";
import type { LibraryDatabase } from "@wave/client/db/database";
import * as Effect from "effect/Effect";

/**
 * What a playlist's menu reads and writes of the account's collaborative playlists on this
 * device (`@wave/client`'s `db/collaborations.ts`): the Library store hands it out as
 * `collaborations`, its errors [E] the store's own, so the menu reaches the store without a method per call.
 */
export interface CollaborationStore<E> {
  readonly list: Effect.Effect<readonly CollaborativePlaylist[], E>;
  readonly convert: (playlistId: number, collaboration: Collaboration) => Effect.Effect<void, E>;
  readonly keepMembers: (collaboration: Collaboration) => Effect.Effect<void, E>;
  readonly forget: (syncId: string) => Effect.Effect<void, E>;
  readonly leave: (syncId: string) => Effect.Effect<void, E>;
  readonly inviteLink: (syncId: string) => Effect.Effect<CreatedInvite | null, E>;
  readonly keepInviteLink: (syncId: string, invite: CreatedInvite | null) => Effect.Effect<void, E>;
}

/** The calls over [db], each failing with what it was doing. */
export const collaborationStore = <E>(
  db: LibraryDatabase,
  fail: (operation: string, cause: unknown) => E,
): CollaborationStore<E> => {
  const run = <A>(operation: string, call: () => A) =>
    Effect.try({ try: call, catch: (cause) => fail(operation, cause) });
  return {
    list: Effect.suspend(() =>
      run("read the collaborative playlists", () => selectCollaborations(db)),
    ),
    convert: (playlistId, collaboration) =>
      run("make the playlist collaborative", () =>
        convertToCollaborative(db, playlistId, collaboration, Date.now()),
      ),
    keepMembers: (collaboration) =>
      run("keep the members", () => keepCollaborationMembers(db, collaboration)),
    forget: (syncId) => run("end the collaboration", () => forgetCollaboration(db, syncId)),
    leave: (syncId) => run("leave the playlist", () => leaveCollaborativePlaylist(db, syncId)),
    inviteLink: (syncId) => run("read the invite link", () => selectInviteLink(db, syncId)),
    keepInviteLink: (syncId, invite) =>
      run("keep the invite link", () => keepInviteLink(db, syncId, invite)),
  };
};
