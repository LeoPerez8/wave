/**
 * Wave's first run (docs/spec.md, "First run and library" and "The invitation"):
 * the all-files access screen, then the Wave account invitation and the tour.
 * An update never brings these new-install cards to a phone that used Wave before.
 */

/** Whether the sign-in invitation is still to show on this phone, kept across launches. */
export type SignInInvitation = "due" | "done";

/** Each tour card keeps its own answer, independently of the account invitation. */
export type FirstRunAnswer = SignInInvitation;

/** Tour order. The next ticket adds the song-links card after Bring your music. */
export const FIRST_RUN_TOUR_CARDS = ["bringYourMusic"] as const;
export type FirstRunTourCard = (typeof FIRST_RUN_TOUR_CARDS)[number];
export type FirstRunTourAnswers = Readonly<Partial<Record<FirstRunTourCard, FirstRunAnswer>>>;

/**
 * The invitation as this launch finds it. Nothing [stored] means the first
 * launch since Wave had it: due on a new install, which opens without
 * all-files access and with nothing kept, and done on a phone that has
 * either ([usedBefore]), since that phone was using Wave before the update.
 */
export const signInInvitationAtLaunch = ({
  stored,
  accessGranted,
  usedBefore,
}: {
  readonly stored: string | null;
  readonly accessGranted: boolean;
  readonly usedBefore: boolean;
}): SignInInvitation => {
  if (stored !== null) return stored === "due" ? "due" : "done";
  return accessGranted || usedBefore ? "done" : "due";
};

/** Tour cards use the invitation's new-install rule, settled before access can change. */
export const firstRunCardAtLaunch = signInInvitationAtLaunch;

export interface FirstRunState {
  /** Wave holds all-files access. */
  readonly accessGranted: boolean;
  readonly invitation: SignInInvitation;
  readonly tour: FirstRunTourAnswers;
  /** This build has the sync service set up, so it can sign in to a Wave account. */
  readonly accountAvailable: boolean;
  /** Whether a Wave account is signed in; null until the native module has said. */
  readonly signedIn: boolean | null;
  /** Wave is in the foreground. */
  readonly visible: boolean;
  /** Now Playing is up, or on its way up or down. */
  readonly nowPlayingShown: boolean;
  /** A card is open, the invitation included. */
  readonly cardOpen: boolean;
  /** A first-run card is open, or temporarily away for its sign-in or picker. */
  readonly showing: boolean;
}

/**
 * `access` is the all-files access screen, which comes first; `signInInvitation`
 * opens the invitation over Wave; `remember` keeps it done without showing it
 * (an account is already signed in). A tour card's id opens that card;
 * `done` means the first run has nothing more to show in this launch.
 */
export type FirstRunStep =
  "access" | "signInInvitation" | "remember" | "wait" | "done" | FirstRunTourCard;

/**
 * What the first run shows now. The invitation comes after the access screen,
 * once, over Wave with nothing else in front: it waits for Now Playing or
 * another card to go. A build that can't sign in leaves the invitation due
 * and goes on to the tour.
 */
export const nextFirstRunStep = (state: FirstRunState): FirstRunStep => {
  if (!state.accessGranted) return "access";
  if (state.invitation === "due" && state.accountAvailable) {
    if (state.signedIn === null) return "wait";
    if (state.signedIn) return "remember";
    if (state.showing || !state.visible || state.nowPlayingShown || state.cardOpen) return "wait";
    return "signInInvitation";
  }
  const card = FIRST_RUN_TOUR_CARDS.find((id) => state.tour[id] === "due");
  if (card === undefined) return "done";
  if (state.showing || !state.visible || state.nowPlayingShown || state.cardOpen) return "wait";
  return card;
};
