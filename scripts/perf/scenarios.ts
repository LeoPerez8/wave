// The scenarios the release runner plays on the phone (docs/performance/README.md lists
// them with what each measures). A scenario starts from a fresh launch, runs its setup
// unmeasured, then repeats its steps; each step is one measured window.
import type { Target } from "./device.ts";
import type { Expect } from "./metrics.ts";

export type Action =
  | { readonly kind: "tap"; readonly target: Target }
  /** Back-to-back taps, no wait between them (rapid tab taps). */
  | { readonly kind: "taps"; readonly targets: readonly Target[] }
  /**
   * A fling across the middle of the screen, clear of the floating chrome: "up"
   * moves the finger up, so the content scrolls on towards its end.
   */
  | { readonly kind: "swipe"; readonly direction: "up" | "down" }
  /** The system back key. It has no touch to measure from, so only setup and teardown use it. */
  | { readonly kind: "back" }
  /** Shares the fixture's playlist link to Wave, as a share sheet would. */
  | { readonly kind: "share" }
  /** A cold launch, timed by `am start -W`. */
  | { readonly kind: "launch" }
  /** Nothing: a window that watches the app on its own (an import filling). */
  | { readonly kind: "idle" };

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
  /** Part of the glass comparison (#316), run with `--scenario glass`, not with `all`. */
  readonly glass?: boolean;
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

/** A fling on towards the content's end, then one back: the content scrolls under the glass. */
const flings: readonly Step[] = [
  { measure: "fling-up", action: { kind: "swipe", direction: "up" } },
  { measure: "fling-down", action: { kind: "swipe", direction: "down" } },
];

/** Ten tab changes away from Home and back, cycling through [tabs]. */
const tabCycle = (tabs: readonly string[], count: number): Target[] =>
  Array.from({ length: count }, (_, i) => tab(tabs[(i + 1) % tabs.length] ?? "Home"));

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
    name: "tab-switch",
    summary: "Ten tab changes across the fixture's tabs, one tap at a time.",
    steps: ({ tabs }) =>
      tabCycle(tabs, 10).map((target) => ({
        measure: "tab",
        action: { kind: "tap", target },
        expect: route,
      })),
    iterations: 3,
    warmup: 1,
  },
  {
    name: "rapid-tabs",
    summary: "Ten tab taps back to back; latencies count from the last tap.",
    steps: ({ tabs }) => [
      {
        measure: "burst",
        action: { kind: "taps", targets: tabCycle(tabs, 10) },
        expect: route,
        anchor: "last",
        windowMs: 4_000,
      },
    ],
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
  {
    name: "scroll-home",
    summary:
      "Glass: flings on Home, its content scrolling under the tab bar, the Search pill and the mini player.",
    steps: () => flings,
    iterations: 10,
    warmup: 1,
    glass: true,
  },
  {
    name: "scroll-songs",
    summary:
      "Glass: flings on Library › Songs, the whole Library as a Track list scrolling under the mini player.",
    setup: [
      { kind: "tap", target: tab("Library") },
      { kind: "tap", target: { text: "Songs" } },
    ],
    steps: () => flings,
    iterations: 10,
    warmup: 1,
    glass: true,
  },
  {
    name: "idle-home",
    summary:
      "Glass: five seconds of Home with nothing touched; with the mini player paused, any frame is idle rendering.",
    steps: () => [{ measure: "idle", action: { kind: "idle" }, windowMs: 5_000 }],
    iterations: 5,
    warmup: 1,
    glass: true,
  },
];

/** The scenarios a full baseline runs, in order (`--scenario all`). */
export const ALL_SCENARIOS: readonly string[] = SCENARIOS.filter(
  (scenario) => scenario.name !== "import" && scenario.glass !== true,
).map((scenario) => scenario.name);

/** The glass comparison's scenarios (`--scenario glass`), run once per glass probe. */
export const GLASS_SCENARIOS: readonly string[] = SCENARIOS.filter(
  (scenario) => scenario.glass === true,
).map((scenario) => scenario.name);

export const VARIANTS = ["idle", "import"] as const;
export type Variant = (typeof VARIANTS)[number];

export const findScenario = (name: string): Scenario | undefined =>
  SCENARIOS.find((scenario) => scenario.name === name);
