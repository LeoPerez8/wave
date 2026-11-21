/** Where the phone keeps playlist suggestions' saved offers and seed draws: its key-value store. */
import { Storage } from "expo-sqlite/kv-store";

import type { SuggestionStorage } from "@wave/client/playlistSuggestionStorage";

export const phoneSuggestionStorage: SuggestionStorage = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => {
    Storage.removeItemSync(key);
  },
};
