/**
 * A song's release date as Wave keeps it (docs/spec.md, "Playlist song sorting"): `1985`,
 * `1985-06` or `1985-06-21`, as precise as it's known. The original-date tag, the lookup's
 * answers and the dates the owner types all hold one; year 0000 is no date.
 */
export type ReleaseDate = string;

const RELEASE_DATE = /^(?!0000)\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/;

/** [value] as a release date, or null when it isn't one. */
export const readReleaseDate = (value: unknown): ReleaseDate | null =>
  typeof value === "string" && RELEASE_DATE.test(value) ? value : null;
