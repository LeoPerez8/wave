import { Storage } from "expo-sqlite/kv-store";

import { geniusStorageKey } from "./geniusSource";

/** The key every saved Genius answer starts with. */
const PREFIX = geniusStorageKey("");
/** Which answers are saved, oldest written first. */
const INDEX = "genius.index.v1";
const MAX_SONGS = 500;
let writing = Promise.resolve();

/**
 * Saves a song's Genius answer under [key] in the key-value store (this phone
 * only, never synced), at most 500 songs: past that the oldest written goes.
 * Writes run one at a time, so the index never loses a key.
 */
export const keepGenius = (key: string, value: string): Promise<void> => {
  const write = writing
    .catch(() => undefined)
    .then(async () => {
      let keys: string[] = [];
      try {
        const stored: unknown = JSON.parse((await Storage.getItemAsync(INDEX)) ?? "[]");
        if (Array.isArray(stored))
          keys = stored.filter(
            (entry): entry is string => typeof entry === "string" && entry.startsWith(PREFIX),
          );
      } catch {
        /* An unreadable index starts afresh. */
      }
      const next = [...keys.filter((entry) => entry !== key), key];
      await Storage.setItemAsync(key, value);
      const evicted = next.splice(0, Math.max(0, next.length - MAX_SONGS));
      await Storage.setItemAsync(INDEX, JSON.stringify(next));
      await Promise.all(evicted.map((entry) => Storage.removeItemAsync(entry)));
    });
  writing = write;
  return write;
};
