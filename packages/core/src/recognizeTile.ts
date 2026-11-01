import { en, type Catalogue } from "./catalogueEn.ts";
import { recognizeCardView, type RecognizeCard } from "./recognize.ts";

/** A notification from a tile session, which has no card to show its end on. */
export interface RecognizeTileNotice {
  readonly kind: "match" | "noMatch";
  readonly title: string;
  readonly text: string;
  readonly coverUrl: string | null;
}

/**
 * What a tile session's state tells the user: the match as soon as Shazam answers, or
 * No match. Nothing while it listens, once the song is settled, or for what #900 will
 * add: the card's other reasons.
 */
export const recognizeTileNotice = (
  card: RecognizeCard,
  catalogue: Catalogue = en,
): RecognizeTileNotice | null => {
  if (card.kind === "resolving")
    return {
      kind: "match",
      title: card.song.title,
      text: card.song.artist,
      coverUrl: card.song.coverUrl,
    };
  if (card.kind === "ended" && card.end.kind === "noMatch") {
    const view = recognizeCardView(card, undefined, catalogue);
    return { kind: "noMatch", title: view.title, text: view.lines[0]!, coverUrl: null };
  }
  return null;
};
