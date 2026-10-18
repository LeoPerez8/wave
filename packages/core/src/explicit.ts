/**
 * Explicit songs (docs/spec.md): Wave only uses a flag a source already
 * gives, never the audio or the lyrics. YouTube Music marks explicit songs;
 * a file keeps the flag in its advisory tag (`ITUNESADVISORY` for ID3 and
 * Vorbis comments, `rtng` for MP4), which a scan reads into the Library index.
 */

/**
 * A song's flag: explicit, checked and clean, or unknown (never checked).
 * Unknown counts as clean everywhere (`isExplicit`).
 */
export type ExplicitFlag = "explicit" | "clean" | "unknown";

/**
 * The flag a file's advisory tag gives, as the scanner read it (raw): 1 is
 * explicit, 0 checked and clean, no tag unknown. iTunes' other values count
 * too: 2 (clean) and 4 (explicit, in older files).
 */
export const explicitFromAdvisory = (tag: string | null | undefined): ExplicitFlag => {
  switch (tag?.trim()) {
    case "1":
    case "4":
      return "explicit";
    case "0":
    case "2":
      return "clean";
    default:
      return "unknown";
  }
};

/**
 * Whether a song counts as explicit: a YT Music song's mark (true or false),
 * or a Library song's flag. Unknown counts as clean.
 */
export const isExplicit = (flag: ExplicitFlag | boolean): boolean =>
  flag === true || flag === "explicit";

/**
 * The advisory tag a file gets for [flag]: 1 for explicit, 0 for checked and
 * clean (a YT Music song it doesn't mark is clean); null writes none, for a
 * flag nothing has checked.
 */
export const advisoryTag = (flag: ExplicitFlag | boolean): 0 | 1 | null =>
  flag === "unknown" ? null : isExplicit(flag) ? 1 : 0;

/** Whether a song row or tile shows the E badge: for explicit songs only. */
export const showsExplicitBadge = (flag: ExplicitFlag | boolean): boolean => isExplicit(flag);
