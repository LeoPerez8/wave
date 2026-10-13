import * as Effect from "effect/Effect";
import { LibraryStore } from "./LibraryStore";
import { WaveSoulseek } from "@/native/waveSoulseek";

/** Reads committed folder policy; every publication and import also reads it afresh. */
export const refreshDownloadPolicy = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const [roots, excludedFolders] = yield* Effect.all([store.listRoots, store.excludedFolders]);
  const revision = yield* Effect.promise(() =>
    WaveSoulseek.refreshDownloadPolicy(
      roots.map((root) => root.path),
      excludedFolders,
    ),
  );
  return { roots, excludedFolders, revision };
});
