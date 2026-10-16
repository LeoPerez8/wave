// The scenarios the release runner plays on the phone (docs/performance/README.md lists
// them with what each measures). A scenario starts from a fresh launch, runs its setup
// unmeasured, then repeats its steps; each step is one measured window.
import type { Target } from "./device.ts";
import type { Expect } from "./metrics.ts";

export type Action =
  | { readonly kind: "tap"; readonly target: Target }
  /** Back-to-back taps, no wait between them (rapid tab taps). */
  | { readonly kind: "taps"; readonly targets: readonly Target[] }
  /** The system back key. It has no touch to measure from, so only setup and teardown use it. */
  | { readonly kind: "back" }
  /** Shares the fixture's playlist link to Wave, as a share sheet would. */
  | { readonly kind: "share" }
  /** A cold launch, timed by `am start -W`. */
  | { readonly kind: "launch" }
  /** Home, then Wave again from its launcher intent while its process lives: a warm launch. */
  | { readonly kind: "resume" }
  /** Nothing: a window that watches the app on its own (an import filling). */
  | { readonly kind: "idle" }
  /**
   * A finger dragged in a straight line (`input swipe`), [from] and [to] in dp
   * from [target]'s centre, taking [durationMs].
   */
  | {
      readonly kind: "drag";
      readonly target: Target;
      readonly from: Point;
      readonly to: Point;
      readonly durationMs: number;
    };

/** A position in dp; x grows right, y down. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Step {
  /** What the step measures, the third part of its summary key ("tab", "push", "pop"…). */
  readonly measure: string;
  readonly action: Action;
  /** The mark that means the step's response is on screen. */
  readonly expect?: Expect;
  /** Which touch latencies count from; "last" for a burst of taps. */
  readonly anchor?: "first" | "last";
  /** How long the step's window stays open; the run's window when unset. */
  readonly windowMs?: number;
  /** Marks timed from the touch besides the response (`phasesMs`). */
  readonly phases?: readonly string[];
}

/** What the scenarios read from the fixture (scripts/perf/fixture.json). */
export interface ScenarioConfig {
  /** The tab bar's tabs to cycle through, by label, Home first; Search stays out of it. */
  readonly tabs: readonly string[];
  /**
   * The artist push-artist opens, by name as Library › Artists shows it on its
   * first screen; null when the fixture names none.
   */
  readonly artist: string | null;
}

export interface Scenario {
  readonly name: string;
  readonly summary: string;
  /** Launch the app fresh before every iteration instead of once per scenario. */
  readonly coldEachIteration?: boolean;
  /** Unmeasured actions after the launch, before the iterations. */
  readonly setup?: readonly Action[];
  /** Unmeasured actions after each iteration's steps. */
  readonly teardown?: readonly Action[];
  readonly steps: (config: ScenarioConfig) => readonly Step[];
  readonly iterations: number;
  /** Unrecorded iterations first, which also find the targets. */
  readonly warmup: number;
  /** Needs the fixture's playlist link. */
  readonly needsImportLink?: boolean;
  /** Needs the fixture's artist. */
  readonly needsArtist?: boolean;
}

const tab = (label: string): Target => ({ desc: label });
const route: Expect = { mark: "route" };

/**
 * Push [target], then tap the header's Back: one measured step each. A tap, not
 * the system back key, so the step has a touch to measure from.
 */
const pushPop = (target: Target): readonly Step[] => [
  { measure: "push", action: { kind: "tap", target }, expect: route },
  { measure: "pop", action: { kind: "tap", target: { desc: "Back" } }, expect: route },
];

const drag = (target: Target, from: Point, to: Point, durationMs: number): Action => ({
  kind: "drag",
  target,
  from,
  to,
  durationMs,
});

const SCRUBBER: Target = { desc: "Playback position" };
/**
 * Up Next's handles are hidden from accessibility, so drags start from the
 * first row's Remove button: the handle is the next 48 dp cell to its right.
 */
const FIRST_REMOVE: Target = { descPrefix: "Remove " };
const HANDLE: Point = { x: 48, y: 0 };
/** Up Next rows are 56 dp tall. */
const THREE_ROWS_DOWN: Point = { x: 48, y: 3 * 56 };

/** Ten tab changes away from Home and back, cycling through [tabs]. */
const tabCycleLabels = (tabs: readonly string[], count: number): string[] =>
  Array.from({ length: count }, (_, i) => tabs[(i + 1) % tabs.length] ?? "Home");
const tabCycle = (tabs: readonly string[], count: number): Target[] =>
  tabCycleLabels(tabs, count).map(tab);

/**
 * What a tab switch's time goes to (#304), besides the route mark: React done
 * with the switch (`tab.commit`, detail `<tab> first|warm`) and the shown tab
 * laid out (`tab.layout`; none when showing it changes no layout). The frames
 * after them are native work: attaching the tab's views, layout and drawing.
 */
const TAB_PHASES = ["tab.commit", "tab.layout"] as const;

/** A tab tap, measured to its route mark and its phases. */
const tabStep = (measure: string, target: Target): Step => ({
  measure,
  action: { kind: "tap", target },
  expect: route,
  phases: TAB_PHASES,
});

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "startup",
    summary: "Cold launch: am start -W times, startup frames, then retained memory once idle.",
    coldEachIteration: true,
    steps: () => [{ measure: "cold", action: { kind: "launch" } }],
    iterations: 5,
    warmup: 0,
  },
  {
    name: "warm-start",
    summary: "Home, then Wave again with its process alive: am start -W times of a warm launch.",
    steps: () => [{ measure: "warm", action: { kind: "resume" } }],
    iterations: 5,
    warmup: 1,
  },
  {
    name: "tab-first",
    summary: "The first visit to each of the fixture's tabs after a launch: the tab is built.",
    coldEachIteration: true,
    steps: ({ tabs }) => tabs.slice(1).map((label) => tabStep("first", tab(label))),
    iterations: 5,
    warmup: 1,
  },
  {
    name: "tab-switch",
    summary: "Ten tab changes across the fixture's tabs, one tap at a time: warm visits.",
    steps: ({ tabs }) => tabCycle(tabs, 10).map((target) => tabStep("tab", target)),
    iterations: 3,
    warmup: 1,
  },
  {
    name: "rapid-tabs",
    summary:
      "Ten tab taps back to back; latencies count from the last tap to the tabs settling on it.",
    steps: ({ tabs }) => {
      const labels = tabCycleLabels(tabs, 10);
      return [
        {
          measure: "burst",
          action: { kind: "taps", targets: labels.map(tab) },
          // `tab.settled` (detail: the tab's label) comes once no switch is on its way
          // and the tab on screen is the one tapped last.
          expect: { mark: "tab.settled", detail: labels[labels.length - 1] ?? "Home" },
          anchor: "last",
          windowMs: 4_000,
        },
      ];
    },
    iterations: 5,
    warmup: 1,
  },
  {
    name: "push-settings",
    summary: "Home › Settings and back.",
    steps: () => pushPop({ desc: "Settings" }),
    iterations: 10,
    warmup: 1,
  },
  {
    name: "push-library",
    summary: "Library › Albums and back.",
    setup: [{ kind: "tap", target: tab("Library") }],
    steps: () => pushPop({ text: "Albums" }),
    iterations: 10,
    warmup: 1,
  },
  {
    name: "push-tracklist",
    summary: "Library › Songs (the whole Library as a Track list) and back.",
    setup: [{ kind: "tap", target: tab("Library") }],
    steps: () => pushPop({ text: "Songs" }),
    iterations: 10,
    warmup: 1,
  },
  {
    name: "push-artist",
    summary:
      "Library › Artists › the fixture's artist, until its page's stats block is on screen, and back.",
    setup: [
      { kind: "tap", target: tab("Library") },
      { kind: "tap", target: { text: "Artists" } },
    ],
    steps: ({ artist }) => [
      {
        measure: "push",
        action: { kind: "tap", target: { text: artist ?? "" } },
        expect: { mark: "artist.stats" },
      },
      { measure: "pop", action: { kind: "tap", target: { desc: "Back" } }, expect: route },
    ],
    iterations: 10,
    warmup: 1,
    needsArtist: true,
  },
  {
    name: "push-empty",
    summary:
      "Control: Settings › Developer (one row) and back, navigation with next to no content.",
    setup: [{ kind: "tap", target: { desc: "Settings" } }],
    steps: () => pushPop({ text: "Developer" }),
    iterations: 10,
    warmup: 1,
  },
  {
    name: "now-playing",
    summary: "Mini player › Now Playing, then its Close button.",
    steps: () => [
      {
        measure: "open",
        action: { kind: "tap", target: { descPrefix: "Now playing:" } },
        expect: { mark: "nowPlaying.shown" },
      },
      {
        measure: "close",
        action: { kind: "tap", target: { desc: "Close Now Playing" } },
        expect: { mark: "nowPlaying.hidden" },
      },
    ],
    iterations: 10,
    warmup: 1,
  },
  {
    name: "queue",
    summary: "Now Playing › Queue and back to the player.",
    setup: [{ kind: "tap", target: { descPrefix: "Now playing:" } }],
    steps: () => [
      {
        measure: "open",
        action: { kind: "tap", target: { desc: "Queue" } },
        expect: { mark: "visible", detail: "queue" },
      },
      { measure: "close", action: { kind: "tap", target: { desc: "Queue" } } },
    ],
    iterations: 10,
    warmup: 1,
  },
  {
    name: "skip",
    summary:
      "The mini player's Next track, until the player holds the next entry (#314). Load the queue length under test first.",
    steps: () => [
      {
        measure: "next",
        action: { kind: "tap", target: { desc: "Next track" } },
        expect: { mark: "queue.synced" },
      },
    ],
    iterations: 10,
    warmup: 1,
  },
  {
    name: "scrub",
    summary:
      "Now Playing's scrubber dragged forward 240 dp and back, a second each; each drag seeks where it lets go.",
    setup: [{ kind: "tap", target: { descPrefix: "Now playing:" } }],
    steps: () => [
      { measure: "forward", action: drag(SCRUBBER, { x: -120, y: 0 }, { x: 120, y: 0 }, 1_000) },
      { measure: "back", action: drag(SCRUBBER, { x: 120, y: 0 }, { x: -120, y: 0 }, 1_000) },
    ],
    iterations: 10,
    warmup: 1,
  },
  {
    name: "queue-drag",
    summary:
      "The first Up Next row dragged three rows down by its handle, then back up: the order ends as it began. Needs four songs up next.",
    setup: [
      { kind: "tap", target: { descPrefix: "Now playing:" } },
      { kind: "tap", target: { desc: "Queue" } },
    ],
    steps: () => [
      { measure: "down", action: drag(FIRST_REMOVE, HANDLE, THREE_ROWS_DOWN, 800) },
      { measure: "up", action: drag(FIRST_REMOVE, THREE_ROWS_DOWN, HANDLE, 800) },
    ],
    iterations: 10,
    warmup: 1,
  },
  {
    name: "search-first-tap",
    summary: "The first Search tap after a launch, until the keyboard is up.",
    coldEachIteration: true,
    steps: () => [
      {
        measure: "first-tap",
        action: { kind: "tap", target: tab("Search") },
        expect: { mark: "keyboard.show" },
      },
    ],
    teardown: [{ kind: "back" }],
    iterations: 5,
    warmup: 1,
  },
  {
    name: "import",
    summary:
      "Share the fixture playlist link, tap Import, then watch ten seconds of the import filling.",
    steps: () => [
      { measure: "card", action: { kind: "share" } },
      {
        measure: "start",
        action: { kind: "tap", target: { text: "Import" } },
        expect: { mark: "import.running" },
      },
      { measure: "during-import", action: { kind: "idle" }, windowMs: 10_000 },
    ],
    iterations: 1,
    warmup: 0,
    needsImportLink: true,
  },
];

/** The scenarios a full baseline runs, in order (`--scenario all`). */
export const ALL_SCENARIOS: readonly string[] = SCENARIOS.map((scenario) => scenario.name).filter(
  (name) => name !== "import",
);

export const VARIANTS = ["idle", "import"] as const;
export type Variant = (typeof VARIANTS)[number];

export const findScenario = (name: string): Scenario | undefined =>
  SCENARIOS.find((scenario) => scenario.name === name);
