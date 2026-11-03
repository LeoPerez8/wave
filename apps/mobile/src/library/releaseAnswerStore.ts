import { readReleaseAnswers, type ReleaseAnswer } from "@wave/core";

interface AnswerStorage {
  getItemSync(key: string): string | null;
  getAllKeysSync(): string[];
  setItemSync(key: string, value: string): void;
  removeItemSync(key: string): void;
}

const LEGACY = "releaseDates.answers";
const PREFIX = "releaseDates.answer.";

/** Each answer is durable before it is published, without rewriting its neighbours. */
export const releaseAnswerStore = (storage: AnswerStorage) => {
  let current: Record<string, ReleaseAnswer> | undefined;
  const listeners = new Set<() => void>();
  const write = (key: string, answer: ReleaseAnswer) =>
    storage.setItemSync(PREFIX + key, JSON.stringify({ "": answer }));
  const get = (): Readonly<Record<string, ReleaseAnswer>> => {
    if (current !== undefined) return current;
    const legacy = storage.getItemSync(LEGACY);
    const answers = readReleaseAnswers(legacy);
    // Remove the old record last: an interrupted migration can safely repeat on restart.
    if (legacy !== null) {
      for (const [key, answer] of Object.entries(answers)) write(key, answer);
      storage.removeItemSync(LEGACY);
    }
    for (const key of storage.getAllKeysSync()) {
      if (!key.startsWith(PREFIX)) continue;
      const answer = readReleaseAnswers(storage.getItemSync(key))[""];
      if (answer !== undefined) answers[key.slice(PREFIX.length)] = answer;
    }
    current = answers;
    return current;
  };
  const publish = (answers: Record<string, ReleaseAnswer>) => {
    current = answers;
    for (const listener of listeners) listener();
  };
  return {
    get,
    put: (key: string, answer: ReleaseAnswer): void => {
      const answers = get();
      write(key, answer);
      publish({ ...answers, [key]: answer });
    },
    remove: (key: string): void => {
      const answers = get();
      if (!Object.hasOwn(answers, key)) return;
      storage.removeItemSync(PREFIX + key);
      const { [key]: _removed, ...remaining } = answers;
      publish(remaining);
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
