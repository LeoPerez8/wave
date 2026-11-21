import { useEffect, useState } from "react";

import { onMemoryWarning } from "../lib/memoryWarnings.ts";
import { createWarmPanes } from "./warmPanes.ts";

/** Whether the Queue and Related's panel stay mounted, hidden (`warmPanes.ts`). */
export const useWarmPanes = (shown: boolean, settled: boolean): boolean => {
  const [warm, setWarm] = useState(false);
  const [panes] = useState(() =>
    createWarmPanes({
      changed: setWarm,
      schedule: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
      onMemoryWarning,
    }),
  );
  useEffect(() => () => panes.dispose(), [panes]);
  useEffect(() => {
    if (shown && settled) panes.send({ type: "settled" });
    else panes.send({ type: shown ? "shown" : "hidden" });
  }, [panes, shown, settled]);
  return warm;
};
