/* oxlint-disable eslint/no-underscore-dangle -- Ticketmaster names its embedded response field _embedded. */
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
  readonly line?: string;
}
/** UI renders these choices without deciding which levels are available. */
export const followLevelEntries = (
  level: FollowLevel | null,
  options: {
    showsAvailable?: boolean;
    country?: string;
    notificationsDenied?: boolean;
    strings?: Catalogue;
  } = {},
): readonly FollowLevelEntry[] => [
  {
    action: "releases",
    label: (options.strings ?? en).shows.releases,
    checked: level === "releases",
  },
  ...(options.showsAvailable && options.country
    ? [
        {
          action: "shows" as const,
          label: (options.strings ?? en).shows.level(options.country),
          checked: level === "shows",
          ...(options.notificationsDenied
            ? { line: (options.strings ?? en).shows.notificationsOff }
            : {}),
        },
      ]
    : []),
  ...(level === null
    ? []
    : [
        {
          action: "unfollow" as const,
          label: (options.strings ?? en).library.unfollow,
          checked: false,
        },
      ]),
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
/** Played and hidden releases never return; show notification receipts survive country changes. */
export const followFeed = (input: {
  readonly follows: readonly FollowedArtist[];
  readonly releases: readonly FollowRelease[];
  readonly hidden: readonly string[];
  readonly countedPlays: readonly string[];
  readonly now: number;
  readonly enabled?: boolean;
  readonly blockExplicit?: boolean;
  readonly shows?: readonly FollowShow[];
  readonly country?: string;
  readonly notified?: readonly string[];
}) => {
  const follows = new Map(input.follows.map((f) => [f.key, f]));
  const hidden = new Set(input.hidden);
  const played = new Set(input.countedPlays);
  const seen = new Set<string>();
  const showIds = new Set<string>();
  const eligibleShows =
    input.enabled === false
      ? []
      : [...(input.shows ?? [])]
          .filter((s) => {
            const eligible =
              follows.get(s.artistKey)?.level === "shows" &&
              s.country === input.country &&
              Date.parse(s.startsAt) > input.now;
            return eligible;
          })
          .sort(
            (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id),
          );
  const byArtist = new Map<string, FollowShow[]>();
  for (const show of eligibleShows) {
    const shows = byArtist.get(show.artistKey) ?? [];
    if (!shows.some((s) => s.id === show.id)) shows.push(show);
    byArtist.set(show.artistKey, shows);
  }
  const artistShows = Object.fromEntries(byArtist);
  const showCards = eligibleShows.filter((show) => {
    if (showIds.has(show.id)) return false;
    showIds.add(show.id);
    return true;
  });
  const notified = new Set(input.notified);
  return {
    showCards,
    artistShows,
    toNotify: showCards.filter((s) => !notified.has(s.id)),
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
/** Home opening checks after 12 hours, the daily background task after 24. */
export type FollowCheckContext = "home" | "background";
export const checkDue = (last: number | null, now: number, context: FollowCheckContext): boolean =>
  last === null || now - last >= (context === "home" ? 12 : 24) * 3_600_000;
/**
 * Whether a Follows check has anything to ask for: the switch is on and some follow's releases,
 * or a shows-level follow's shows in `country` ("" when shows can't be checked), are due.
 */
export const followCheckDue = (input: {
  readonly enabled: boolean;
  readonly follows: readonly FollowedArtist[];
  readonly releaseChecks: readonly { readonly key: string; readonly checkedAt: number }[];
  readonly showChecks: readonly {
    readonly key: string;
    readonly country: string;
    readonly checkedAt: number;
  }[];
  readonly country: string;
  readonly now: number;
  readonly context: FollowCheckContext;
}): boolean =>
  input.enabled &&
  input.follows.some((follow) => {
    const releases = input.releaseChecks.find((c) => c.key === follow.key);
    if (checkDue(releases?.checkedAt ?? null, input.now, input.context)) return true;
    if (follow.level !== "shows" || input.country === "") return false;
    const shows = input.showChecks.find((c) => c.key === follow.key);
    return shows?.country !== input.country || checkDue(shows.checkedAt, input.now, input.context);
  });
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

export interface FollowShow {
  readonly id: string;
  readonly artistKey: string;
  readonly country: string;
  readonly startsAt: string;
  readonly city: string;
  readonly venue: string;
  readonly ticketUrl: string;
}
const embedded = (value: unknown, key: string): unknown[] | null => {
  if (!record(value)) return null;
  if (record(value._embedded) && Array.isArray(value._embedded[key]))
    return value._embedded[key] as unknown[];
  return record(value.page) && value.page.totalElements === 0 ? [] : null;
};
export const ticketmasterAttraction = (value: unknown, name: string): string | null => {
  const match = embedded(value, "attractions")?.find(
    (a) =>
      record(a) &&
      typeof a.id === "string" &&
      typeof a.name === "string" &&
      followArtistKey(a.name) === followArtistKey(name) &&
      Array.isArray(a.classifications) &&
      a.classifications.some(
        (c: unknown) => record(c) && record(c.segment) && c.segment.name === "Music",
      ),
  );
  return record(match) ? (match.id as string) : null;
};
export const ticketmasterShows = (value: unknown, artistKey: string): FollowShow[] | null => {
  const events = embedded(value, "events");
  if (events === null) return null;
  return events.flatMap((e) => {
    if (
      !record(e) ||
      typeof e.id !== "string" ||
      typeof e.url !== "string" ||
      !e.url.startsWith("https://") ||
      !record(e.dates) ||
      !record(e.dates.start) ||
      (record(e.dates.status) &&
        ["cancelled", "postponed"].includes(String(e.dates.status.code))) ||
      e.dates.start.dateTBD === true ||
      e.dates.start.dateTBA === true ||
      !record(e._embedded) ||
      !Array.isArray(e._embedded.venues)
    )
      return [];
    const v: unknown = e._embedded.venues[0];
    if (
      !record(v) ||
      typeof v.name !== "string" ||
      !record(v.city) ||
      typeof v.city.name !== "string" ||
      !record(v.country) ||
      typeof v.country.countryCode !== "string"
    )
      return [];
    const start = e.dates.start;
    // Date-only shows remain visible through the local show date.
    const startsAt =
      typeof start.dateTime === "string"
        ? start.dateTime
        : typeof start.localDate === "string"
          ? start.localDate + "T23:59:59"
          : "";
    if (!Number.isFinite(Date.parse(startsAt))) return [];
    return [
      {
        id: e.id,
        artistKey,
        country: v.country.countryCode.toUpperCase(),
        startsAt,
        city: v.city.name,
        venue: v.name,
        ticketUrl: e.url,
      },
    ];
  });
};
