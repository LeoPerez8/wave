import { listMounts } from "@wave/core";
import { useMemo } from "react";

import { grid } from "../catalog/grid.ts";
import { useStagedCount } from "../lib/stagedCount.ts";

/**
 * How many rows a pushed screen's list is given in one frame (#1537). On the reference phone a
 * push's first frame took 353 ms, the screen's head and a whole screen of rows: Legend List
 * measures itself in a layout effect and renders every row within the window and its draw
 * distance before the first paint.
 */
export const STAGED_ROWS_PER_FRAME = 4;
/** Legend List's default draw distance below the window, in dp. */
const DRAW_DISTANCE = 250;

/**
 * [data] as a pushed screen's list is given it (#1537): with [staged], four rows in the first
 * frame, under the screen's head, then four more a frame until the window and the draw distance
 * under it are full, then the rest, which the list leaves unmounted below the screen (Core's
 * `listMounts`, as Up Next's rows mount). Rows are added below those drawn, at their fixed
 * heights, so nothing drawn moves; a list that grows keeps every row it had. Unstaged, or once
 * whole, it is [data] itself.
 */
export const useStagedRows = <T>(
  data: readonly T[],
  staged: boolean,
  windowHeight: number,
): readonly T[] => {
  const count = data.length;
  const plan = useMemo(
    () =>
      staged
        ? listMounts({
            count,
            perFrame: STAGED_ROWS_PER_FRAME,
            screen: Math.ceil((windowHeight + DRAW_DISTANCE) / grid.row),
          })
        : [count],
    [staged, count, windowHeight],
  );
  const mounted = useStagedCount(plan);
  return useMemo(() => (mounted >= count ? data : data.slice(0, mounted)), [data, mounted, count]);
};
