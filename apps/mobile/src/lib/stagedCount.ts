import { useEffect, useState } from "react";

/**
 * How many of a page's sections are mounted now, following a plan of
 * cumulative counts per frame (Core's `stagedMounts`, #1355): the first count
 * in the first frame, then one stage a frame until the page is whole. A plan
 * that grows mounts its new sections in the next frame; a stage reached stays
 * reached, so what was drawn isn't taken away. While [held], the page stays at
 * the stage it reached (Home holds its lower sections until its first content
 * is drawn, #1487).
 */
export const useStagedCount = (plan: readonly number[], held = false): number => {
  const [stage, setStage] = useState(0);
  const last = plan.length - 1;
  const current = Math.min(stage, last);
  useEffect(() => {
    if (held || current >= last) return;
    const frame = requestAnimationFrame(() => setStage(current + 1));
    return () => cancelAnimationFrame(frame);
  }, [current, last, held]);
  return plan[current] ?? 0;
};
