import {
  FIRST_RUN_TOUR_CARDS,
  firstRunCardAtLaunch,
  nextFirstRunStep,
  signInInvitationAtLaunch,
  type FirstRunState,
  type SignInInvitation,
  type FirstRunAnswer,
  type FirstRunTourCard,
} from "@wave/core";

/**
 * What Core's first-run step reads from the phone, as it stands when asked: its whole state but
 * the invitation, tour answers and whether a first-run card shows, which the runner keeps.
 */
export type FirstRunSurroundings = Omit<FirstRunState, "invitation" | "tour" | "showing">;

export interface FirstRunRunnerOptions {
  /** The invitation as kept across launches; null before the first launch that had it. */
  readonly stored: {
    readonly get: () => string | null;
    readonly set: (value: SignInInvitation) => void;
  };
  readonly tourStored: {
    readonly get: (card: FirstRunTourCard) => string | null;
    readonly set: (card: FirstRunTourCard, value: FirstRunAnswer) => void;
  };
  /** Wave held all-files access as this launch began. */
  readonly accessGrantedAtLaunch: boolean;
  /** Something Wave keeps says this phone used Wave before (a version it recorded). */
  readonly usedBefore: boolean;
  readonly surroundings: () => FirstRunSurroundings;
  /**
   * Opens the invitation; `answered` says the user dismissed it or chose Sign In with Google,
   * after which it never shows again.
   */
  readonly show: (answered: () => void) => void;
  /** A picker/sign-in returns `due`; an answer returns `done`. Until then the tour waits. */
  readonly showTourCard: (card: FirstRunTourCard, finish: (answer: FirstRunAnswer) => void) => void;
  /** Nothing more can happen in this launch, so what follows the phone can stop. */
  readonly onFinished?: () => void;
}

/**
 * Carries out Core's `nextFirstRunStep` for the invitation and tour. The launch's first look
 * settles, once, whether this phone is a new install; it acts again when told something changed.
 */
export const createFirstRunRunner = ({
  stored,
  tourStored,
  accessGrantedAtLaunch,
  usedBefore,
  surroundings,
  show,
  showTourCard,
  onFinished,
}: FirstRunRunnerOptions) => {
  const kept = stored.get();
  let invitation = signInInvitationAtLaunch({
    stored: kept,
    accessGranted: accessGrantedAtLaunch,
    usedBefore,
  });
  const tour: Partial<Record<FirstRunTourCard, FirstRunAnswer>> = {};
  for (const card of FIRST_RUN_TOUR_CARDS) {
    const answer = tourStored.get(card);
    tour[card] = firstRunCardAtLaunch({
      stored: answer,
      accessGranted: accessGrantedAtLaunch,
      // An invitation kept by an older version also proves this isn't a new install.
      usedBefore: usedBefore || kept !== null,
    });
    if (answer !== tour[card]) tourStored.set(card, tour[card]);
  }
  if (kept !== invitation) stored.set(invitation);
  let showing = false;
  let finished = false;

  const done = (): void => {
    invitation = "done";
    stored.set("done");
  };

  const reconsider = (): void => {
    if (finished) return;
    const step = nextFirstRunStep({ ...surroundings(), invitation, tour, showing });
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
        reconsider();
        return;
      case "done":
        finished = true;
        onFinished?.();
        return;
      case "access":
      case "wait":
        return;
      default:
        showing = true;
        showTourCard(step, (answer) => {
          showing = false;
          if (answer === "done") {
            tour[step] = answer;
            tourStored.set(step, answer);
          }
          reconsider();
        });
    }
  };

  return {
    reconsider,
    /** Whether this launch still needs to follow first run. */
    isDue: (): boolean =>
      !finished && (invitation === "due" || FIRST_RUN_TOUR_CARDS.some((id) => tour[id] === "due")),
  };
};
