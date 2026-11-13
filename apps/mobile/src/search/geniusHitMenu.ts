/**
 * A Genius result in Search's Lyrics section, resolved as Recognize resolves a
 * heard song (#1097), and its long-press menu: Recognize's result actions for
 * what it resolved to, then Open in Genius (Core's `geniusLyricsResultActions`, #1099).
 */
import {
  geniusLyricsResultActionLabels,
  geniusLyricsResultActions,
  resolveRecognizedSong,
  type Catalogue,
  type GeniusLyricsHit,
  type GeniusLyricsResultAction,
  type RecognizedSong,
  type RecognizeResult,
  type RecognizeResultOptions,
  type RecognizeTrack,
  type YtSong,
} from "@wave/core";

import { resolveRecognition, type RecognitionLookup } from "../recognize/resolveRecognition.ts";

/** What Recognize's resolver hears for a Genius hit: its title and credit, with its cover. */
export const geniusHitSong = (hit: GeniusLyricsHit): RecognizedSong => ({
  title: hit.title,
  artist: hit.artist,
  album: null,
  coverUrl: hit.artworkUrl,
  isrc: null,
  releaseYear: null,
});

/**
 * The Library song first, then one Songs search with YT Music on. A lookup that
 * fails leaves the hit unsearched, so its menu still offers what needs no video.
 */
export const resolveGeniusHit = async <L extends RecognizeTrack, S extends YtSong>(
  lookup: RecognitionLookup<L, S>,
  hit: GeniusLyricsHit,
  signal: AbortSignal,
): Promise<RecognizeResult<L, S>> => {
  const song = geniusHitSong(hit);
  try {
    return (await resolveRecognition(lookup, song, signal)).result;
  } catch {
    const unsearched = resolveRecognizedSong<L, S>(song, [], { ok: false, reason: "failed" });
    if (unsearched.kind !== "resolved") throw new Error("A failed lookup always resolves");
    return unsearched.result;
  }
};

/** A song the menu plays: the Library track or the streamed song. */
export type GeniusHitPlayable<L, S> =
  | { readonly source: "library"; readonly track: L }
  | { readonly source: "stream"; readonly song: S };

/** What the menu's entries do. */
export interface GeniusHitEffects<L extends RecognizeTrack, S extends YtSong> {
  readonly play: (song: GeniusHitPlayable<L, S>) => void;
  readonly playNext: (song: GeniusHitPlayable<L, S>) => void;
  readonly addToPlaylist: (result: RecognizeResult<L, S>) => void;
  readonly goToAlbum: (track: L) => void;
  readonly download: (song: S) => void;
  readonly cancelDownload: (song: S) => void;
  readonly openUrl: (url: string) => void;
}

export interface GeniusHitMenuEntry {
  readonly action: GeniusLyricsResultAction;
  readonly label: string;
  readonly run: () => void;
}

/** The menu's entries for [hit] resolved to [result], in Core's order and [catalogue]'s language. */
export const geniusHitMenu = <L extends RecognizeTrack, S extends YtSong>(
  hit: GeniusLyricsHit,
  result: RecognizeResult<L, S>,
  options: RecognizeResultOptions,
  catalogue: Catalogue,
  effects: GeniusHitEffects<L, S>,
): readonly GeniusHitMenuEntry[] => {
  const labels = geniusLyricsResultActionLabels(catalogue);
  const playable: GeniusHitPlayable<L, S> | null =
    result.kind === "library"
      ? { source: "library", track: result.track }
      : result.kind === "stream"
        ? { source: "stream", song: result.song }
        : null;
  const run = (action: GeniusLyricsResultAction): void => {
    switch (action) {
      case "play":
        if (playable !== null) effects.play(playable);
        return;
      case "playNext":
        if (playable !== null) effects.playNext(playable);
        return;
      case "addToPlaylist":
        effects.addToPlaylist(result);
        return;
      case "goToAlbum":
        if (result.kind === "library") effects.goToAlbum(result.track);
        return;
      case "download":
      case "retryDownload":
        if (result.kind === "stream") effects.download(result.song);
        return;
      case "cancelDownload":
        if (result.kind === "stream") effects.cancelDownload(result.song);
        return;
      case "openInGenius":
        effects.openUrl(hit.url);
        return;
    }
  };
  return geniusLyricsResultActions(result, options).map((action) => ({
    action,
    label: labels[action],
    run: () => run(action),
  }));
};
