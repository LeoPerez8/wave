import { en, type Catalogue } from "./catalogueEn.ts";
import type { UnsearchedSong } from "./playlistEntries.ts";
import { resolveRecognizedSong, type RecognizeResult, type RecognizeTrack } from "./recognition.ts";
import { recognizeCardView, type RecognizeCard, type RecognizedSong } from "./recognize.ts";
import type { YtSong } from "./ytMusic.ts";

/** A notification from a tile session, which has no card to show its end on. */
export type RecognizeTileNotice =
  | {
      readonly kind: "match";
      readonly title: string;
      readonly text: string;
      readonly coverUrl: string | null;
      /** Kept song opened by a tap on the match notification. */
      readonly match: string | null;
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
      match: writeRecognizeMatch(card.song),
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

/** A result as a notification keeps it: a Library song is read again, as it may have changed. */
type KeptRecognizeResult<S extends YtSong> =
  | { readonly kind: "library"; readonly trackId: number; readonly song: UnsearchedSong }
  | Exclude<RecognizeResult<RecognizeTrack, S>, { readonly kind: "library" }>;

/**
 * The latest tile match, kept by its notification for as long as that stays, so a tap
 * can show it after Wave has closed. No audio, no signature, and no result until its
 * lookup has ended.
 */
export interface RecognizeMatch<S extends YtSong = YtSong> {
  readonly song: RecognizedSong;
  readonly result: KeptRecognizeResult<S> | null;
}

export const writeRecognizeMatch = <L extends RecognizeTrack, S extends YtSong>(
  song: RecognizedSong,
  result: RecognizeResult<L, S> | null = null,
): string =>
  JSON.stringify({
    song,
    result:
      result?.kind === "library"
        ? { kind: "library", trackId: result.track.id, song: result.song }
        : result,
  } satisfies RecognizeMatch<S>);

const isFields = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const KEPT_KINDS: readonly unknown[] = ["library", "stream", "unavailable", "unsearched"];

/** Null for text no `writeRecognizeMatch` wrote. */
export const readRecognizeMatch = <S extends YtSong = YtSong>(
  text: string,
): RecognizeMatch<S> | null => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isFields(value) || !isFields(value.song)) return null;
  if (typeof value.song.title !== "string" || typeof value.song.artist !== "string") return null;
  for (const field of ["album", "coverUrl", "isrc"])
    if (value.song[field] !== null && typeof value.song[field] !== "string") return null;
  if (value.song.releaseYear !== null && typeof value.song.releaseYear !== "number") return null;
  const { result } = value;
  if (result !== null && !(isFields(result) && KEPT_KINDS.includes(result.kind))) return null;
  if (isFields(result)) {
    const song = result.song;
    if (
      !isFields(song) ||
      typeof song.title !== "string" ||
      !Array.isArray(song.artists) ||
      !song.artists.every((artist) => typeof artist === "string") ||
      !(song.album === null || typeof song.album === "string") ||
      !(song.durationMs === null || typeof song.durationMs === "number") ||
      !(song.artworkUrl === null || typeof song.artworkUrl === "string")
    )
      return null;
    if (
      result.kind === "library" &&
      (typeof result.trackId !== "number" || !Number.isInteger(result.trackId))
    )
      return null;
    if (
      result.kind === "stream" &&
      (typeof song.videoId !== "string" || typeof song.explicit !== "boolean")
    )
      return null;
    if (result.kind === "unavailable" && song.reason !== "notFound" && song.reason !== "localFile")
      return null;
  }
  return { song: value.song, result } as unknown as RecognizeMatch<S>;
};

/**
 * What the card shows for a kept match. It never searches: a lookup that didn't end, or
 * a Library song that has since gone, settles on what the Library holds now.
 */
export const recognizeMatchResult = <L extends RecognizeTrack, S extends YtSong>(
  match: RecognizeMatch<S>,
  library: readonly L[],
): RecognizeResult<L, S> => {
  const { result } = match;
  if (result !== null && result.kind !== "library") return result;
  const track = library.find((candidate) => candidate.id === result?.trackId);
  if (result !== null && track !== undefined) return { kind: "library", track, song: result.song };
  const settled = resolveRecognizedSong<L, S>(match.song, library, "disabled");
  if (settled.kind !== "resolved") throw new Error("A disabled lookup needs no search");
  return settled.result;
};
