import { router as expoRouter } from "expo-router";

import { activeTiming, beginTiming, hasTimingTouch, timingLinkNavigated } from "./timing";

const destination = (href: Parameters<typeof expoRouter.push>[0]): string =>
  typeof href === "string" ? href : href.pathname;
const start = (kind: "push" | "pop" | "tab", to: string): void => {
  const active = activeTiming();
  // A link starts at its touch, before resolution or Now Playing's close; preserve that window.
  if (
    kind === "push" &&
    active !== null &&
    !hasTimingTouch() &&
    ["artistLink", "albumLink", "goToArtist"].includes(active.kind)
  )
    return;
  beginTiming(kind, to);
};
/** Same router API, with the navigating event's timestamp captured before dispatch. */
export const router: typeof expoRouter = {
  ...expoRouter,
  push: (...args) => {
    start("push", destination(args[0]));
    const id = activeTiming()?.id;
    expoRouter.push(...args);
    timingLinkNavigated(id);
  },
  navigate: (...args) => {
    start("tab", destination(args[0]));
    expoRouter.navigate(...args);
  },
  back: () => {
    start("pop", "Back");
    expoRouter.back();
  },
};
