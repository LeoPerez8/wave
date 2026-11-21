/**
 * Opening an invite link (docs/spec.md › Collaborative playlists, Invite link), apart from the
 * screens so it can be tested: Core decides each step, these ports show it and send it. Nothing
 * joins without Join; Cancel sends nothing more.
 */
import {
  inviteJoinOutcome,
  inviteJoinView,
  inviteLookUpOutcome,
  inviteOpening,
  inviteSignInNotice,
  inviteSignInPrompt,
  type AppLanguage,
  type Collaboration,
  type CollaborationResult,
  type InviteDetails,
  type InviteJoinView,
  type InviteNotice,
  type WaveSession,
  type WaveSignInFailure,
} from "@wave/core";

/** What signing in from the invite came to (Settings' sign-in). */
export type InviteSignIn =
  | { readonly type: "signedIn" }
  | { readonly type: "cancelled" }
  | { readonly type: "declined" }
  | { readonly type: "failed"; readonly reason: WaveSignInFailure };

export interface InviteRunnerPorts {
  readonly session: () => Promise<WaveSession>;
  readonly language: () => AppLanguage;
  /** Shows the sign-in prompt; true when Sign In with Google is chosen. */
  readonly askSignIn: (prompt: ReturnType<typeof inviteSignInPrompt>) => Promise<boolean>;
  readonly signIn: () => Promise<InviteSignIn>;
  readonly lookUp: (token: string) => Promise<CollaborationResult<InviteDetails>>;
  /** Shows the join screen; true for Join, false for Cancel or Back. */
  readonly askJoin: (view: InviteJoinView) => Promise<boolean>;
  readonly join: (token: string) => Promise<CollaborationResult<Collaboration>>;
  readonly notify: (notice: InviteNotice) => Promise<void>;
  /** Joined the playlist [playlistId] (its sync id): sync, so it arrives. */
  readonly joined: (playlistId: string, view: InviteJoinView) => void;
}

/** Opens the invite whose token is [token], from its first step to Join or a message. */
export const openInvite = async (token: string, ports: InviteRunnerPorts): Promise<void> => {
  const language = ports.language();
  const session = await ports.session().catch((): WaveSession => ({ status: "signedOut" }));
  const step = inviteOpening({ signedIn: session.status === "signedIn" });
  if (step === "signIn" || session.status !== "signedIn") {
    if (!(await ports.askSignIn(inviteSignInPrompt(language)))) return;
    const signedIn = await ports.signIn();
    if (signedIn.type === "failed")
      return ports.notify(inviteSignInNotice(signedIn.reason, language));
    if (signedIn.type !== "signedIn") return;
    // Once signed in, the invite opens again from the start.
    const again = await ports.session().catch((): WaveSession => ({ status: "signedOut" }));
    if (again.status !== "signedIn") return;
    return showInvite(token, again.account, ports, language);
  }
  return showInvite(token, session.account, ports, language);
};

const showInvite = async (
  token: string,
  account: Extract<WaveSession, { status: "signedIn" }>["account"],
  ports: InviteRunnerPorts,
  language: AppLanguage,
): Promise<void> => {
  const found = inviteLookUpOutcome(await ports.lookUp(token), language);
  if (found.kind === "notice") return ports.notify(found.notice);
  const view = inviteJoinView(found.details, account, language);
  if (!(await ports.askJoin(view))) return;
  const outcome = inviteJoinOutcome(await ports.join(token), language);
  if (outcome.kind === "notice") return ports.notify(outcome.notice);
  ports.joined(outcome.playlistId, view);
};

export interface JoinedOpenPorts {
  /** The joined playlist's id here, or null while the device doesn't have it. */
  readonly find: () => Promise<number | null>;
  /** Calls [changed] after each change to the playlists; returns how to stop. */
  readonly onPlaylistsEdited: (changed: () => void) => () => void;
  readonly open: (playlistId: number) => void;
  /** Calls [done] after [ms]; returns how to cancel it. */
  readonly after: (ms: number, done: () => void) => () => void;
}

/**
 * After Join: opens the joined playlist as soon as the device has it, at once when it already
 * does, else on the playlists change that brings it, waiting at most [withinMs]. Returns how to
 * stop waiting.
 */
export const openWhenJoined = (ports: JoinedOpenPorts, withinMs: number): (() => void) => {
  let done = false;
  const look = (): void => {
    if (done) return;
    ports.find().then(
      (id) => {
        if (id === null || done) return;
        stop();
        ports.open(id);
      },
      () => {},
    );
  };
  const unsubscribe = ports.onPlaylistsEdited(look);
  const cancel = ports.after(withinMs, () => stop());
  const stop = (): void => {
    if (done) return;
    done = true;
    unsubscribe();
    cancel();
  };
  look();
  return stop;
};
