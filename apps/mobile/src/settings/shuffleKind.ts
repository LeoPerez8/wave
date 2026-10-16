import { readShuffleKind, type ShuffleKind } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/**
 * The kind of shuffle chosen on the card opened by any shuffle button:
 * Real Shuffle unless Smart Shuffle was chosen.
 * Every shuffle uses it, the Shuffle buttons and Android Auto's included.
 */
const shuffleKindSetting = persistedSetting<ShuffleKind>({
  key: "settings.shuffleKind",
  synced: true,
  read: readShuffleKind,
  write: (kind) => (kind === "real" ? null : kind),
});

export const shuffleKind = shuffleKindSetting.get;

export const setShuffleKind = shuffleKindSetting.set;

/** The chosen kind of shuffle; re-renders when it changes. */
export const useShuffleKind = shuffleKindSetting.useValue;
