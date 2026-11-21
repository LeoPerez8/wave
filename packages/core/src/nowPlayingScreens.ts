/**
 * Now Playing's screens: the player, the Queue one swipe to its right, and
 * Related, a panel that rises from the bottom over either. This decides which
 * one shows after each thing that happens, and what Android Back does: leave
 * the Queue or Related first, then close Now Playing. Related always returns
 * to the player, the Queue it rose over included. Lyrics is not a screen; it
 * is a state of the player, which the app keeps.
 */

/** A screen of Now Playing. */
export type NowPlayingScreen = "player" | "queue" | "related";

/** The screens that sit side by side, a swipe apart; Related rises over them. */
export type NowPlayingPage = Exclude<NowPlayingScreen, "related">;

/** What Now Playing shows. An object, so later states (a screen being edited) join it. */
export interface NowPlayingScreens {
  readonly screen: NowPlayingScreen;
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
export const NOW_PLAYING_OPENS_ON: NowPlayingScreens = { screen: "player" };

const show = (screen: NowPlayingScreen): NowPlayingScreensStep => ({
  screens: { screen },
  close: false,
});

export const stepNowPlayingScreens = (
  screens: NowPlayingScreens,
  event: NowPlayingScreensEvent,
): NowPlayingScreensStep => {
  switch (event.type) {
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
