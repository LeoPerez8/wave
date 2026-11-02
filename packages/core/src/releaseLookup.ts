import { isSameSong } from "./lyricsAndGenre.ts";

export interface ReleaseSong {
  readonly title: string;
  readonly artist: string;
}
export interface ReleaseCandidate {
  readonly isrc: string;
  readonly albumId: number | null;
}
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
export const releaseCandidates = (song: ReleaseSong, response: unknown): ReleaseCandidate[] => {
  const data = record(response).data;
  if (!Array.isArray(data)) return [];
  return data.slice(0, 10).flatMap((value) => {
    const row = record(value),
      artist = record(row.artist),
      album = record(row.album);
    if (
      typeof row.title !== "string" ||
      typeof artist.name !== "string" ||
      !isSameSong({ ...song, album: null, durationMs: 0 }, row.title, artist.name)
    )
      return [];
    return typeof row.isrc === "string" && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(row.isrc)
      ? [{ isrc: row.isrc.toUpperCase(), albumId: typeof album.id === "number" ? album.id : null }]
      : [];
  });
};

/** Small queries leave room for recordings that share an ISRC. */
export const releaseBatches = (codes: readonly string[]): string[][] => {
  const unique = [...new Set(codes)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += 25) batches.push(unique.slice(i, i + 25));
  return batches;
};
export const releaseBatchSplit = (
  codes: readonly string[],
  response: unknown,
): string[][] | null => {
  const r = record(response);
  return codes.length > 1 && (Number(r.count) >= 100 || r.error !== undefined)
    ? [codes.slice(0, Math.floor(codes.length / 2)), codes.slice(Math.floor(codes.length / 2))]
    : null;
};
export const releaseRequestDelay = (
  service: "deezer" | "musicbrainz",
  last: number,
  now: number,
): number => Math.max(0, last + (service === "musicbrainz" ? 1000 : 350) - now);

export interface ReleaseAnswer {
  readonly date: string | null;
  readonly source: "first-release" | "year" | "album" | "unknown" | "failed";
  readonly retryAt: number | null;
}
const validDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^(?!0000)\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(v);
export const releaseAnswer = (
  codes: readonly string[],
  responses: readonly unknown[],
  year: number | null,
  albumDate: string | null,
  now: number,
  failed = false,
): ReleaseAnswer => {
  const dates: string[] = [];
  for (const response of responses) {
    const recordings = record(response).recordings;
    if (!Array.isArray(recordings)) continue;
    for (const value of recordings) {
      const r = record(value);
      if (
        Array.isArray(r.isrcs) &&
        r.isrcs.some((code) => codes.includes(String(code))) &&
        validDate(r["first-release-date"])
      )
        dates.push(r["first-release-date"]);
    }
  }
  dates.sort();
  if (dates[0]) return { date: dates[0], source: "first-release", retryAt: null };
  const retryAt = now + (failed ? 60_000 : 30 * 86400_000);
  if (year && validDate(String(year))) return { date: String(year), source: "year", retryAt };
  if (validDate(albumDate)) return { date: albumDate, source: "album", retryAt };
  return { date: null, source: failed ? "failed" : "unknown", retryAt };
};
export const releaseDue = (
  song: ReleaseSong,
  originalDate: string | null | undefined,
  answer: ReleaseAnswer | null | undefined,
  now: number,
): boolean =>
  song.title.trim() !== "" &&
  song.artist.trim() !== "" &&
  !originalDate &&
  (!answer || (answer.retryAt !== null && answer.retryAt <= now));
