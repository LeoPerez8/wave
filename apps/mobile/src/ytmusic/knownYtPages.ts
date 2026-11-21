/**
 * What Wave already knows about the YT Music pages it opened this session
 * (docs/spec.md › Fluidity, online screens): an album or playlist read whole
 * opens again with its songs in its first frame, with no request.
 */
import { knownPages } from "@wave/core";

import type { YtListScreen } from "./routes.ts";
import type { YtListLoad } from "./YtSongList.tsx";

type Whole = Extract<YtListLoad, { readonly status: "loaded" }>;

/** A few screens of songs each; enough for going back and forth between pages. */
const LISTS = knownPages<Whole>(12);

const listKey = (screen: YtListScreen, id: string): string => `${screen}/${id}`;

/** The page [id] of [screen] as it was last read whole, or undefined. */
export const keptYtList = (screen: YtListScreen, id: string): Whole | undefined =>
  LISTS.get(listKey(screen, id));

/** Keeps [load] for the page's next opening when every song of it came. */
export const keepYtList = (screen: YtListScreen, id: string, load: YtListLoad): void => {
  if (load.status === "loaded" && load.rest === "read") LISTS.set(listKey(screen, id), load);
};
