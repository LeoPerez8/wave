import type { LibraryChange } from "@wave/core";

/** A committed native scan batch names its saved songs, so targeted readers can stay still. */
export const scanBatchChange = (trackIds: readonly number[]): LibraryChange => ({
  kind: "tracks",
  ids: trackIds,
  burst: true,
});
