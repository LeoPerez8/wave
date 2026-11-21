import { geniusStorageKey } from "./geniusSource.ts";

const PREFIX = geniusStorageKey("");
const INDEX = "genius.index.v1";
const MAX_SONGS = 500;

/** Saves answers on this device, evicting the oldest written after 500 songs. */
export const createGeniusStorage = (store: {
  readonly read: (key: string) => Promise<string | null>;
  readonly write: (key: string, value: string) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
}) => {
  let writing = Promise.resolve();

  const keys = async (): Promise<string[]> => {
    try {
      const stored: unknown = JSON.parse((await store.read(INDEX)) ?? "[]");
      if (Array.isArray(stored))
        return stored.filter(
          (entry): entry is string => typeof entry === "string" && entry.startsWith(PREFIX),
        );
    } catch {
      /* An unreadable index starts afresh. */
    }
    return [];
  };

  // Writes run one at a time, so updating the index never loses another answer's key.
  const enqueue = (update: () => Promise<void>): Promise<void> => {
    writing = writing.catch(() => undefined).then(update);
    return writing;
  };

  return {
    read: store.read,
    keep: (key: string, value: string) =>
      enqueue(async () => {
        const next = [...(await keys()).filter((entry) => entry !== key), key];
        await store.write(key, value);
        const evicted = next.splice(0, Math.max(0, next.length - MAX_SONGS));
        await store.write(INDEX, JSON.stringify(next));
        await Promise.all(evicted.map((entry) => store.remove(entry)));
      }),
    drop: (key: string) =>
      enqueue(async () => {
        await store.write(INDEX, JSON.stringify((await keys()).filter((entry) => entry !== key)));
        await store.remove(key);
      }),
  };
};
