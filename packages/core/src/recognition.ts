/** Resolves a recognized song into the same songs playlists and playback already use. */
import { ytDownloadActions, type YtDownloadAction, type YtDownloadStatus } from "./ytDownloads.ts";
import { splitCredit } from "./credits.ts";
import type { PlaylistSong, UnavailableSong, UnsearchedSong } from "./playlistEntries.ts";
import type { RecognizedSong } from "./recognize.ts";
import type { YtSongSearch } from "./spotifyImport.ts";
import {
  joinArtists,
  recordingMatches,
  libraryFinder,
  type YtSong,
  type LibrarySongKey,
} from "./ytMusic.ts";

/** The Track fields recognition needs; a result preserves the caller's full row. */
export interface RecognizeTrack extends LibrarySongKey {
  readonly id: number;
  readonly album: string;
}

export type RecognizeResult<L extends RecognizeTrack = RecognizeTrack, S extends YtSong = YtSong> =
  | {
      readonly kind: "library";
      readonly track: L;
      readonly song: UnsearchedSong;
    }
  | { readonly kind: "stream"; readonly song: S }
  | { readonly kind: "unavailable"; readonly song: UnavailableSong }
  | { readonly kind: "unsearched"; readonly song: UnsearchedSong };

export type RecognizeLookup =
  "library" | "match" | "notFound" | "failed" | "disabled" | "cancelled";

export interface RecognizeResolution<
  L extends RecognizeTrack = RecognizeTrack,
  S extends YtSong = YtSong,
> {
  readonly kind: "resolved";
  readonly lookup: RecognizeLookup;
  readonly result: RecognizeResult<L, S>;
}

/**
 * Library first, without a duration tie-break. No answer asks for one Songs search;
 * disabled or failed answers keep an unsearched entry, and a completed search
 * keeps its first match or an unavailable entry. Nothing is persisted here.
 */
export const resolveRecognizedSong = <L extends RecognizeTrack, S extends YtSong = YtSong>(
  heard: RecognizedSong,
  library: readonly L[],
  answer?: YtSongSearch<S> | "disabled",
): RecognizeResolution<L, S> | { readonly kind: "search"; readonly query: string } => {
  const song: UnsearchedSong = {
    title: heard.title,
    artists: splitCredit(heard.artist),
    album: heard.album,
    durationMs: null,
    artworkUrl: heard.coverUrl,
  };
  const track = libraryFinder(library)(song);
  if (track === null) {
    if (answer !== undefined && answer !== "disabled" && answer.ok) {
      const found = answer.songs.find((candidate) =>
        recordingMatches(
          {
            title: candidate.title,
            artist: joinArtists(candidate.artists),
            durationMs: candidate.durationMs ?? 0,
          },
          song,
        ),
      );
      if (found)
        return { kind: "resolved", lookup: "match", result: { kind: "stream", song: found } };
      return {
        kind: "resolved",
        lookup: "notFound",
        result: { kind: "unavailable", song: { ...song, reason: "notFound" } },
      };
    }
    if (answer !== undefined)
      return {
        kind: "resolved",
        lookup:
          answer === "disabled" || (!answer.ok && answer.reason === "disabled")
            ? "disabled"
            : "failed",
        result: { kind: "unsearched", song },
      };
    return { kind: "search", query: `${heard.title} ${heard.artist}` };
  }
  return {
    kind: "resolved",
    lookup: "library",
    result: {
      kind: "library",
      track,
      song: {
        ...song,
        title: track.title,
        artists: splitCredit(track.artist),
        album: track.album,
        durationMs: track.durationMs,
      },
    },
  };
};

/** Actions shared by the result card and any other Recognize entry point. */
export type RecognizeResultAction =
  "play" | "playNext" | "addToPlaylist" | "goToAlbum" | YtDownloadAction | "listenAgain";

export interface RecognizeResultOptions {
  readonly ytMusic: boolean;
  readonly status?: YtDownloadStatus | null;
  readonly inLibrary?: boolean;
}

export const recognizeResultActions = (
  result: RecognizeResult,
  { ytMusic, status = null, inLibrary = false }: RecognizeResultOptions,
): readonly RecognizeResultAction[] => {
  const playable = result.kind === "library" || (result.kind === "stream" && ytMusic);
  const play: RecognizeResultAction[] = playable ? ["play", "playNext"] : [];
  const more: RecognizeResultAction[] =
    result.kind === "library"
      ? ["goToAlbum"]
      : result.kind === "stream" && ytMusic
        ? ytDownloadActions(status, { inLibrary })
        : [];
  // Save actions live here once, so another action can apply to every result kind.
  return [...play, "addToPlaylist", ...more, "listenAgain"];
};

/** The picker and one-tap saves both take the existing playlist entry union. */
export const recognizePlaylistSong = <L extends RecognizeTrack, S extends YtSong>(
  result: RecognizeResult<L, S>,
): PlaylistSong<S> => {
  switch (result.kind) {
    case "library":
      return { source: "library", trackId: result.track.id };
    case "stream":
      return { source: "stream", song: result.song };
    case "unavailable":
      return { source: "unavailable", song: result.song };
    case "unsearched":
      return { source: "unsearched", song: result.song };
  }
};
