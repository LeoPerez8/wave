/**
 * The sync service's collaborative-playlist routes for the app (`docs/spec.md`, Collaborative
 * playlists): the account's name, a playlist's collaboration, its invite and a member's push
 * and pull of one playlist. They go through the same transport as the account's push and pull
 * (`WaveAccount.request` on the phone, main's `request` on the desktop), which holds the session
 * and sends only the requests Core's `isCollaborationRequest` takes. Core builds each request
 * and reads its answer; each call resolves to what it came to and rejects only for a bug.
 */
import {
  accountNameCall,
  collaborationAnswer,
  createInviteCall,
  endCollaborationCall,
  joinInviteCall,
  leaveCollaborationCall,
  lookUpInviteCall,
  makeCollaborationCall,
  membersCall,
  playlistPullCall,
  playlistPushCall,
  readInviteCall,
  removeMemberCall,
  turnOffInviteCall,
  type ActiveInvite,
  type Collaboration,
  type CollaborationCall,
  type CollaborationMethod,
  type CollaborationResult,
  type CreatedInvite,
  type InviteDetails,
  type SyncPullPage,
  type SyncPushAnswer,
} from "@wave/core";

/** Sends a request with the session, as the account's push and pull do. */
export interface CollaborationTransport {
  readonly request: (
    method: CollaborationMethod,
    path: string,
    body: string | null,
  ) => Promise<{ readonly status: number; readonly body: string }>;
}

export interface CollaborationService {
  /** Keeps the Google account name for the account (an app signed in before names were kept). */
  readonly setAccountName: (name: string) => Promise<CollaborationResult<null>>;
  /** Makes the account's playlist collaborative, with the account as owner. */
  readonly make: (playlistId: string) => Promise<CollaborationResult<Collaboration>>;
  /** The owner ends it: every other member goes, the playlist stays the owner's. */
  readonly end: (playlistId: string) => Promise<CollaborationResult<null>>;
  readonly members: (playlistId: string) => Promise<CollaborationResult<Collaboration>>;
  /** The owner removes the member [accountId]. */
  readonly removeMember: (
    playlistId: string,
    accountId: string,
  ) => Promise<CollaborationResult<null>>;
  /** A member who isn't the owner leaves. */
  readonly leave: (playlistId: string) => Promise<CollaborationResult<null>>;
  /** The owner creates the invite link (the only answer that holds it), ending the active one. */
  readonly createInvite: (playlistId: string) => Promise<CollaborationResult<CreatedInvite>>;
  /** The active link's dates; null when there's none. */
  readonly readInvite: (playlistId: string) => Promise<CollaborationResult<ActiveInvite | null>>;
  readonly turnOffInvite: (playlistId: string) => Promise<CollaborationResult<null>>;
  /** The playlist's and owner's names for an invite link's [token]; joins nothing. */
  readonly lookUpInvite: (token: string) => Promise<CollaborationResult<InviteDetails>>;
  readonly join: (token: string) => Promise<CollaborationResult<Collaboration>>;
  /** A member's push of one playlist's rows ([body], a push body of its row and entries). */
  readonly push: (playlistId: string, body: string) => Promise<CollaborationResult<SyncPushAnswer>>;
  /** A member's pull of one playlist after its own cursor [since] (null: from the start). */
  readonly pull: (
    playlistId: string,
    since: string | null,
  ) => Promise<CollaborationResult<SyncPullPage>>;
}

/** The `ERR_WAVE_*` code the transport rejected with, if any (the native module's and main's). */
const waveErrorCode = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("ERR_WAVE_") ? code : null;
};

/**
 * Sends [call] through [transport]. Offline is its own result; any other reason nothing was
 * sent or answered (signed out, the session ended, the service out of reach) is a failure with
 * no status. The session ending reaches the app as a session change, as with the account sync.
 */
export const sendCollaborationCall = async <T>(
  transport: CollaborationTransport,
  call: CollaborationCall<T>,
): Promise<CollaborationResult<T>> => {
  const { method, path, body } = call.request;
  let response: { readonly status: number; readonly body: string };
  try {
    response = await transport.request(method, path, body);
  } catch (error) {
    const code = waveErrorCode(error);
    if (code === null) throw error;
    return code === "ERR_WAVE_OFFLINE" ? { type: "offline" } : { type: "failed", status: null };
  }
  return collaborationAnswer(call, response.status, response.body);
};

export const collaborationService = (transport: CollaborationTransport): CollaborationService => {
  const send = <T>(call: CollaborationCall<T>): Promise<CollaborationResult<T>> =>
    sendCollaborationCall(transport, call);
  return {
    setAccountName: (name) => send(accountNameCall(name)),
    make: (playlistId) => send(makeCollaborationCall(playlistId)),
    end: (playlistId) => send(endCollaborationCall(playlistId)),
    members: (playlistId) => send(membersCall(playlistId)),
    removeMember: (playlistId, accountId) => send(removeMemberCall(playlistId, accountId)),
    leave: (playlistId) => send(leaveCollaborationCall(playlistId)),
    createInvite: (playlistId) => send(createInviteCall(playlistId)),
    readInvite: (playlistId) => send(readInviteCall(playlistId)),
    turnOffInvite: (playlistId) => send(turnOffInviteCall(playlistId)),
    lookUpInvite: (token) => send(lookUpInviteCall(token)),
    join: (token) => send(joinInviteCall(token)),
    push: (playlistId, body) => send(playlistPushCall(playlistId, body)),
    pull: (playlistId, since) => send(playlistPullCall(playlistId, since)),
  };
};
