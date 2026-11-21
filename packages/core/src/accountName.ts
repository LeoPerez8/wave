/**
 * The name a Wave account is shown by to the other members of a collaborative
 * playlist (docs/spec.md, "Collaborative playlists"): the Google account's
 * name, as the sync service keeps it.
 */

/** The longest name the service keeps, in characters. */
export const ACCOUNT_NAME_MAX_LENGTH = 100;

/**
 * The name to keep for [value]: its text with control characters taken for
 * space, the runs of space joined and the ends trimmed, cut to
 * `ACCOUNT_NAME_MAX_LENGTH` characters. `null` when [value] isn't text or
 * nothing is left.
 */
export const accountName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const joined = value.replace(/[\s\p{Cc}]+/gu, " ").trim();
  const name = Array.from(joined).slice(0, ACCOUNT_NAME_MAX_LENGTH).join("").trimEnd();
  return name === "" ? null : name;
};
