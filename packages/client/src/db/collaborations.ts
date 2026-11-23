/**
 * The collaborative playlists of the account signed in, as this device keeps them
 * (docs/spec.md, "Collaborative playlists"): which ones it is in and who else is, what it
 * does when its membership changes (Core's `membershipChanges`), the private copy a member
 * keeps when it ends, and what stays on this device alone (the changed mark, the private
 * copy's notice, the invite link it created). A member's playlist syncs through its own
 * requests (`sync/syncCycle.ts`); this keeps it out of the account's push and pull. Kept free
 * of Expo so the store tests run it against a real SQLite (`testDatabase.ts`).
 */
import {
  membershipChanges,
  privateCopyId,
  readCollaborationMember,
  type Collaboration,
  type CollaborationMember,
  type CreatedInvite,
  type HeldCollaboration,
  type PullMembership,
} from "@wave/core";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { stamped } from "./sync.ts";

/** A collaborative playlist of the account, as the device last heard of it. */
export interface CollaborativePlaylist {
  /** The playlist here; null while its first pull hasn't brought it. */
  readonly playlistId: number | null;
  readonly syncId: string;
  /** The account signed in owns it. */
  readonly owned: boolean;
  /** The owner first, then the others in the order they joined. */
  readonly members: readonly CollaborationMember[];
  /** A pull brought a change this device didn't make, and the playlist wasn't opened since. */
  readonly unseen: boolean;
}

const readMembers = (stored: string): CollaborationMember[] => {
  try {
    const members = JSON.parse(stored) as unknown;
    // Read as the service's are, so a member kept before photos were kept has none.
    return Array.isArray(members)
      ? members.flatMap((member: unknown) => readCollaborationMember(member) ?? [])
      : [];
  } catch {
    return [];
  }
};

/** Every collaborative playlist the account is in, as this device last heard. */
export const selectCollaborations = (db: LibraryDatabase): CollaborativePlaylist[] => {
  const { collaborations, playlists } = schema;
  return db
    .select({
      playlistId: playlists.id,
      syncId: collaborations.playlistSyncId,
      owned: collaborations.owned,
      members: collaborations.members,
      unseen: collaborations.unseen,
    })
    .from(collaborations)
    .leftJoin(playlists, eq(playlists.syncId, collaborations.playlistSyncId))
    .orderBy(collaborations.playlistSyncId)
    .all()
    .map((row) => ({ ...row, members: readMembers(row.members) }));
};

/** The collaborative playlists of other accounts this device syncs, each with its own cursor. */
export const selectMemberPlaylists = (
  db: LibraryDatabase,
): { readonly syncId: string; readonly cursor: string | null }[] => {
  const { collaborations } = schema;
  return db
    .select({ syncId: collaborations.playlistSyncId, cursor: collaborations.cursor })
    .from(collaborations)
    .where(eq(collaborations.owned, false))
    .orderBy(collaborations.playlistSyncId)
    .all();
};

const selectHeld = (db: LibraryDatabase): HeldCollaboration[] =>
  db
    .select({
      playlistId: schema.collaborations.playlistSyncId,
      owned: schema.collaborations.owned,
      ownerAccountId: schema.collaborations.ownerAccountId,
    })
    .from(schema.collaborations)
    .all();

/** Waiting rows of the playlist [syncId] (`sync_pending`), entries waiting for it included. */
const pendingOf = (syncId: string) => {
  const { syncPending } = schema;
  return or(
    eq(syncPending.playlistKey, syncId),
    and(
      eq(syncPending.kind, "playlistEntries"),
      sql`json_extract(${syncPending.row}, '$.playlistId') = ${syncId}`,
    ),
  );
};

/**
 * Takes the collaborative playlist [syncId] off this device, with its entries and what
 * waits for it, as nothing that goes up: its rows live in the owner's account.
 */
const removeHere = (tx: LibraryDatabase, syncId: string): void => {
  tx.delete(schema.playlists).where(eq(schema.playlists.syncId, syncId)).run();
  tx.delete(schema.syncPending).where(pendingOf(syncId)).run();
  tx.delete(schema.collaborations).where(eq(schema.collaborations.playlistSyncId, syncId)).run();
};

/**
 * The member's playlist [syncId] becomes their private copy: an ordinary playlist of their
 * own account with what this device had and the edits that never went up, under ids every
 * device of the account gives it (Core's `privateCopyId`), so the account holds one copy
 * however many devices make it. Removals that only tombstone go; the Graveyard stays. The
 * page says once that it is now the member's own (`selectPrivateCopyNotices`).
 */
export const makePrivateCopy = (db: LibraryDatabase, syncId: string): void =>
  db.transaction((tx) => copyPrivately(tx, syncId));

/** `makePrivateCopy` in the transaction [tx]. */
const copyPrivately = (tx: LibraryDatabase, syncId: string): void => {
  const { playlists, playlistItems, privateCopyNotices } = schema;
  const playlist = tx
    .select({ id: playlists.id })
    .from(playlists)
    .where(eq(playlists.syncId, syncId))
    .get();
  tx.delete(schema.syncPending).where(pendingOf(syncId)).run();
  tx.delete(schema.collaborations).where(eq(schema.collaborations.playlistSyncId, syncId)).run();
  if (playlist === undefined) return;
  tx.delete(playlistItems)
    .where(
      and(
        eq(playlistItems.playlistId, playlist.id),
        eq(playlistItems.deleted, true),
        isNull(playlistItems.removedAt),
      ),
    )
    .run();
  const entries = tx
    .select({ id: playlistItems.id, syncId: playlistItems.syncId })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlist.id))
    .all();
  for (const entry of entries) {
    tx.update(playlistItems)
      .set({
        syncId: privateCopyId(entry.syncId),
        libraryEntry: null,
        addedBy: null,
        pushed: false,
      })
      .where(eq(playlistItems.id, entry.id))
      .run();
  }
  tx.update(playlists)
    .set({ syncId: privateCopyId(syncId), pushed: false })
    .where(eq(playlists.id, playlist.id))
    .run();
  tx.insert(privateCopyNotices).values({ playlistId: playlist.id }).onConflictDoNothing().run();
};

/**
 * Brings the device's collaborative playlists in line with what an account pull states
 * ([membership], Core's `membershipChanges`): each one's members and owner kept, its own
 * pull started again when its owner changed, a playlist the account left taken off the
 * device, and one it was removed from, or whose owner ended or deleted it, kept as a private
 * copy, all in one transaction. True when a playlist here changed.
 */
export const applyMembership = (db: LibraryDatabase, membership: PullMembership): boolean => {
  const changes = membershipChanges(selectHeld(db), membership);
  const { collaborations } = schema;
  db.transaction((tx) => {
    for (const kept of changes.keep) {
      const values = {
        owned: kept.owned,
        ownerAccountId: kept.ownerAccountId,
        members: JSON.stringify(kept.members),
        ...(kept.restartPull ? { cursor: null } : {}),
      };
      tx.insert(collaborations)
        .values({ playlistSyncId: kept.playlistId, ...values, cursor: null })
        .onConflictDoUpdate({ target: collaborations.playlistSyncId, set: values })
        .run();
    }
    for (const syncId of changes.leave) removeHere(tx, syncId);
    for (const syncId of changes.forget) {
      tx.delete(collaborations).where(eq(collaborations.playlistSyncId, syncId)).run();
    }
    for (const syncId of changes.privateCopy) copyPrivately(tx, syncId);
  });
  return changes.leave.length > 0 || changes.privateCopy.length > 0;
};

/**
 * The owner's device made its playlist [playlistId] collaborative ([collaboration], the
 * service's answer): it keeps the record, and its Library entries go up again carrying
 * their songs' fields, for the other members to match their Tracks by.
 */
export const convertToCollaborative = (
  db: LibraryDatabase,
  playlistId: number,
  collaboration: Collaboration,
  now: number,
): void =>
  db.transaction((tx) => {
    const { collaborations, playlistItems } = schema;
    const values = {
      owned: true,
      ownerAccountId: collaboration.members.find((each) => each.owner)?.accountId ?? null,
      members: JSON.stringify(collaboration.members),
    };
    tx.insert(collaborations)
      .values({ playlistSyncId: collaboration.playlistId, ...values })
      .onConflictDoUpdate({ target: collaborations.playlistSyncId, set: values })
      .run();
    tx.update(playlistItems)
      .set(stamped(playlistItems, now))
      .where(
        and(
          eq(playlistItems.playlistId, playlistId),
          eq(playlistItems.deleted, false),
          isNotNull(playlistItems.trackId),
        ),
      )
      .run();
  });

/**
 * The member left the playlist [syncId] (the service took the leave): it goes from this
 * device. The account's other devices take it off at their next pull.
 */
export const leaveCollaborativePlaylist = (db: LibraryDatabase, syncId: string): void =>
  db.transaction((tx) => removeHere(tx, syncId));

/**
 * Signed out, or another account joined: the collaborative playlists of other accounts go
 * from this device until the account's next pull brings them back, and every record goes.
 * The account's own stay, as ordinary playlists until then.
 */
export const dropMemberPlaylists = (tx: LibraryDatabase): void => {
  const { collaborations } = schema;
  const members = tx
    .select({ syncId: collaborations.playlistSyncId })
    .from(collaborations)
    .where(eq(collaborations.owned, false))
    .all();
  for (const { syncId } of members) removeHere(tx, syncId);
  tx.delete(collaborations).run();
};

/** The playlist [playlistId] was opened: its changed mark goes, on this device. */
export const markCollaborationSeen = (db: LibraryDatabase, playlistId: number): void => {
  const { collaborations, playlists } = schema;
  db.update(collaborations)
    .set({ unseen: false })
    .where(
      eq(
        collaborations.playlistSyncId,
        sql`(SELECT ${playlists.syncId} FROM ${playlists} WHERE ${playlists.id} = ${playlistId})`,
      ),
    )
    .run();
};

/** The playlists that became a private copy and whose page hasn't said so yet. */
export const selectPrivateCopyNotices = (db: LibraryDatabase): number[] =>
  db
    .select({ id: schema.privateCopyNotices.playlistId })
    .from(schema.privateCopyNotices)
    .all()
    .map((row) => row.id);

/** The page said once that the playlist [playlistId] is now the member's own copy. */
export const dismissPrivateCopyNotice = (db: LibraryDatabase, playlistId: number): void => {
  db.delete(schema.privateCopyNotices)
    .where(eq(schema.privateCopyNotices.playlistId, playlistId))
    .run();
};

/**
 * Keeps the invite link this device just created for the playlist [syncId] (null: it was
 * turned off). Only the device that creates a link ever holds its address.
 */
export const keepInviteLink = (
  db: LibraryDatabase,
  syncId: string,
  invite: CreatedInvite | null,
): void => {
  db.update(schema.collaborations)
    .set({ inviteUrl: invite?.url ?? null, inviteExpiresAt: invite?.expiresAt ?? null })
    .where(eq(schema.collaborations.playlistSyncId, syncId))
    .run();
};

/** The invite link this device created for the playlist [syncId], if it holds one. */
export const selectInviteLink = (db: LibraryDatabase, syncId: string): CreatedInvite | null => {
  const row = db
    .select({
      url: schema.collaborations.inviteUrl,
      expiresAt: schema.collaborations.inviteExpiresAt,
    })
    .from(schema.collaborations)
    .where(eq(schema.collaborations.playlistSyncId, syncId))
    .get();
  return row?.url == null || row.expiresAt === null
    ? null
    : { url: row.url, expiresAt: row.expiresAt };
};

/**
 * The members the service just listed for a playlist this device holds a record of
 * ([collaboration], Members' answer or a removal's re-read): the menu counts them in its
 * questions until the next account pull.
 */
export const keepCollaborationMembers = (
  db: LibraryDatabase,
  collaboration: Collaboration,
): void => {
  db.update(schema.collaborations)
    .set({ members: JSON.stringify(collaboration.members) })
    .where(eq(schema.collaborations.playlistSyncId, collaboration.playlistId))
    .run();
};

/**
 * The owner ended the collaboration of the playlist [syncId] (the service took it): its record
 * and invite link go now, and the playlist stays the owner's as it is. The next account pull
 * says the same (`forget`).
 */
export const forgetCollaboration = (db: LibraryDatabase, syncId: string): void => {
  db.delete(schema.collaborations).where(eq(schema.collaborations.playlistSyncId, syncId)).run();
};
