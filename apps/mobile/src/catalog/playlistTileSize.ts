import { captionHeight } from "./cards/CardParts";
import { SLEEVE_ROOM } from "./cards/PlaylistCard";
import { CELL } from "./grid";

/** Space between rows of tiles. */
const ROW_GAP = CELL * 3;

/**
 * Height of a row of [size] playlist cards at [fontScale], gap included, so the
 * list lays out by index: the sleeves above the cover, the cover, then the caption.
 */
export const playlistCardRowHeight = (size: number, fontScale: number): number =>
  SLEEVE_ROOM + size + captionHeight(fontScale) + ROW_GAP;
