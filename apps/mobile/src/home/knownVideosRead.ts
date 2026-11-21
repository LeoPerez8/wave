/** Known-video source versions: unrelated Library changes keep the answer and in-flight read. */
import * as Effect from "effect/Effect";
import { createSourceRead } from "../lib/sourceRead.ts";
import type { LibraryStore } from "../library/LibraryStore.ts";

export const createKnownVideosRead = <E, R>(read: Effect.Effect<readonly string[], E, R>) =>
  createSourceRead(read, ["plays", "tracks", "playlists", "streamed"]);

/** The videos the owner knows, each once: one read, however many there are (#1351). */
export const readKnownVideos = (store: Pick<LibraryStore["Service"], "knownVideos">) =>
  store.knownVideos;
