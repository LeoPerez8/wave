import type { LibraryChange } from "@wave/core";

/** A committed native scan batch names its saved songs, so targeted readers can stay still. */
export const scanBatchChange = (trackIds: readonly number[]): LibraryChange => ({
  kind: "tracks",
  ids: trackIds,
  burst: true,
  // A scan's batches link no playlist entry: that's once it ends, announced as its own change.
  scanned: true,
});
