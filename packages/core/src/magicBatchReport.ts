/**
 * What the app log says about a Magic Queue pick (docs/spec.md, Magic Queue,
 * App log): how long it took from when the batch was wanted and how it
 * ended, with the counts that explain an empty one.
 */

/** How many of a source's songs a pick weighed, and how many passed Genre faithfulness. */
export interface MagicSourceCount {
  readonly weighed: number;
  readonly admitted: number;
}

/** How a pick ended. */
export type MagicBatchOutcome =
  | { readonly kind: "appended"; readonly songs: number }
  /** The session moved on, or Up Next got a recommendation, before the batch landed. */
  | { readonly kind: "dropped" }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly reason: string }
  | {
      readonly kind: "empty";
      /** Whether the seed's genre profile was known (`magicSeedProfile`). */
      readonly seedGenre: boolean;
      /** Genre faithfulness's step, as its slider names it. */
      readonly step: string;
      readonly library: MagicSourceCount;
      /** The catalog songs the engine ranked, and those eligible for the batch. */
      readonly yt: { readonly ranked: number; readonly eligible: number };
      /** The songs a refill's radios brought; null when none ran. */
      readonly refill: number | null;
    };

export interface MagicBatchReport {
  readonly first: boolean;
  readonly ms: number;
  readonly outcome: MagicBatchOutcome;
}

const count = (value: number): string => value.toLocaleString("en");

const songs = (value: number): string => `${count(value)} ${value === 1 ? "song" : "songs"}`;

const outcomeText = (outcome: MagicBatchOutcome): string => {
  switch (outcome.kind) {
    case "appended":
      return `${songs(outcome.songs)} appended`;
    case "dropped":
      return "no longer wanted";
    case "stopped":
      return "stopped";
    case "failed":
      return `failed: ${outcome.reason}`;
    case "empty": {
      const seed = outcome.seedGenre ? "the seed's genre is known" : "the seed's genre is unknown";
      const library = `Library ${count(outcome.library.admitted)} of ${count(outcome.library.weighed)} songs pass ${outcome.step}`;
      const yt = `YouTube Music ${count(outcome.yt.eligible)} of ${count(outcome.yt.ranked)} candidates pass`;
      const refill =
        outcome.refill === null ? "no refill" : `the refill brought ${songs(outcome.refill)}`;
      return `no songs: ${seed}; ${library}; ${yt}; ${refill}`;
    }
  }
};

/** The app log's line for a pick [report]: "Magic Queue first batch: 10648ms (…)". */
export const magicBatchLine = ({ first, ms, outcome }: MagicBatchReport): string =>
  `Magic Queue ${first ? "first" : "next"} batch: ${ms}ms (${outcomeText(outcome)})`;
