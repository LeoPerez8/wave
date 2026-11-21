/**
 * A collaborative playlist's invite link (docs/spec.md, "Collaborative
 * playlists", Invite link): the only way in. The owner creates it, which
 * ends any earlier one, reads its last day, and turns it off; removing a
 * member ends it too. It's valid for 7 days, for any number of people.
 *
 * The service keeps only a hash of the token (`collaboration_invites`), so
 * it can tell the owner when the current link ends but not the link itself:
 * the app that created it holds it.
 */

import type { Client, InStatement, ResultSet } from "@libsql/client";
import { type Collaboration, collaborationMembers, role, roleOf } from "./collaborations.ts";

/** How long an invite link lets people join. */
export const INVITE_LIFETIME_MS = 7 * 86_400_000;

/** Why the owner's request about a link is refused: as for the other collaboration routes. */
export type InviteOwnerRefusal = "not_member" | "not_owner";

/** The current link as its owner reads it. */
export interface CurrentInvite {
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** What a signed-in app shows before joining. */
export interface InviteSummary {
  readonly playlistId: string;
  /** Null for a playlist the service holds no name for. */
  readonly playlistName: string | null;
  /** Null for an owner the service has no name for. */
  readonly ownerName: string | null;
}

/**
 * Why a token doesn't let anyone in: it names no invite (`unknown`), or one
 * that expired, was turned off or replaced, ended with a member's removal,
 * or whose playlist is no longer collaborative or was deleted (`ended`).
 */
export type InviteRefusal = "unknown" | "ended";

const ownerRefusal = (result: ResultSet | undefined): InviteOwnerRefusal | null => {
  const part = roleOf(result);
  return part === "owner" ? null : part === null ? "not_member" : "not_owner";
};

const OWNED = "EXISTS (SELECT 1 FROM collaborations WHERE playlist_id = ? AND owner_id = ?)";

/**
 * Creates [playlistId]'s link for its owner [accountId], with [tokenHash]
 * for the token the caller made, and ends the active one. Finished links
 * past their expiry are dropped as it goes, so a playlist keeps few.
 */
export const createInvite = async (
  db: Client,
  playlistId: string,
  accountId: string,
  tokenHash: string,
  at: number,
): Promise<CurrentInvite | InviteOwnerRefusal> => {
  const expiresAt = at + INVITE_LIFETIME_MS;
  const owned = [playlistId, accountId];
  const [asked] = await db.batch(
    [
      role(playlistId, accountId),
      {
        sql: `DELETE FROM collaboration_invites
              WHERE playlist_id = ? AND state <> 'active' AND expires_at <= ? AND ${OWNED}`,
        args: [playlistId, at, ...owned],
      },
      {
        sql: `UPDATE collaboration_invites SET state = 'replaced'
              WHERE playlist_id = ? AND state = 'active' AND ${OWNED}`,
        args: [playlistId, ...owned],
      },
      {
        sql: `INSERT INTO collaboration_invites
                (token_hash, playlist_id, owner_id, created_at, expires_at, state)
              SELECT ?, ?, ?, ?, ?, 'active' WHERE ${OWNED}`,
        args: [tokenHash, playlistId, accountId, at, expiresAt, ...owned],
      },
    ],
    "write",
  );
  return ownerRefusal(asked) ?? { createdAt: at, expiresAt };
};

/** [playlistId]'s link that still lets people in, for its owner; null for none. */
export const currentInvite = async (
  db: Client,
  playlistId: string,
  accountId: string,
  at: number,
): Promise<{ readonly invite: CurrentInvite | null } | InviteOwnerRefusal> => {
  const [asked, invite] = await db.batch(
    [
      role(playlistId, accountId),
      {
        sql: `SELECT created_at, expires_at FROM collaboration_invites
              WHERE playlist_id = ? AND state = 'active' AND expires_at > ? AND ${OWNED}`,
        args: [playlistId, at, playlistId, accountId],
      },
    ],
    "read",
  );
  const refusal = ownerRefusal(asked);
  if (refusal !== null) return refusal;
  const row = invite?.rows[0];
  return {
    invite:
      row === undefined
        ? null
        : { createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) },
  };
};

/** Turns off [playlistId]'s active link, for its owner; none to turn off is no refusal. */
export const turnOffInvite = async (
  db: Client,
  playlistId: string,
  accountId: string,
): Promise<InviteOwnerRefusal | null> => {
  const [asked] = await db.batch(
    [
      role(playlistId, accountId),
      {
        sql: `UPDATE collaboration_invites SET state = 'off'
              WHERE playlist_id = ? AND state = 'active' AND ${OWNED}`,
        args: [playlistId, playlistId, accountId],
      },
    ],
    "write",
  );
  return ownerRefusal(asked);
};

/** The invite [tokenHash] names, with its playlist and owner as they are now. */
const inviteNamed = (tokenHash: string): InStatement => ({
  sql: `SELECT i.playlist_id, i.state, i.expires_at, c.owner_id,
               p.name AS playlist_name, p.deleted, a.name AS owner_name
        FROM collaboration_invites i
        LEFT JOIN collaborations c ON c.playlist_id = i.playlist_id
        LEFT JOIN playlists p ON p.account_id = c.owner_id AND p.id = i.playlist_id
        LEFT JOIN accounts a ON a.id = c.owner_id
        WHERE i.token_hash = ?`,
  args: [tokenHash],
});

const summaryOf = (result: ResultSet | undefined, at: number): InviteSummary | InviteRefusal => {
  const row = result?.rows[0];
  if (row === undefined) return "unknown";
  if (
    row.state !== "active" ||
    Number(row.expires_at) <= at ||
    row.owner_id === null ||
    row.deleted === null ||
    Number(row.deleted) !== 0
  ) {
    return "ended";
  }
  return {
    playlistId: String(row.playlist_id),
    playlistName: typeof row.playlist_name === "string" ? row.playlist_name : null,
    ownerName: typeof row.owner_name === "string" ? row.owner_name : null,
  };
};

/** What the invite [tokenHash] names lets a signed-in app show; reading it joins nothing. */
export const readInvite = async (
  db: Client,
  tokenHash: string,
  at: number,
): Promise<InviteSummary | InviteRefusal> =>
  summaryOf(await db.execute(inviteNamed(tokenHash)), at);

/**
 * Makes [accountId] a member of the playlist the invite [tokenHash] names,
 * when the link still lets people in, and drops the account's end record for
 * that playlist; an account already in it keeps when it joined. The check
 * and the join are one transaction, so a link turned off meanwhile lets no
 * one in.
 */
export const joinInvite = async (
  db: Client,
  tokenHash: string,
  accountId: string,
  at: number,
): Promise<Collaboration | InviteRefusal> => {
  const valid = `SELECT i.playlist_id
                 FROM collaboration_invites i
                 JOIN collaborations c ON c.playlist_id = i.playlist_id
                 JOIN playlists p ON p.account_id = c.owner_id AND p.id = i.playlist_id
                 WHERE i.token_hash = ? AND i.state = 'active' AND i.expires_at > ?
                   AND p.deleted = 0`;
  const [named] = await db.batch(
    [
      inviteNamed(tokenHash),
      {
        sql: `INSERT INTO collaboration_members (playlist_id, account_id, joined_at)
              SELECT playlist_id, ?, ? FROM (${valid}) WHERE true
              ON CONFLICT (playlist_id, account_id) DO NOTHING`,
        args: [accountId, at, tokenHash, at],
      },
      {
        sql: `DELETE FROM collaboration_ends
              WHERE account_id = ? AND playlist_id IN (${valid})`,
        args: [accountId, tokenHash, at],
      },
    ],
    "write",
  );
  const summary = summaryOf(named, at);
  if (typeof summary === "string") return summary;
  const joined = await collaborationMembers(db, summary.playlistId, accountId);
  // The owner ended the collaboration between the join and this read.
  return joined === "not_member" ? "ended" : joined;
};
