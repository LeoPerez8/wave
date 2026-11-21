/**
 * Now Playing's screens: the player, the Queue one swipe to its right, and
 * Related, a panel that rises from the bottom over either. This decides which
 * one shows after each thing that happens, whether the player's slots are
 * being edited, and what Android Back does: leave edit mode first, then the
 * Queue or Related, then close Now Playing. Related always returns to the
 * player, the Queue it rose over included. Lyrics is not a screen; it is a
 * state of the player, which the app keeps.
 */

import { settleSheet, type SheetState } from "./sheet.ts";

/** A screen of Now Playing. */
export type NowPlayingScreen = "player" | "queue" | "related";

/** The screens that sit side by side, a swipe apart; Related rises over them. */
export type NowPlayingPage = Exclude<NowPlayingScreen, "related">;

/** What Now Playing shows. */
export interface NowPlayingScreens {
  readonly screen: NowPlayingScreen;
  /**
   * Edit mode: the player's seven slots are being edited. Only the player is
   * edited, and it stays in place until edit mode is left.
   */
  readonly editing: boolean;
}

export type NowPlayingScreensEvent =
  /**
   * Something opens a screen: the Queue's edge mark, Related's chevron and the
   * playing song's card, or Related's arrow asking for the player.
   */
  | { readonly type: "show"; readonly screen: NowPlayingScreen }
  /** A button for a screen: opens it, or returns to the player from it. */
  | { readonly type: "toggle"; readonly screen: Exclude<NowPlayingScreen, "player"> }
  /** A swipe between screens was let go and settles on this one (`settleScreenSwipe`). */
  | { readonly type: "swipe"; readonly to: NowPlayingPage }
  /** The playing song's header on a screen other than the player was tapped. */
  | { readonly type: "headerTap" }
  /** A drag down on Related's header was let go far enough to leave it. */
  | { readonly type: "dragDown" }
  /** YouTube Music was turned off, or is off: Related needs it. */
  | { readonly type: "ytMusicOff" }
  /** A long press on a slot, or the screen reader's Edit Buttons: edit mode starts. */
  | { readonly type: "edit" }
  /** Done was tapped: edit mode ends. */
  | { readonly type: "done" }
  /** Android Back. */
  | { readonly type: "back" }
  /** Now Playing has gone out of sight. */
  | { readonly type: "closed" };

export interface NowPlayingScreensStep {
  readonly screens: NowPlayingScreens;
  /** Now Playing itself closes. */
  readonly close: boolean;
}

/** Every open of Now Playing starts here. */
export const NOW_PLAYING_OPENS_ON: NowPlayingScreens = { screen: "player", editing: false };

/** Whether the player and Queue pages can take a swipe between them. */
export const nowPlayingPageSwipesEnabled = (screens: NowPlayingScreens): boolean =>
  !screens.editing && screens.screen !== "related";

/**
 * Whether an upward drag on the player opens Related: on the player, out of
 * edit mode, with a song on ([playing]) and YouTube Music on ([ytMusic]),
 * which Related reads. The app leaves the Lyrics body out of the drag, so an
 * upward drag there scrolls the lyrics.
 */
export const nowPlayingRelatedSwipeEnabled = ({
  screens,
  ytMusic,
  playing,
}: {
  readonly screens: NowPlayingScreens;
  readonly ytMusic: boolean;
  readonly playing: boolean;
}): boolean => screens.screen === "player" && !screens.editing && ytMusic && playing;

/**
 * Where Related's panel settles when an upward drag on the player lets go
 * ([translationY] and [velocityY] in dp and dp/s, positive down; [height] the
 * panel's full travel): by the travel and speed that open the sheet
 * (`settleSheet`), a flick back down cancelling it.
 */
export const settleRelatedRise = ({
  translationY,
  velocityY,
  height,
}: {
  readonly translationY: number;
  readonly velocityY: number;
  readonly height: number;
}): SheetState =>
  settleSheet({
    from: "closed",
    // The panel sits below its risen place by the screen less the finger's rise.
    offset: height - Math.max(0, -translationY),
    velocity: velocityY,
    height,
  });

const show = (screen: NowPlayingScreen, editing = false): NowPlayingScreensStep => ({
  screens: { screen, editing },
  close: false,
});

export const stepNowPlayingScreens = (
  screens: NowPlayingScreens,
  event: NowPlayingScreensEvent,
): NowPlayingScreensStep => {
  if (screens.editing) {
    // Done, Back and Now Playing closing leave edit mode; nothing else moves the player.
    const leaves = event.type === "done" || event.type === "back" || event.type === "closed";
    return show("player", !leaves);
  }
  switch (event.type) {
    case "edit":
      // The slots are the player's: no other screen is edited.
      return show(screens.screen, screens.screen === "player");
    case "done":
      return show(screens.screen);
    case "show":
      return show(event.screen);
    case "toggle":
      return show(screens.screen === event.screen ? "player" : event.screen);
    case "swipe":
      return show(event.to);
    case "headerTap":
    case "closed":
      return show("player");
    case "dragDown":
    case "ytMusicOff":
      return show(screens.screen === "related" ? "player" : screens.screen);
    case "back":
      return screens.screen === "player" ? { screens, close: true } : show("player");
  }
};
