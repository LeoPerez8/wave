import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Now Playing's open as WaveTiming stamps it (#1537): the tap assigns the spring (its response),
// the sheet commits, and the first frame is the one after that commit, as for a pushed screen
// (`timingScreenCommitted`: a commit, then one frame).

type Mark = { readonly mark: string; readonly id: number; readonly frame: number };
const marks: Mark[] = [];
let frame = 0;
let waiting: (() => void)[] = [];
const nextFrame = (): void => {
  frame++;
  const due = waiting;
  waiting = [];
  for (const callback of due) callback();
};
Object.assign(globalThis, {
  requestAnimationFrame: (callback: () => void) => waiting.push(callback),
  __sheetTiming: { marks, frame: () => frame },
});

const stub = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;
const t = "globalThis.__sheetTiming";
const stubs: Record<string, string> = {
  // The every-build timing adapter, as `lib/timing.ts` behaves: a surface's commit is its
  // response, and the frame after it its first frame.
  "@/lib/timing": stub(`
    const mark = (name, id) => ${t}.marks.push({ mark: name, id, frame: ${t}.frame() });
    let next = 0;
    export const beginTiming = () => ++next;
    export const activeTiming = () => null;
    export const dismissTiming = () => {};
    export const noteTimingLinkClose = () => {};
    export const timingLinkNavigated = () => {};
    export const setTimingSurface = () => {};
    export const timingTransitionEnd = (id) => mark("end", id);
    export const timingResponse = (id) => mark("response", id);
    export const timingSurfaceCommitted = (id, ends = true) => {
      mark("response", id);
      requestAnimationFrame(() => {
        mark("frame", id);
        if (ends) mark("end", id);
      });
    };
  `),
  "react-native": stub(`export const Dimensions = { get: () => ({ height: 800, width: 400 }) };`),
  "react-native-reanimated": stub(`
    export const makeMutable = (value) => { let v = value; return { get: () => v, set: (n) => { v = n; } }; };
    export const withSpring = (to) => to;
  `),
  "react-native-worklets": stub(`export const scheduleOnRN = (run, ...args) => run(...args);`),
  "@/overlay/overlay": stub(`export const dismissAllOverlays = () => {};`),
  "@/perf/perf": stub(`export const perfMark = () => {};`),
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const url = stubs[specifier];
    if (url !== undefined) return { url, shortCircuit: true };
    if (specifier === "./linkClose") return next("./linkClose.ts", context);
    if (specifier === "@wave/client/externalStore")
      return next(
        new URL("../../../../packages/client/src/externalStore.ts", import.meta.url).href,
        context,
      );
    return next(specifier, context);
  },
});
const sheet = await import("./sheet.ts");
hooks.deregister();

const first = (mark: string): Mark | undefined => marks.find((entry) => entry.mark === mark);

test("a tap's Now Playing open stamps its first frame on the frame after the sheet commits", () => {
  sheet.openNowPlaying();
  const response = first("response");
  assert.ok(response !== undefined, "the spring's assignment is the response");
  assert.equal(response.frame, 0);
  // The sheet's render commits in the tap's own turn: its layout effect runs here.
  sheet.nowPlayingContentCommitted();
  nextFrame();
  assert.equal(first("frame")?.frame, 1, "drawn on the first frame after the commit");
  assert.equal(first("frame")?.id, response.id);
  // Settled only once the content was drawn and the spring finished, never before.
  assert.equal(sheet.isNowPlayingShown(), true);
  for (let more = 0; more < 3; more++) nextFrame();
});
