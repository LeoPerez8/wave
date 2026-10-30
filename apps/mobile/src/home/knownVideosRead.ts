/** Known-video source versions: unrelated Library changes keep the answer and in-flight read. */
import * as Effect from "effect/Effect";
import { createSourceRead } from "../lib/sourceRead.ts";
import { KNOWN_VIDEOS_START } from "../library/db/mixKnown.ts";
import { readVideoPages } from "../library/db/videoPages.ts";
import type { LibraryStore } from "../library/LibraryStore.ts";

export const createKnownVideosRead = <E, R>(read: Effect.Effect<readonly string[], E, R>) =>
  createSourceRead(read, ["plays", "tracks", "playlists", "streamed"]);

/** Every page of the videos the owner knows, each once, with [between] between pages. */
export const readKnownVideos = <E, R>(
  store: Pick<LibraryStore["Service"], "knownVideosPage">,
  between: Effect.Effect<void, E, R>,
) => readVideoPages(KNOWN_VIDEOS_START, store.knownVideosPage, between);
