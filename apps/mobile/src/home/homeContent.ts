import { useHomeContent } from "@/library/hooks";

import { homeOpeningState, type HomeContent } from "./homeOpening";
import { snapshotSection, useSnapshotted } from "./homeSnapshot";

/**
 * Home's own lists (`useHomeContent`, kept ready from startup as
 * `readHomeAdded`, `readHomePlays` and `readHomeFavorites`): at a cold start,
 * what the snapshot holds for each list its read hasn't answered yet. Once
 * all have answered, they're noted for the next snapshot.
 */
export const useHomeScreenContent = (): HomeContent => {
  const read = useHomeContent();
  const cold = snapshotSection("content");
  useSnapshotted("content", homeOpeningState(read).settled ? read : undefined);
  return cold === undefined ? read : { ...cold, ...read };
};
