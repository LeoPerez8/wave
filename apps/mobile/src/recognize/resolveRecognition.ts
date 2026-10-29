import {
  resolveRecognizedSong,
  type RecognizedSong,
  type RecognizeResolution,
  type RecognizeTrack,
  type SearchAsker,
  type YtSong,
  type YtSongSearch,
} from "@wave/core";

/** Library and network boundaries; the Songs search is the shared allowance's adapter. */
export interface RecognitionLookup<L extends RecognizeTrack, S extends YtSong> {
  readonly library: () => Promise<readonly L[]>;
  readonly ytMusic: () => boolean;
  readonly search: (
    asker: SearchAsker,
    query: string,
    signal: AbortSignal,
  ) => Promise<YtSongSearch<S> | null>;
}

export const resolveRecognition = async <L extends RecognizeTrack, S extends YtSong>(
  ports: RecognitionLookup<L, S>,
  song: RecognizedSong,
  signal: AbortSignal,
): Promise<RecognizeResolution<L, S>> => {
  const library = await ports.library();
  if (signal.aborted) throw new Error("Recognition closed");
  const first = resolveRecognizedSong<L, S>(
    song,
    library,
    ports.ytMusic() ? undefined : "disabled",
  );
  if (first.kind === "resolved") return first;
  const answer = await ports
    .search("search", first.query, signal)
    .catch(() => ({ ok: false, reason: "failed" }) as const);
  if (signal.aborted) throw new Error("Recognition closed");
  const result = resolveRecognizedSong(song, library, answer ?? { ok: false, reason: "failed" });
  if (result.kind !== "resolved") throw new Error("Recognition search has no answer");
  return result;
};
