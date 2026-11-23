/**
 * The collaboration record of a playlist (docs/spec.md, "Collaborative
 * playlists"; docs/adr/0005): the playlist's rows stay in the owner's
 * account, and the record names the owner and the members with when each
 * joined. The owner is a member too.
 *
 * A playlist id names one collaboration in the whole service. An account
 * that stops being a member without having owned the playlist gets an end
 * record, which its pulls carry until it joins the playlist again.
 */

import type { Client, InStatement, ResultSet, Transaction } from "@libsql/client";

/** A member as the other members see it: the Google account's name and photo, never its email. */
export interface CollaborationMember {
  readonly accountId: string;
  /** Null for an account the service has no name for. */
  readonly name: string | null;
  /** The Google account's photo (`@wave/core`'s `accountPhotoUrl`); null when it has none. */
  readonly photoUrl: string | null;
  readonly joinedAt: number;
  readonly owner: boolean;
  /** Whether it's the account that asked. */
  readonly self: boolean;
}

/** A collaborative playlist: its owner first, then the others in the order they joined. */
export interface Collaboration {
  readonly playlistId: string;
  readonly members: readonly CollaborationMember[];
}

/**
 * Why an account is no longer in a playlist: it left, or the collaboration
 * ended for it (the owner removed it or ended the collaboration; the
 * record doesn't say which).
 */
export type CollaborationEndReason = "left" | "ended";

export interface EndedCollaboration {
  readonly playlistId: string;
  readonly reason: CollaborationEndReason;
  readonly endedAt: number;
}

/** Why a request about a collaboration is refused. */
export type CollaborationRefusal =
  /** The playlist isn't collaborative, or the account isn't in it: the two look the same. */
  | "not_member"
  | "not_owner"
  /** The owner can't leave or be removed; ending the collaboration is theirs. */
  | "owner_cannot_leave"
  /** The account to remove isn't in the playlist. */
  | "not_found";

const MEMBER_COLUMNS = `m.playlist_id, m.account_id, m.joined_at, a.name, a.photo_url,
                        m.account_id = c.owner_id AS owner`;
const MEMBER_ORDER = "m.playlist_id, owner DESC, m.joined_at, m.account_id";

const membersFrom = (result: ResultSet | undefined, accountId: string): Collaboration[] => {
  const byPlaylist = new Map<string, CollaborationMember[]>();
  for (const row of result?.rows ?? []) {
    const playlistId = String(row.playlist_id);
    const members = byPlaylist.get(playlistId) ?? [];
    byPlaylist.set(playlistId, members);
    members.push({
      accountId: String(row.account_id),
      name: typeof row.name === "string" ? row.name : null,
      photoUrl: typeof row.photo_url === "string" ? row.photo_url : null,
      joinedAt: Number(row.joined_at),
      owner: Number(row.owner) === 1,
      self: row.account_id === accountId,
    });
  }
  return [...byPlaylist].map(([playlistId, members]) => ({ playlistId, members }));
};

/** The members of [playlistId], when [accountId] is one of them (no rows otherwise). */
const membersSeenBy = (playlistId: string, accountId: string): InStatement => ({
  sql: `SELECT ${MEMBER_COLUMNS}
        FROM collaborations c
        JOIN collaboration_members m ON m.playlist_id = c.playlist_id
        LEFT JOIN accounts a ON a.id = m.account_id
        WHERE c.playlist_id = ?
          AND EXISTS (SELECT 1 FROM collaboration_members mine
                      WHERE mine.playlist_id = c.playlist_id AND mine.account_id = ?)
        ORDER BY ${MEMBER_ORDER}`,
  args: [playlistId, accountId],
});

/**
 * The two statements a pull adds to its snapshot: every collaboration
 * [accountId] is in, and its end records. `readMembership` reads their results.
 */
export const membershipStatements = (accountId: string): InStatement[] => [
  {
    sql: `SELECT ${MEMBER_COLUMNS}
          FROM collaboration_members mine
          JOIN collaborations c ON c.playlist_id = mine.playlist_id
          JOIN collaboration_members m ON m.playlist_id = c.playlist_id
          LEFT JOIN accounts a ON a.id = m.account_id
          WHERE mine.account_id = ?
          ORDER BY ${MEMBER_ORDER}`,
    args: [accountId],
  },
  {
    sql: `SELECT playlist_id, reason, ended_at FROM collaboration_ends
          WHERE account_id = ? ORDER BY ended_at, playlist_id`,
    args: [accountId],
  },
];

/** What an account's pull says of collaborative playlists. */
export interface Membership {
  readonly collaborations: readonly Collaboration[];
  readonly endedCollaborations: readonly EndedCollaboration[];
}

export const readMembership = (
  [members, ends]: readonly (ResultSet | undefined)[],
  accountId: string,
): Membership => ({
  collaborations: membersFrom(members, accountId),
  endedCollaborations: (ends?.rows ?? []).map((row) => ({
    playlistId: String(row.playlist_id),
    reason: row.reason === "left" ? "left" : "ended",
    endedAt: Number(row.ended_at),
  })),
});

/**
 * [accountId]'s part in [playlistId]: one row with `owner` when it's a member.
 * `roleOf` reads it.
 */
export const role = (playlistId: string, accountId: string): InStatement => ({
  sql: `SELECT c.owner_id = m.account_id AS owner
        FROM collaborations c
        JOIN collaboration_members m ON m.playlist_id = c.playlist_id
        WHERE c.playlist_id = ? AND m.account_id = ?`,
  args: [playlistId, accountId],
});

export const roleOf = (result: ResultSet | undefined): "owner" | "member" | null => {
  const row = result?.rows[0];
  return row === undefined ? null : Number(row.owner) === 1 ? "owner" : "member";
};

/**
 * [accountId]'s part in [playlistId], for the routes that check membership
 * or ownership: null when the playlist isn't collaborative or the account
 * isn't in it.
 */
export const collaborationRole = async (
  db: Client,
  playlistId: string,
  accountId: string,
): Promise<"owner" | "member" | null> => roleOf(await db.execute(role(playlistId, accountId)));

/**
 * Makes [playlistId] of [accountId] collaborative, with the account as its
 * owner and only member; one that already is stays as it is. Refused when
 * the account holds no such playlist (`no_playlist`), or when the id already
 * names another account's collaboration (`taken`).
 */
export const makeCollaboration = async (
  db: Client,
  playlistId: string,
  accountId: string,
  at: number,
): Promise<Collaboration | "no_playlist" | "taken"> => {
  const held = `EXISTS (SELECT 1 FROM playlists
                        WHERE account_id = ? AND id = ? AND deleted = 0)`;
  const [, , playlist, , members] = await db.batch(
    [
      {
        sql: `INSERT INTO collaborations (playlist_id, owner_id, created_at)
              SELECT ?, ?, ? WHERE ${held}
              ON CONFLICT (playlist_id) DO NOTHING`,
        args: [playlistId, accountId, at, accountId, playlistId],
      },
      {
        sql: `INSERT INTO collaboration_members (playlist_id, account_id, joined_at)
              SELECT playlist_id, owner_id, ? FROM collaborations
              WHERE playlist_id = ? AND owner_id = ? AND ${held}
              ON CONFLICT (playlist_id, account_id) DO NOTHING`,
        args: [at, playlistId, accountId, accountId, playlistId],
      },
      { sql: `SELECT ${held} AS held`, args: [accountId, playlistId] },
      // Entries stored before the service named who added them are the owner's.
      {
        sql: `UPDATE playlist_entries SET added_by = ?
              WHERE account_id = ? AND playlist_id = ? AND added_by IS NULL
                AND EXISTS (SELECT 1 FROM collaborations WHERE playlist_id = ? AND owner_id = ?)`,
        args: [accountId, accountId, playlistId, playlistId, accountId],
      },
      membersSeenBy(playlistId, accountId),
    ],
    "write",
  );
  if (Number(playlist?.rows[0]?.held) !== 1) return "no_playlist";
  const made = membersFrom(members, accountId)[0];
  const owner = made?.members.find((member) => member.owner);
  return made === undefined || owner?.self !== true ? "taken" : made;
};

/** The members of [playlistId], for one of them. */
export const collaborationMembers = async (
  db: Client,
  playlistId: string,
  accountId: string,
): Promise<Collaboration | "not_member"> =>
  membersFrom(await db.execute(membersSeenBy(playlistId, accountId)), accountId)[0] ?? "not_member";

/** Records that the collaborations matching [where] ended at [at] for their members who aren't the owner. */
const endForOthers = (where: string, args: readonly string[], at: number): InStatement => ({
  sql: `INSERT OR REPLACE INTO collaboration_ends (account_id, playlist_id, reason, ended_at)
        SELECT m.account_id, m.playlist_id, 'ended', ?
        FROM collaborations c
        JOIN collaboration_members m ON m.playlist_id = c.playlist_id
        WHERE ${where} AND m.account_id <> c.owner_id`,
  args: [at, ...args],
});

/**
 * The statements that end the collaboration of [playlistId] when [ownerId]
 * owns it: the record and its members and invites go, and the other members
 * get an end record at [at]. Nothing changes for a playlist it doesn't own.
 */
export const endOwnedCollaboration = (
  playlistId: string,
  ownerId: string,
  at: number,
): InStatement[] => {
  const owned = "c.playlist_id = ? AND c.owner_id = ?";
  return [
    endForOthers(owned, [playlistId, ownerId], at),
    {
      sql: `DELETE FROM collaboration_members
            WHERE playlist_id IN (SELECT c.playlist_id FROM collaborations c WHERE ${owned})`,
      args: [playlistId, ownerId],
    },
    {
      sql: `DELETE FROM collaboration_invites
            WHERE playlist_id IN (SELECT c.playlist_id FROM collaborations c WHERE ${owned})`,
      args: [playlistId, ownerId],
    },
    {
      sql: "DELETE FROM collaborations WHERE playlist_id = ? AND owner_id = ?",
      args: [playlistId, ownerId],
    },
  ];
};

/**
 * Ends the collaboration of [playlistId], for its owner: the record and its
 * members go, the others get an end record, and the playlist's rows stay as
 * they are.
 */
export const endCollaboration = async (
  db: Client,
  playlistId: string,
  accountId: string,
  at: number,
): Promise<CollaborationRefusal | null> => {
  const [asked] = await db.batch(
    [role(playlistId, accountId), ...endOwnedCollaboration(playlistId, accountId, at)],
    "write",
  );
  const part = roleOf(asked);
  return part === "owner" ? null : part === null ? "not_member" : "not_owner";
};

/**
 * Takes [accountId] out of [playlistId] with an end record saying [reason],
 * when [condition] holds for the collaboration `c` and the account isn't its owner.
 */
const takeOut = (
  playlistId: string,
  accountId: string,
  reason: CollaborationEndReason,
  at: number,
  condition: string,
  conditionArgs: readonly string[],
): InStatement[] => {
  const member = `FROM collaborations c
                  JOIN collaboration_members m ON m.playlist_id = c.playlist_id
                  WHERE c.playlist_id = ? AND m.account_id = ? AND m.account_id <> c.owner_id
                    AND ${condition}`;
  const args = [playlistId, accountId, ...conditionArgs];
  return [
    {
      sql: `INSERT OR REPLACE INTO collaboration_ends (account_id, playlist_id, reason, ended_at)
            SELECT m.account_id, m.playlist_id, ?, ? ${member}`,
      args: [reason, at, ...args],
    },
    {
      sql: `DELETE FROM collaboration_members
            WHERE playlist_id = ? AND account_id = ? AND EXISTS (SELECT 1 ${member})`,
      args: [playlistId, accountId, ...args],
    },
  ];
};

/** Removes [memberId] from [playlistId], for its owner [accountId], and ends its active invite link. */
export const removeMember = async (
  db: Client,
  playlistId: string,
  accountId: string,
  memberId: string,
  at: number,
): Promise<CollaborationRefusal | null> => {
  const [asked, , , removed] = await db.batch(
    [
      role(playlistId, accountId),
      {
        sql: `UPDATE collaboration_invites SET state = 'ended'
              WHERE playlist_id = ? AND state = 'active'
                AND EXISTS (SELECT 1 FROM collaborations c
                            JOIN collaboration_members m ON m.playlist_id = c.playlist_id
                            WHERE c.playlist_id = ? AND c.owner_id = ?
                              AND m.account_id = ? AND m.account_id <> c.owner_id)`,
        args: [playlistId, playlistId, accountId, memberId],
      },
      ...takeOut(playlistId, memberId, "ended", at, "c.owner_id = ?", [accountId]),
    ],
    "write",
  );
  const part = roleOf(asked);
  if (part === null) return "not_member";
  if (part === "member") return "not_owner";
  if (memberId === accountId) return "owner_cannot_leave";
  return removed?.rowsAffected === 1 ? null : "not_found";
};

/** Takes [accountId] out of [playlistId] at its own request; the owner can't leave. */
export const leaveCollaboration = async (
  db: Client,
  playlistId: string,
  accountId: string,
  at: number,
): Promise<CollaborationRefusal | null> => {
  const [asked] = await db.batch(
    [role(playlistId, accountId), ...takeOut(playlistId, accountId, "left", at, "1", [])],
    "write",
  );
  const part = roleOf(asked);
  return part === "member" ? null : part === null ? "not_member" : "owner_cannot_leave";
};

/**
 * Makes [accountId] a member of [playlistId] from [at], and drops its end
 * record for that playlist; an account already in it keeps when it joined.
 * False when the playlist isn't collaborative. The caller decides who may join.
 */
export const addMember = async (
  db: Client,
  playlistId: string,
  accountId: string,
  at: number,
): Promise<boolean> => {
  const [, , joined] = await db.batch(
    [
      {
        sql: `INSERT INTO collaboration_members (playlist_id, account_id, joined_at)
              SELECT playlist_id, ?, ? FROM collaborations WHERE playlist_id = ?
              ON CONFLICT (playlist_id, account_id) DO NOTHING`,
        args: [accountId, at, playlistId],
      },
      {
        sql: `DELETE FROM collaboration_ends
              WHERE account_id = ? AND playlist_id = ?
                AND EXISTS (SELECT 1 FROM collaborations WHERE playlist_id = ?)`,
        args: [accountId, playlistId, playlistId],
      },
      role(playlistId, accountId),
    ],
    "write",
  );
  return roleOf(joined) !== null;
};

/** A collaboration a deleted account owned, and the member it passes to (null: none is left). */
export interface OwnedCollaboration {
  readonly playlistId: string;
  readonly heir: string | null;
}

/**
 * The collaborations [accountId] owns, each with its member who joined
 * first apart from the owner, the one the playlist passes to when the
 * account is deleted (docs/spec.md, "When membership ends").
 */
export const ownedCollaborations = async (
  tx: Transaction,
  accountId: string,
): Promise<OwnedCollaboration[]> => {
  const result = await tx.execute({
    sql: `SELECT c.playlist_id,
                 (SELECT m.account_id FROM collaboration_members m
                  WHERE m.playlist_id = c.playlist_id AND m.account_id <> c.owner_id
                  ORDER BY m.joined_at, m.account_id LIMIT 1) AS heir
          FROM collaborations c WHERE c.owner_id = ? ORDER BY c.playlist_id`,
    args: [accountId],
  });
  return result.rows.map((row) => ({
    playlistId: String(row.playlist_id),
    heir: typeof row.heir === "string" ? row.heir : null,
  }));
};

/** Makes [heir], already a member of [playlistId], its owner. */
export const passCollaboration = (playlistId: string, heir: string): InStatement => ({
  sql: "UPDATE collaborations SET owner_id = ? WHERE playlist_id = ?",
  args: [heir, playlistId],
});

/**
 * What deleting [accountId] does to the collaborations, as statements for
 * the deletion's transaction, once the ones it owned with other members
 * have passed on (`passCollaboration`): the ones it still owns, which have
 * no other member, go, and it goes from the ones it is in. Every invite
 * link it made goes too, those of the playlists that passed on included.
 */
export const forgetAccountStatements = (accountId: string): InStatement[] => [
  // Its entries stay in the playlists they are in and name no one.
  { sql: "UPDATE playlist_entries SET added_by = NULL WHERE added_by = ?", args: [accountId] },
  {
    sql: `DELETE FROM collaboration_members
          WHERE account_id = ?
             OR playlist_id IN (SELECT playlist_id FROM collaborations WHERE owner_id = ?)`,
    args: [accountId, accountId],
  },
  {
    sql: `DELETE FROM collaboration_invites
          WHERE owner_id = ?
             OR playlist_id IN (SELECT playlist_id FROM collaborations WHERE owner_id = ?)`,
    args: [accountId, accountId],
  },
  { sql: "DELETE FROM collaborations WHERE owner_id = ?", args: [accountId] },
  { sql: "DELETE FROM collaboration_ends WHERE account_id = ?", args: [accountId] },
];
