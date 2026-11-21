import * as Effect from "effect/Effect";

/** What main does for the mini player's calls; they take no arguments. */
export interface MiniPlayerCalls {
  readonly open: () => Promise<void>;
  readonly close: () => void;
  readonly showMain: () => void;
}

export const noMiniPlayer: MiniPlayerCalls = {
  open: async () => {},
  close: () => {},
  showMain: () => {},
};

export const miniPlayerHandlers = (calls: MiniPlayerCalls) => ({
  "miniPlayer.open": () => Effect.promise(() => calls.open()),
  "miniPlayer.close": () => Effect.sync(() => calls.close()),
  "miniPlayer.showMain": () => Effect.sync(() => calls.showMain()),
});
