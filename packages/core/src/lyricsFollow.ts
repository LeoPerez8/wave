/**
 * When synced lyrics move on their own (docs/spec.md, "Karaoke"). With Karaoke
 * on they follow the song; with it off the sung line is placed once, when
 * they open, and they stay put.
 */

/** What the lyrics do: nothing, jump there without a slide, or slide there. */
export type LyricsMove = "stay" | "place" | "slide";

export interface LyricsFollow {
  readonly karaoke: boolean;
  /** Share is picking lines. */
  readonly picking: boolean;
  readonly following: boolean;
  /** The sung line has been put in place since the lyrics opened. */
  readonly placed: boolean;
}

export type LyricsFollowEvent =
  /** The lines were laid out, or the view resized. */
  | "laidOut"
  /** A "place" happened (it can't while there's no room to scroll yet). */
  | "placed"
  | "lineChanged"
  | "lineTapped"
  | "fingerDown"
  /** The wait after the finger left is over. */
  | "resumeDue"
  /** The screen went away. */
  | "hidden"
  | "pickStarted"
  | "pickEnded"
  | "karaokeOn"
  | "karaokeOff";

/** Lyrics just opened, with the sung line still to place. */
export const lyricsFollowStart = ({
  karaoke,
  picking,
}: {
  readonly karaoke: boolean;
  readonly picking: boolean;
}): LyricsFollow => ({ karaoke, picking, following: karaoke && !picking, placed: false });

/** What [event] does to [state], and how the lyrics move for it. */
export const lyricsFollowStep = (
  state: LyricsFollow,
  event: LyricsFollowEvent,
): { readonly state: LyricsFollow; readonly move: LyricsMove } => {
  const { karaoke, picking, following, placed } = state;
  switch (event) {
    case "laidOut":
      return { state, move: following || !placed ? "place" : "stay" };
    case "placed":
      return { state: { ...state, placed: true }, move: "stay" };
    case "lineChanged":
      return { state, move: following ? "slide" : "stay" };
    case "lineTapped":
      return karaoke
        ? { state: { ...state, following: true }, move: "slide" }
        : { state, move: "stay" };
    case "fingerDown":
      return { state: { ...state, following: false }, move: "stay" };
    case "resumeDue":
      return karaoke && !picking
        ? { state: { ...state, following: true }, move: "slide" }
        : { state, move: "stay" };
    case "hidden":
      return { state: { ...state, following: karaoke && !picking }, move: "stay" };
    case "pickStarted":
      return { state: { ...state, picking: true, following: false }, move: "stay" };
    case "pickEnded":
      return {
        state: { ...state, picking: false, following: karaoke },
        move: karaoke ? "slide" : "stay",
      };
    case "karaokeOn":
      return {
        state: { ...state, karaoke: true, following: !picking },
        move: picking ? "stay" : "slide",
      };
    case "karaokeOff":
      return { state: { ...state, karaoke: false, following: false }, move: "stay" };
  }
};
