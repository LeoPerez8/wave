/* oxlint-disable unicorn/no-array-sort -- Hermes lacks the copying array methods; both receivers are fresh arrays. */
import { releaseTitle } from "./ytArtist.ts";
import { en, type Catalogue } from "./catalogueEn.ts";
import { deezerFollowArtists } from "./followArtistSearch.ts";
import { artistPhotoName } from "./artistPhoto.ts";

/** One follow across Library and online pages; namesakes share this name key. */
export const followArtistKey = artistPhotoName;

export type FollowLevel = "releases" | "shows";
export interface FollowedArtist {
  readonly key: string;
  readonly name: string;
  readonly level: FollowLevel;
  readonly followedAt: number;
  readonly deezerId: number | null;
  readonly ytBrowseId: string | null;
}

export interface FollowLevelEntry {
  readonly action: FollowLevel | "unfollow";
  readonly label: string;
  readonly checked: boolean;
}
/** UI renders these choices without deciding which levels are available. */
export const followLevelEntries = (level: FollowLevel | null): readonly FollowLevelEntry[] => [
  { action: "releases", label: "New releases", checked: level === "releases" },
  ...(level === null ? [] : [{ action: "unfollow" as const, label: "Unfollow", checked: false }]),
];

export type ReleaseType = "single" | "ep" | "album";
export interface FollowRelease {
  readonly key: string;
  readonly artistKey: string;
  readonly title: string;
  readonly type: ReleaseType;
  readonly releaseDate: string;
  readonly artworkUrl: string | null;
  readonly explicit: boolean;
  readonly browseId: string | null;
  readonly videoIds: readonly string[];
  readonly recordingKeys: readonly string[];
  readonly libraryAlbumId?: number | null;
}
const DAY = 86_400_000;
/** The release half of the follow feed. Played and hidden releases never return. */
export const followFeed = (input: {
  readonly follows: readonly FollowedArtist[];
  readonly releases: readonly FollowRelease[];
  readonly hidden: readonly string[];
  readonly countedPlays: readonly string[];
  readonly now: number;
  readonly enabled?: boolean;
  readonly blockExplicit?: boolean;
}): { readonly releaseCards: readonly FollowRelease[] } => {
  const follows = new Map(input.follows.map((f) => [f.key, f]));
  const hidden = new Set(input.hidden);
  const played = new Set(input.countedPlays);
  const seen = new Set<string>();
  return {
    releaseCards:
      input.enabled === false
        ? []
        : input.releases
            .filter((r) => {
              if (seen.has(r.key)) return false;
              const follow = follows.get(r.artistKey);
              const date = Date.parse(r.releaseDate);
              const shown =
                follow !== undefined &&
                Number.isFinite(date) &&
                date <= input.now &&
                date >= Math.floor(follow.followedAt / DAY) * DAY - 30 * DAY &&
                !hidden.has(r.key) &&
                !(input.blockExplicit && r.explicit) &&
                ![...r.videoIds, ...r.recordingKeys].some((id) => played.has(id));
              if (shown) seen.add(r.key);
              return shown;
            })
            .sort(
              (a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.key.localeCompare(b.key),
            ),
  };
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
/** Null means a failed response, distinct from a successful empty list. */
export const deezerReleases = (value: unknown, artistKey: string): FollowRelease[] | null => {
  if (!record(value) || !Array.isArray(value.data)) return null;
  return value.data.flatMap((r: unknown) => {
    if (
      !record(r) ||
      typeof r.id !== "number" ||
      typeof r.title !== "string" ||
      !["single", "ep", "album"].includes(String(r.record_type)) ||
      typeof r.release_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.release_date) ||
      !Number.isFinite(Date.parse(r.release_date))
    )
      return [];
    return [
      {
        key: `deezer:${r.id}`,
        artistKey,
        title: r.title,
        type: r.record_type as ReleaseType,
        releaseDate: r.release_date,
        artworkUrl: typeof r.cover_medium === "string" ? r.cover_medium : null,
        explicit: r.explicit_lyrics === true,
        browseId: null,
        videoIds: [],
        recordingKeys: [],
      },
    ];
  });
};
export const resolveDeezerFollowArtist = (value: unknown, name: string): number | null => {
  const candidates = deezerFollowArtists(value)
    ?.filter((a) => followArtistKey(a.name) === followArtistKey(name))
    .sort((a, b) => b.fans - a.fans);
  return candidates?.[0]?.deezerId ?? null;
};
export const matchFollowRelease = <
  A extends {
    readonly title: string;
    readonly releaseType?: ReleaseType | null;
  },
>(
  release: FollowRelease,
  albums: readonly A[],
): A | null =>
  albums.find(
    (a) =>
      releaseTitle(a.title) === releaseTitle(release.title) &&
      (a.releaseType ?? "album") === release.type,
  ) ?? null;
export const checkDue = (
  last: number | null,
  now: number,
  context: "home" | "background",
): boolean => last === null || now - last >= (context === "home" ? 12 : 24) * 3_600_000;
export const releaseDateLine = (date: string, now: number, strings: Catalogue = en): string => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const today = new Date(now);
  const days = Math.floor(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(year, month - 1, day)) /
      DAY,
  );
  if (days === 0) return strings.newReleases.today;
  if (days === 1) return strings.newReleases.yesterday;
  if (days > 1 && days < 7) return strings.newReleases.daysAgo(days);
  return strings.newReleases.absoluteDate(month, day, year !== today.getFullYear() ? year : null);
};
