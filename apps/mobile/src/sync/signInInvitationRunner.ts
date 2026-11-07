import {
  nextFirstRunStep,
  signInInvitationAtLaunch,
  type FirstRunState,
  type SignInInvitation,
} from "@wave/core";

/**
 * What Core's first-run step reads from the phone, as it stands when asked: its whole state but
 * the invitation and whether it shows, which the runner keeps.
 */
export type SignInInvitationSurroundings = Omit<FirstRunState, "invitation" | "showing">;

export interface SignInInvitationRunnerOptions {
  /** The invitation as kept across launches; null before the first launch that had it. */
  readonly stored: {
    readonly get: () => string | null;
    readonly set: (value: SignInInvitation) => void;
  };
  /** Wave held all-files access as this launch began. */
  readonly accessGrantedAtLaunch: boolean;
  /** Something Wave keeps says this phone used Wave before (a version it recorded). */
  readonly usedBefore: boolean;
  readonly surroundings: () => SignInInvitationSurroundings;
  /**
   * Opens the invitation; `answered` says the user dismissed it or chose Sign In with Google,
   * after which it never shows again.
   */
  readonly show: (answered: () => void) => void;
  /** Nothing more can happen in this launch, so what follows the phone can stop. */
  readonly onFinished?: () => void;
}

/**
 * Carries out Core's `nextFirstRunStep` for the sign-in invitation. The launch's first look
 * settles, once, whether this phone is a new install; it acts again when told something changed.
 */
export const createSignInInvitationRunner = ({
  stored,
  accessGrantedAtLaunch,
  usedBefore,
  surroundings,
  show,
  onFinished,
}: SignInInvitationRunnerOptions) => {
  const kept = stored.get();
  let invitation = signInInvitationAtLaunch({
    stored: kept,
    accessGranted: accessGrantedAtLaunch,
    usedBefore,
  });
  if (kept !== invitation) stored.set(invitation);
  let showing = false;
  let finished = false;

  const done = (): void => {
    invitation = "done";
    stored.set("done");
  };

  const reconsider = (): void => {
    if (finished) return;
    const step = nextFirstRunStep({ ...surroundings(), invitation, showing });
    switch (step) {
      case "signInInvitation":
        showing = true;
        show(() => {
          showing = false;
          done();
          reconsider();
        });
        return;
      case "remember":
        done();
        finished = true;
        onFinished?.();
        return;
      case "done":
        finished = true;
        onFinished?.();
        return;
      case "access":
      case "wait":
        return;
    }
  };

  return {
    reconsider,
    /** Whether the invitation may still show on this phone (it isn't answered or remembered). */
    isDue: (): boolean => invitation === "due",
  };
};
