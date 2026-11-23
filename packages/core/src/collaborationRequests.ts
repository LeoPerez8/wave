/**
 * The sync service's routes for collaborative playlists (`apps/sync/README.md`, Collaborative
 * playlists, Invite links, `PUT /v1/account/name`), as the app calls them. The session token
 * stays with the phone's native module and the desktop's main process, which send each request
 * only when `isCollaborationRequest` takes it; this builds the requests and reads the answers.
 * An answer is what the route gives, a refusal the caller can act on, or a failure.
 */
import { accountPhotoUrl } from "./accountPhoto.ts";
import {
  readPullPage,
  readPushAnswer,
  type SyncPullPage,
  type SyncPushAnswer,
} from "./syncWire.ts";

export type CollaborationMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface CollaborationRequest {
  readonly method: CollaborationMethod;
  /** The route and its query, as the service takes it. */
  readonly path: string;
  /** JSON, or null for none. */
  readonly body: string | null;
}

/** One member of a collaborative playlist, as the service lists them. */
export interface CollaborationMember {
  /** The service's id of the account: the one Remove takes, and an entry's `addedBy`. */
  readonly accountId: string;
  /** The Google account name; null when the service has none. */
  readonly name: string | null;
  /**
   * The Google account's photo, an address `accountPhotoUrl` accepts; null when the service has
   * none, or sent none (one from before photos were kept, or a member stored before them).
   */
  readonly photoUrl: string | null;
  readonly joinedAt: number;
  readonly owner: boolean;
  /** The account that asked. */
  readonly self: boolean;
}

/** A playlist's collaboration: the owner first, then the others in the order they joined. */
export interface Collaboration {
  readonly playlistId: string;
  readonly members: readonly CollaborationMember[];
}

/** The invite link the owner just created. Only this answer ever holds the link. */
export interface CreatedInvite {
  readonly url: string;
  readonly expiresAt: number;
}

/** The playlist's active link, without its address: when it was made and its last day. */
export interface ActiveInvite {
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** What an invite link names, before anyone joins. */
export interface InviteDetails {
  readonly playlistId: string;
  readonly playlistName: string | null;
  readonly ownerName: string | null;
}

/**
 * Why the service refused a call, each one something the app tells or acts on:
 * - `notMember`: the playlist isn't collaborative (or ended), or the account isn't in it.
 * - `notOwner`: only the owner may do that.
 * - `ownerCannotLeave`: the owner leaving, or removing itself.
 * - `deleted`: the owner deleted the playlist.
 * - `notFound`: the playlist (or the member to remove) isn't there.
 * - `taken`: the playlist id names another account's collaboration.
 * - `linkNotValid`: the invite link names nothing, expired, was turned off or replaced.
 * - `full`: a limit of the service; `limit` names which.
 */
export type CollaborationRefusal =
  | "notMember"
  | "notOwner"
  | "ownerCannotLeave"
  | "deleted"
  | "notFound"
  | "taken"
  | "linkNotValid"
  | "full";

/**
 * What a call came to. `refused` is the service saying no, `failed` an answer that isn't one
 * (a server error, a rate limit, an answer of the wrong shape, or nothing sent), and `offline`
 * the device having no connection: nothing reached the service.
 */
export type CollaborationResult<T> =
  | { readonly type: "done"; readonly value: T }
  | { readonly type: "refused"; readonly refusal: CollaborationRefusal; readonly limit?: string }
  | { readonly type: "failed"; readonly status: number | null }
  | { readonly type: "offline" };

/** A request and how to read its 2xx answer (null: not the route's shape). */
export interface CollaborationCall<T> {
  readonly request: CollaborationRequest;
  readonly read: (body: string) => { readonly value: T } | null;
  /** The route takes an invite token: its `not_found` means the link, not a playlist. */
  readonly invite?: boolean;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parse = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
};

const textOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

/**
 * Reads one member as the service lists it, or as a device kept it: a member without a photo
 * (from a service, or a record, from before photos were kept) has none. Null when [raw] isn't
 * a member's shape.
 */
export const readCollaborationMember = (raw: unknown): CollaborationMember | null =>
  isRecord(raw) &&
  typeof raw.accountId === "string" &&
  textOrNull(raw.name) &&
  Number.isSafeInteger(raw.joinedAt) &&
  typeof raw.owner === "boolean" &&
  typeof raw.self === "boolean"
    ? {
        accountId: raw.accountId,
        name: raw.name,
        photoUrl: accountPhotoUrl(raw.photoUrl),
        joinedAt: raw.joinedAt as number,
        owner: raw.owner,
        self: raw.self,
      }
    : null;

/**
 * Reads a `Collaboration` (the answer of make, members and join, and each of a pull's
 * `collaborations`). A member that isn't one's shape is left out; null without a playlist id
 * or member list.
 */
export const readCollaboration = (raw: unknown): Collaboration | null => {
  if (!isRecord(raw) || typeof raw.playlistId !== "string" || !Array.isArray(raw.members))
    return null;
  return {
    playlistId: raw.playlistId,
    members: raw.members.flatMap((member: unknown) => readCollaborationMember(member) ?? []),
  };
};

const nothing = (): { readonly value: null } => ({ value: null });

/** Wraps a reader that answers null for a body that isn't its shape. */
const some =
  <T>(read: (body: string) => T | null) =>
  (body: string): { readonly value: T } | null => {
    const value = read(body);
    return value === null ? null : { value };
  };

const query = (route: string, params: readonly (readonly [string, string])[]): string =>
  `${route}?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;

const call = <T>(
  method: CollaborationMethod,
  path: string,
  body: unknown,
  read: (body: string) => { readonly value: T } | null,
  invite = false,
): CollaborationCall<T> => ({
  request: { method, path, body: body === undefined ? null : JSON.stringify(body) },
  read,
  ...(invite ? { invite } : {}),
});

const collaborationOf = some((body) => readCollaboration(parse(body)));

/** `PUT /v1/account/name`: keeps [name] (the Google account name) for the session's account. */
export const accountNameCall = (name: string): CollaborationCall<null> =>
  call("PUT", "/v1/account/name", { name }, nothing);

/** `POST /v1/collaboration`: makes a playlist of the account collaborative, owned by it. */
export const makeCollaborationCall = (playlistId: string): CollaborationCall<Collaboration> =>
  call("POST", "/v1/collaboration", { playlistId }, collaborationOf);

/** `DELETE /v1/collaboration`: the owner ends it; the playlist's rows stay. */
export const endCollaborationCall = (playlistId: string): CollaborationCall<null> =>
  call("DELETE", query("/v1/collaboration", [["playlist", playlistId]]), undefined, nothing);

/** `GET /v1/collaboration/members`: the playlist's members, for any of them. */
export const membersCall = (playlistId: string): CollaborationCall<Collaboration> =>
  call(
    "GET",
    query("/v1/collaboration/members", [["playlist", playlistId]]),
    undefined,
    collaborationOf,
  );

/** `DELETE /v1/collaboration/members`: the owner removes the member [accountId]. */
export const removeMemberCall = (playlistId: string, accountId: string): CollaborationCall<null> =>
  call(
    "DELETE",
    query("/v1/collaboration/members", [
      ["playlist", playlistId],
      ["account", accountId],
    ]),
    undefined,
    nothing,
  );

/** `DELETE /v1/collaboration/membership`: a member who isn't the owner leaves. */
export const leaveCollaborationCall = (playlistId: string): CollaborationCall<null> =>
  call(
    "DELETE",
    query("/v1/collaboration/membership", [["playlist", playlistId]]),
    undefined,
    nothing,
  );

/** `POST /v1/collaboration/invite`: the owner creates a link, ending the active one. */
export const createInviteCall = (playlistId: string): CollaborationCall<CreatedInvite> =>
  call(
    "POST",
    "/v1/collaboration/invite",
    { playlistId },
    some((body) => {
      const raw = parse(body);
      return isRecord(raw) && typeof raw.url === "string" && Number.isSafeInteger(raw.expiresAt)
        ? { url: raw.url, expiresAt: raw.expiresAt as number }
        : null;
    }),
  );

/** `GET /v1/collaboration/invite`: the active link's dates, null when none lets people in. */
export const readInviteCall = (playlistId: string): CollaborationCall<ActiveInvite | null> =>
  call("GET", query("/v1/collaboration/invite", [["playlist", playlistId]]), undefined, (body) => {
    const raw = parse(body);
    if (!isRecord(raw)) return null;
    const invite = raw.invite;
    if (invite === null) return { value: null };
    return isRecord(invite) &&
      Number.isSafeInteger(invite.createdAt) &&
      Number.isSafeInteger(invite.expiresAt)
      ? { value: { createdAt: invite.createdAt as number, expiresAt: invite.expiresAt as number } }
      : null;
  });

/** `DELETE /v1/collaboration/invite`: the owner turns the active link off. */
export const turnOffInviteCall = (playlistId: string): CollaborationCall<null> =>
  call("DELETE", query("/v1/collaboration/invite", [["playlist", playlistId]]), undefined, nothing);

/** `POST /v1/invite`: what the link's [token] names. Joins nothing. */
export const lookUpInviteCall = (token: string): CollaborationCall<InviteDetails> =>
  call(
    "POST",
    "/v1/invite",
    { token },
    some((body) => {
      const raw = parse(body);
      return isRecord(raw) &&
        typeof raw.playlistId === "string" &&
        textOrNull(raw.playlistName) &&
        textOrNull(raw.ownerName)
        ? { playlistId: raw.playlistId, playlistName: raw.playlistName, ownerName: raw.ownerName }
        : null;
    }),
    true,
  );

/** `POST /v1/invite/join`: makes the session's account a member with the link's [token]. */
export const joinInviteCall = (token: string): CollaborationCall<Collaboration> =>
  call("POST", "/v1/invite/join", { token }, collaborationOf, true);

/**
 * `POST /v1/collaboration/push`: a member's push of one playlist's row and entries ([body],
 * as `pushBody` writes it for those tables only).
 */
export const playlistPushCall = (
  playlistId: string,
  body: string,
): CollaborationCall<SyncPushAnswer> => ({
  request: {
    method: "POST",
    path: query("/v1/collaboration/push", [["playlist", playlistId]]),
    body,
  },
  // A service from before change-time corrections answers no `corrected`: still a push done.
  read: (answer) => ({ value: readPushAnswer(answer) }),
});

/** `GET /v1/collaboration/pull`: the playlist's changes after [since] (null: from the start). */
export const playlistPullCall = (
  playlistId: string,
  since: string | null,
): CollaborationCall<SyncPullPage> =>
  call(
    "GET",
    query("/v1/collaboration/pull", [
      ["playlist", playlistId],
      ...(since === null ? [] : [["since", since] as const]),
    ]),
    undefined,
    some(readPullPage),
  );

/** An id or cursor as the routes take it in a query. */
const ID = "[0-9A-Za-z_-]{1,128}";

/** Every request the app may send for collaborative playlists, by method. */
const ALLOWED: readonly (readonly [CollaborationMethod, RegExp])[] = [
  ["PUT", /^\/v1\/account\/name$/],
  ["POST", /^\/v1\/collaboration$/],
  ["DELETE", new RegExp(`^/v1/collaboration\\?playlist=${ID}$`)],
  ["GET", new RegExp(`^/v1/collaboration/members\\?playlist=${ID}$`)],
  ["DELETE", new RegExp(`^/v1/collaboration/members\\?playlist=${ID}&account=${ID}$`)],
  ["DELETE", new RegExp(`^/v1/collaboration/membership\\?playlist=${ID}$`)],
  ["POST", /^\/v1\/collaboration\/invite$/],
  ["GET", new RegExp(`^/v1/collaboration/invite\\?playlist=${ID}$`)],
  ["DELETE", new RegExp(`^/v1/collaboration/invite\\?playlist=${ID}$`)],
  ["POST", /^\/v1\/invite$/],
  ["POST", /^\/v1\/invite\/join$/],
  ["POST", new RegExp(`^/v1/collaboration/push\\?playlist=${ID}$`)],
  ["GET", new RegExp(`^/v1/collaboration/pull\\?playlist=${ID}(&since=${ID})?$`)],
];

/**
 * Whether [method] [path] is one of the collaboration requests the app may send with the
 * session: the phone's native module (`WaveAccountClient.kt`, the same patterns) and the
 * desktop's main process check it before sending.
 */
export const isCollaborationRequest = (method: string, path: string): boolean =>
  ALLOWED.some(([allowed, pattern]) => allowed === method && pattern.test(path));

const REFUSALS: Readonly<Record<string, CollaborationRefusal>> = {
  not_member: "notMember",
  not_owner: "notOwner",
  owner_cannot_leave: "ownerCannotLeave",
  deleted: "deleted",
  not_found: "notFound",
  taken: "taken",
  invite_ended: "linkNotValid",
};

/** What [call] came to, from the service's [status] and [body]. */
export const collaborationAnswer = <T>(
  call: CollaborationCall<T>,
  status: number,
  body: string,
): CollaborationResult<T> => {
  if (status >= 200 && status <= 299) {
    const read = call.read(body);
    return read === null ? { type: "failed", status } : { type: "done", value: read.value };
  }
  const answer = parse(body);
  const error = isRecord(answer) ? answer.error : undefined;
  if (error === "limit" && (status === 403 || status === 413)) {
    const limit = isRecord(answer) && typeof answer.limit === "string" ? answer.limit : undefined;
    return { type: "refused", refusal: "full", ...(limit === undefined ? {} : { limit }) };
  }
  const refusal = typeof error === "string" ? REFUSALS[error] : undefined;
  if (refusal === undefined || !REFUSAL_STATUS[refusal].includes(status))
    return { type: "failed", status };
  return {
    type: "refused",
    refusal: call.invite === true && refusal === "notFound" ? "linkNotValid" : refusal,
  };
};

/** The status each refusal comes with; the same error with another status is a failure. */
const REFUSAL_STATUS: Readonly<Record<CollaborationRefusal, readonly number[]>> = {
  notMember: [403],
  notOwner: [403],
  ownerCannotLeave: [403],
  deleted: [403],
  notFound: [404],
  taken: [409],
  linkNotValid: [410],
  full: [403, 413],
};
