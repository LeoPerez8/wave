import {
  followFeed,
  type FollowedArtist,
  type FollowRelease,
  type FollowShow,
} from "./followedArtists.ts";

/** The last usable Home answer on this phone, including the artists needed to draw its cards. */
export interface HomeFollowSnapshot {
  readonly follows: readonly FollowedArtist[];
  readonly releases: readonly FollowRelease[];
  readonly shows: readonly FollowShow[];
  readonly country: string;
}

/** No pending shape: an unknown or empty section occupies no space. */
export const homeFollowCards = (
  known: HomeFollowSnapshot | undefined,
  options: {
    now: number;
    enabled?: boolean;
    blockExplicit?: boolean;
    country?: string;
    admitted?: HomeFollowSnapshot;
    hidden?: readonly string[];
    countedPlays?: readonly string[];
  },
) => {
  const feed = followFeed({
    follows: options.admitted?.follows ?? known?.follows ?? [],
    releases: known?.releases ?? [],
    shows: known?.shows ?? [],
    country: options.country ?? known?.country ?? "",
    hidden: [],
    countedPlays: [],
    ...options,
  });
  const admitted = options.admitted;
  return {
    releaseCards:
      admitted === undefined
        ? feed.releaseCards
        : admitted.releases.flatMap((r) => {
            const current = feed.releaseCards.find((c) => c.key === r.key);
            return current ? [current] : [];
          }),
    showCards:
      admitted === undefined
        ? feed.showCards
        : admitted.shows.flatMap((s) => {
            const current = feed.showCards.find((c) => c.id === s.id);
            return current ? [current] : [];
          }),
  };
};

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const strings = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === "string");
const nullableString = (v: unknown): boolean => v === null || typeof v === "string";
const fields = (v: Record<string, unknown>, keys: string[]): boolean =>
  keys.every((k) => typeof v[k] === "string");
/** Keep at most 200 cards per shelf; this is a first-paint cache, not the source of truth. */
export const boundHomeFollowSnapshot = (value: HomeFollowSnapshot): HomeFollowSnapshot => {
  const releases = value.releases.slice(0, 200);
  const shows = value.shows.slice(0, 200);
  const keys = new Set([...releases, ...shows].map((c) => c.artistKey));
  return {
    ...value,
    releases,
    shows,
    follows: value.follows.filter((f) => keys.has(f.key)),
  };
};
export const storedHomeFollowSnapshot = (value: HomeFollowSnapshot): string =>
  JSON.stringify(boundHomeFollowSnapshot(value));

export const parseHomeFollowSnapshot = (stored: string | null): HomeFollowSnapshot | undefined => {
  try {
    const v: unknown = JSON.parse(stored ?? "null");
    if (
      !record(v) ||
      typeof v.country !== "string" ||
      !Array.isArray(v.follows) ||
      !Array.isArray(v.releases) ||
      !Array.isArray(v.shows)
    )
      return undefined;
    if (v.releases.length > 200 || v.shows.length > 200 || v.follows.length > 400) return undefined;
    if (
      !v.follows.every(
        (f) =>
          record(f) &&
          fields(f, ["key", "name"]) &&
          (f.level === "shows" || f.level === "releases") &&
          typeof f.followedAt === "number" &&
          (f.deezerId === null || typeof f.deezerId === "number") &&
          nullableString(f.ytBrowseId),
      )
    )
      return undefined;
    if (
      !v.releases.every(
        (r) =>
          record(r) &&
          fields(r, ["key", "artistKey", "title", "releaseDate"]) &&
          ["album", "ep", "single"].includes(String(r.type)) &&
          nullableString(r.artworkUrl) &&
          nullableString(r.browseId) &&
          typeof r.explicit === "boolean" &&
          strings(r.videoIds) &&
          strings(r.recordingKeys) &&
          (r.libraryAlbumId == null || typeof r.libraryAlbumId === "number"),
      )
    )
      return undefined;
    if (
      !v.shows.every(
        (s) =>
          record(s) &&
          fields(s, ["id", "artistKey", "country", "startsAt", "city", "venue", "ticketUrl"]),
      )
    )
      return undefined;
    return v as unknown as HomeFollowSnapshot;
  } catch {
    return undefined;
  }
};
