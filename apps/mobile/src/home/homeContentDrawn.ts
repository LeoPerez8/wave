import { useEffect, useLayoutEffect, useRef } from "react";

import { afterHomeFrame } from "./homeOpening";
import { homeWork } from "./homeWork";

/**
 * How long Home waits for its first content before letting the rest go on
 * anyway: its local reads answer well within it, so it only guards a read
 * that never answers from holding Home's mixes and lower sections forever.
 */
const HOME_CONTENT_WAIT_MS = 3_000;

/**
 * Home's first content, from the top down (#1487): from its first commit,
 * Home's work (`homeWork`: the mixes and the snapshot they read) waits; once
 * [ready] content has been drawn (the frame after the one that paints it, as
 * the screen's content time counts it), the work goes on and [onDrawn] tells
 * Home, whose lower sections and later reads then take their turns.
 */
export const useHomeContentDrawn = (ready: boolean, onDrawn: (drawn: true) => void): void => {
  const release = useRef<(() => void) | null>(null);
  // Before any of Home's effects can start its work.
  useLayoutEffect(() => {
    const done = homeWork.waitForContent();
    release.current = done;
    const timer = setTimeout(() => {
      done();
      onDrawn(true);
    }, HOME_CONTENT_WAIT_MS);
    return () => {
      clearTimeout(timer);
      done();
    };
  }, [onDrawn]);
  useEffect(() => {
    if (!ready) return;
    return afterHomeFrame(
      () => {
        release.current?.();
        onDrawn(true);
      },
      { request: requestAnimationFrame, cancel: cancelAnimationFrame },
    );
  }, [ready, onDrawn]);
};
