import { importRing } from "@wave/core";

import { CoverRing } from "@/catalog/CoverRing";

import { useImportProgress } from "./importProgress";

/**
 * An importing playlist's ring over its cover of side [cover] on its page
 * (Core's `importRing`); nothing once it's done. Place it inside a box the
 * size of the cover. Only it draws again as the import moves.
 */
export function ImportCoverRing({ playlistId, cover }: { playlistId: number; cover: number }) {
  const ring = importRing(useImportProgress(playlistId));
  return ring === null ? null : <CoverRing ring={ring} cover={cover} />;
}
