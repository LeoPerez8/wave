/** Known-video source versions: unrelated Library changes keep the answer and in-flight read. */
import type { LibraryChange } from "@wave/core";
import * as Effect from "effect/Effect";
import { sharedRead } from "../lib/sharedRead.ts";
export const createKnownVideosRead = <E, R>(read: Effect.Effect<readonly string[], E, R>) => {
  const shared = sharedRead(read);
  return {
    get: shared.get,
    change: (change: LibraryChange) => {
      if (["plays", "tracks", "playlists", "streamed"].includes(change.kind)) shared.forget();
    },
    dispose: shared.dispose,
  };
};
