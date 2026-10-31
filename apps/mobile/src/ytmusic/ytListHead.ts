import type { YtListHead } from "./routes.ts";
import type { YtListLoad } from "./YtSongList.tsx";

/**
 * The head a YT Music list page shows: its own from its first page on, else
 * what the tapped cover knew ([known]), undefined when nothing is known yet.
 */
export const shownYtListHead = (
  load: YtListLoad,
  known: YtListHead | undefined,
): YtListHead | undefined => (load.status === "loaded" ? load.page.head : known);
