import { en, type Catalogue } from "./catalogueEn.ts";
import { recognizeCardView, type RecognizeCard } from "./recognize.ts";

/** A notification from a tile session, which has no card to show its end on. */
export type RecognizeTileNotice =
  | {
      readonly kind: "match";
      readonly title: string;
      readonly text: string;
      readonly coverUrl: string | null;
    }
  | {
      readonly kind: "failure";
      readonly title: string;
      readonly text: string;
      readonly action: "tryAgain" | "useMicrophone";
      readonly actionLabel: string;
    };

/** Whether [card] says why a session gave no song. Declining phone audio ends like Cancel. */
const failed = (card: RecognizeCard): boolean => {
  if (card.kind === "offline" || card.kind === "denied") return true;
  return card.kind === "ended" && card.end.kind !== "match" && card.end.kind !== "consentDeclined";
};

/**
 * What a tile session's state tells the user: the match as soon as Shazam answers, or
 * the card's reason with what helps. Nothing while it listens or once the song is
 * settled. The denied card's Open Settings becomes Try Again, because a tap without the
 * microphone opens the card, which can ask.
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
  if (!failed(card)) return null;
  const view = recognizeCardView(card, undefined, catalogue);
  const action = view.actions.includes("useMicrophone") ? "useMicrophone" : "tryAgain";
  return {
    kind: "failure",
    title: view.title,
    text: view.lines[0]!,
    action,
    actionLabel: catalogue.recognizeTile[action],
  };
};
