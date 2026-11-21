/**
 * How a device keeps the collaborative playlists of its account in step (docs/spec.md,
 * "Collaborative playlists", Where the rows live, When membership ends): what the account
 * pull says of them, what the device does with each one it holds, and the ids of the
 * private copy a member keeps when their membership ends.
 */
import {
  readCollaboration,
  type Collaboration,
  type CollaborationRefusal,
} from "./collaborationRequests.ts";

/** Why the account is no longer in a playlist: it left, or the owner removed it or ended it. */
export type CollaborationEndReason = "left" | "ended";

export interface EndedCollaboration {
  readonly playlistId: string;
  readonly reason: CollaborationEndReason;
  readonly endedAt: number;
}

/** What every page of the account pull states whole of the account's collaborative playlists. */
export interface PullMembership {
  /** Each collaborative playlist the account is in, its own included. */
  readonly collaborations: readonly Collaboration[];
  /** The playlists the account was in and isn't any more. */
  readonly ended: readonly EndedCollaboration[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readEnded = (raw: unknown): EndedCollaboration | null =>
  isRecord(raw) &&
  typeof raw.playlistId === "string" &&
  (raw.reason === "left" || raw.reason === "ended") &&
  Number.isSafeInteger(raw.endedAt)
    ? { playlistId: raw.playlistId, reason: raw.reason, endedAt: raw.endedAt as number }
    : null;

/**
 * The membership an account pull page ([body]) states; null when it states none (a service
 * from before collaborative playlists), so a device changes nothing it holds. An item that
 * isn't its shape is left out.
 */
export const readPullMembership = (body: string): PullMembership | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.collaborations)) return null;
  const ended = Array.isArray(raw.endedCollaborations) ? raw.endedCollaborations : [];
  return {
    collaborations: raw.collaborations.flatMap((item: unknown) => readCollaboration(item) ?? []),
    ended: ended.flatMap((item: unknown) => readEnded(item) ?? []),
  };
};

/** A collaborative playlist a device holds a record of. */
export interface HeldCollaboration {
  readonly playlistId: string;
  /** The account signed in owns it: its rows sync with the account's own push and pull. */
  readonly owned: boolean;
  /** The owner's account id when the device last heard; null when it never did. */
  readonly ownerAccountId: string | null;
}

/** A collaborative playlist the device keeps, as the account pull states it now. */
export interface KeptCollaboration extends HeldCollaboration {
  readonly members: Collaboration["members"];
  /**
   * Its own pull starts again from no cursor: it is new to the device, or its owner changed
   * (the cursor is the owner's change number, and a playlist that passed to another owner is
   * numbered anew).
   */
  readonly restartPull: boolean;
}

/** What a device does with the collaborative playlists it holds, after an account pull. */
export interface MembershipChanges {
  /** Kept, added or updated: their members and owner as stated. */
  readonly keep: readonly KeptCollaboration[];
  /** The account left: the playlist goes from the device; its entries stay for the others. */
  readonly leave: readonly string[];
  /**
   * The account was removed, or the owner ended or deleted it: the playlist becomes the
   * account's own private copy.
   */
  readonly privateCopy: readonly string[];
  /** The account's own collaborative playlist ended: the record goes, the playlist stays. */
  readonly forget: readonly string[];
}

/**
 * What the device does with the collaborative playlists it [held], now that an account
 * pull states its [membership]. A member's playlist the pull no longer lists keeps a private
 * copy unless the account left it, so what the device had is never lost.
 */
export const membershipChanges = (
  held: readonly HeldCollaboration[],
  membership: PullMembership,
): MembershipChanges => {
  const before = new Map(held.map((record) => [record.playlistId, record]));
  const keep = membership.collaborations.map((collaboration): KeptCollaboration => {
    const self = collaboration.members.find((each) => each.self);
    const ownerAccountId = collaboration.members.find((each) => each.owner)?.accountId ?? null;
    const record = before.get(collaboration.playlistId);
    return {
      playlistId: collaboration.playlistId,
      owned: self?.owner === true,
      ownerAccountId,
      members: collaboration.members,
      restartPull: record === undefined || record.ownerAccountId !== ownerAccountId,
    };
  });
  const listed = new Set(keep.map((record) => record.playlistId));
  const left = new Set(
    membership.ended.filter((end) => end.reason === "left").map((end) => end.playlistId),
  );
  const gone = held.filter((record) => !listed.has(record.playlistId));
  return {
    keep,
    leave: gone
      .filter((record) => !record.owned && left.has(record.playlistId))
      .map((record) => record.playlistId),
    privateCopy: gone
      .filter((record) => !record.owned && !left.has(record.playlistId))
      .map((record) => record.playlistId),
    forget: gone.filter((record) => record.owned).map((record) => record.playlistId),
  };
};

/** One 32-bit FNV-1a round over [text] from [seed]. */
const fnv = (text: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

const SEEDS = [0x811c9dc5, 0x2f1b6a37, 0x9e3779b9, 0x5bd1e995] as const;

/**
 * The sync id of a member's private copy of the playlist or entry [id]: the same on each of
 * the member's devices, so every device that makes the copy writes the same rows and the
 * account holds one copy. A sync id's shape (32 hex digits), and never the id itself, so the
 * copy stays apart from the collaborative playlist should the account join it again.
 */
export const privateCopyId = (id: string): string =>
  SEEDS.map((seed) => fnv(`private copy:${id}`, seed).toString(16).padStart(8, "0")).join("");

/**
 * Whether the service's [refusal] of a member's push or pull of a playlist means the account
 * is no longer in it (it isn't a member, or the owner deleted the playlist), so the playlist
 * becomes the member's private copy. Any other refusal (a full playlist) stops only that
 * playlist's sync until the next cycle, its changes still waiting.
 */
export const refusalEndsMembership = (refusal: CollaborationRefusal): boolean =>
  refusal === "notMember" || refusal === "deleted";
