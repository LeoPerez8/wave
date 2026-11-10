/**
 * Wave's first run (docs/spec.md, "First run and library" and "The invitation"):
 * the all-files access screen, then the Wave account invitation and the tour.
 * An update never brings the invitation or Bring your music to a phone that used Wave before;
 * it brings Open song links in Wave once, since tapping links is new.
 */

import type { SongLinkHandling } from "./songLinkHandling.ts";

/** Whether the sign-in invitation is still to show on this phone, kept across launches. */
export type SignInInvitation = "due" | "done";

/** What a tour card's answer leaves it: still to show, or answered for good. */
export type FirstRunAnswer = SignInInvitation;

/**
 * Each tour card keeps its own state, independently of the account invitation:
 * `dueOnUpdate` is card 2 offered to a phone that used Wave before the tour,
 * which shows only while no song-link host is on.
 */
export type FirstRunCardState = FirstRunAnswer | "dueOnUpdate";

/** Tour order on a new install. */
export const FIRST_RUN_TOUR_CARDS = ["bringYourMusic", "songLinks"] as const;
export type FirstRunTourCard = (typeof FIRST_RUN_TOUR_CARDS)[number];
export type FirstRunTourAnswers = Readonly<Partial<Record<FirstRunTourCard, FirstRunCardState>>>;

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

/**
 * A tour card as this launch finds it, settled before access can change. A new
 * install gets the tour by the invitation's rule; a phone that used Wave
 * before gets only Open song links in Wave, once.
 */
export const firstRunCardAtLaunch = ({
  card,
  stored,
  accessGranted,
  usedBefore,
}: {
  readonly card: FirstRunTourCard;
  readonly stored: string | null;
  readonly accessGranted: boolean;
  readonly usedBefore: boolean;
}): FirstRunCardState => {
  if (stored === "dueOnUpdate") return card === "songLinks" ? stored : "done";
  const answer = signInInvitationAtLaunch({ stored, accessGranted, usedBefore });
  if (stored === null && answer === "done" && card === "songLinks") return "dueOnUpdate";
  return answer;
};

export interface FirstRunState {
  /** Wave holds all-files access. */
  readonly accessGranted: boolean;
  readonly invitation: SignInInvitation;
  readonly tour: FirstRunTourAnswers;
  /** Android's current song-link state, read again before offering card 2. */
  readonly songLinks: SongLinkHandling;
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
  /** What's New may still show in this launch, or shows now. */
  readonly whatsNewPending: boolean;
  /** A first-run card is open, or temporarily away for its sign-in or picker. */
  readonly showing: boolean;
}

/**
 * `access` is the all-files access screen, which comes first; `signInInvitation`
 * opens the invitation over Wave; `remember` keeps it done without showing it
 * (an account is already signed in); `rememberSongLinks` keeps card 2 answered
 * without showing it when every host is on. A tour card's id opens that card;
 * `done` means the first run has nothing more to show in this launch.
 */
export type FirstRunStep =
  | "access"
  | "signInInvitation"
  | "remember"
  | "rememberSongLinks"
  | "wait"
  | "done"
  | FirstRunTourCard;

/**
 * What the first run shows now. The invitation comes after the access screen,
 * once, over Wave with nothing else in front: it waits for Now Playing or
 * another card to go. A build that can't sign in leaves the invitation due
 * and goes on to the tour. An update's song-links card also waits for What's
 * New, and is answered unseen when any host is already on.
 */
export const nextFirstRunStep = (state: FirstRunState): FirstRunStep => {
  if (!state.accessGranted) return "access";
  if (state.invitation === "due" && state.accountAvailable) {
    if (state.signedIn === null) return "wait";
    if (state.signedIn) return "remember";
    if (state.showing || !state.visible || state.nowPlayingShown || state.cardOpen) return "wait";
    return "signInInvitation";
  }
  const card = FIRST_RUN_TOUR_CARDS.find((id) => (state.tour[id] ?? "done") !== "done");
  if (card === undefined) return "done";
  if (state.showing || !state.visible || state.nowPlayingShown || state.cardOpen) return "wait";
  if (state.tour[card] === "dueOnUpdate") {
    if (state.whatsNewPending) return "wait";
    return state.songLinks === "none" ? card : "rememberSongLinks";
  }
  if (card === "songLinks" && state.songLinks === "all") return "rememberSongLinks";
  return card;
};
