/**
 * Genre mixes' key before faithful genre mixes renamed it to `home.faithfulGenreMixes` (#1504),
 * with the keys kept beside it: a build deletes what's stored under them, so it doesn't linger.
 */
const OLD = "home.genreMixes";
const OLD_KEYS = [OLD, `${OLD}.nothingToBuildFrom`, `${OLD}.shown`];

/** Deletes the genre mixes kept under the old key, if any are left. */
export const forgetRenamedGenreMixes = (storage: {
  getItemSync(key: string): string | null;
  removeItemSync(key: string): void;
}): void => {
  for (const key of OLD_KEYS) if (storage.getItemSync(key) !== null) storage.removeItemSync(key);
};
