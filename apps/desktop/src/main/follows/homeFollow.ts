/**
 * New from Artists You Follow and Upcoming Shows on the desktop's Home (docs/spec.md, Followed
 * artists). Which cards show is Core's (`homeFollowCards`), over the snapshot, the checks and
 * the release opening the phone uses (`@wave/client/follows`). This file gives them the
 * desktop's settings, session and YT Music reads. Follows, hidden releases and the two switches
 * come with the account; each device keeps its own release and show answers, so the desktop
 * runs the checks itself. It posts no show notification: the phone does.
 */
import { Database } from "@wave/client";
import { askWaveService, type WaveServiceRequest } from "@wave/client/askWaveService";
import type { LibraryDatabase } from "@wave/client/db/database";
import { followReleasesCheck, type FollowYt } from "@wave/client/follows/followReleasesCheck";
import { openFollowRelease } from "@wave/client/follows/followReleaseOpen";
import { followShowsCheck } from "@wave/client/follows/followShowsCheck";
import { databaseFollowStore } from "@wave/client/follows/followStore";
import { readHomeFollowSnapshot } from "@wave/client/follows/homeFollowSnapshot";
import {
  DONT_PLAY_EXPLICIT_SETTING as DONT_PLAY_EXPLICIT,
  FOLLOWED_ARTISTS_SETTING as FOLLOWED_ARTISTS,
  SHOW_CHECKS_TODAY_SETTING as CHECKS_TODAY,
  homeFollowCards,
  type FollowAlbumRead,
  type FollowRelease,
} from "@wave/core";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { HomeFollowView, HomeReleaseOpening } from "../../shared/homeFollow.ts";
import { stampPreference } from "@wave/client/db/sync";
import { sql } from "drizzle-orm";
import { ytRow } from "../../shared/yt.ts";
import type { YtAlbumView } from "../../shared/ytPages.ts";
import { preference, savePreference } from "../preferences.ts";
import { keepPreference, syncedPreference } from "../sync/desktopSync.ts";
import { createFollowedArtists, FollowedArtists } from "./followedArtists.ts";
import type { YtPagesShape } from "../yt/ytPages.ts";
import { YtMusic } from "../yt/ytMusic.ts";
import { YtFeatures } from "../yt/ytServices.ts";

/** A cover larger than this isn't one. */
const MAX_ARTWORK_BYTES = 2_000_000;
const MAX_ARTWORK_KEPT = 300;

export interface HomeFollowDeps {
  readonly db: LibraryDatabase;
  /** Whether this build has a sync service to ask about shows. */
  readonly configured: boolean;
  readonly signedIn: () => boolean;
  /** One GET to the sync service with the session (`askWaveService`). */
  readonly ask: (path: string) => Promise<unknown>;
  readonly online: () => boolean;
  /** The country shows are looked up in: the system's region, "" when unknown. */
  readonly country: () => string;
  /** A synced setting's stored value. */
  readonly setting: (key: string) => string | null;
  /** This computer's own settings. */
  readonly local: {
    readonly get: (key: string) => string | undefined;
    readonly set: (key: string, value: string) => void;
  };
  readonly ytEnabled: () => boolean;
  readonly pages: Pick<YtPagesShape, "album" | "catalog" | "searchArtists">;
  /** Deezer's releases and covers. */
  readonly fetch: typeof fetch;
  /** The gap before each show request; a test shortens it. */
  readonly pause?: Duration.Input;
}

export interface HomeFollowShape {
  /** Both sections' cards, from what the last checks saved. */
  readonly view: () => Promise<HomeFollowView>;
  /** Checks releases and shows that are due; true when it saved anything. */
  readonly check: () => Promise<boolean>;
  /** Where the release card [key] opens. */
  readonly open: (key: string) => Promise<HomeReleaseOpening>;
  /** The cover of the release card [key] as a data URL, or null. */
  readonly artwork: (key: string) => Promise<string | null>;
}

/** Deezer's image hosts, the only ones a cover is read from. */
const deezerCover = (url: string | null): url is string => {
  if (url === null) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".dzcdn.net");
  } catch {
    return false;
  }
};

class YtReadFailed extends Error {}

export const createHomeFollow = (deps: HomeFollowDeps): HomeFollowShape => {
  const { db, pages } = deps;
  const store = databaseFollowStore(db);
  const enabled = () => deps.setting(FOLLOWED_ARTISTS) !== "off";
  const ytMusic = () => enabled() && deps.ytEnabled();

  const read = <A>(ask: () => Promise<A | null>) =>
    Effect.tryPromise({ try: ask, catch: () => new YtReadFailed() }).pipe(
      Effect.flatMap((answer) =>
        answer === null ? Effect.fail(new YtReadFailed()) : Effect.succeed(answer),
      ),
    );
  /** The check's YT Music reads over the desktop's pages; anything but an answer fails. */
  const yt: FollowYt<YtReadFailed> = {
    searchAlbums: (query) =>
      read(async () => {
        const found = await pages.catalog(query);
        return found.status === "ok" ? found.albums : null;
      }),
    album: (browseId) =>
      read(async () => {
        const found = await pages.album(browseId);
        return found.status === "ok" && found.album !== null ? { tracks: found.album.songs } : null;
      }),
    searchArtists: (name) => read(() => pages.searchArtists(name)),
  };

  const checksToday = {
    get: () => {
      try {
        const value = JSON.parse(deps.local.get(CHECKS_TODAY) ?? "null") as {
          day?: unknown;
          count?: unknown;
        } | null;
        return typeof value?.day === "number" && typeof value.count === "number"
          ? { day: value.day, count: value.count }
          : null;
      } catch {
        return null;
      }
    },
    set: (value: { readonly day: number; readonly count: number }) =>
      deps.local.set(CHECKS_TODAY, JSON.stringify(value)),
  };
  const checkShows = followShowsCheck({
    configured: deps.configured,
    enabled,
    country: deps.country,
    signedIn: async () => deps.signedIn(),
    online: deps.online,
    checksToday,
    ask: deps.ask,
    ...(deps.pause === undefined ? {} : { pause: deps.pause }),
  });
  const checkReleases = followReleasesCheck<YtReadFailed>({
    enabled,
    ytEnabled: deps.ytEnabled,
    blockExplicit: () => deps.setting(DONT_PLAY_EXPLICIT) === "on",
    // A read that fails with the computer offline ends the round.
    offline: () => !deps.online(),
    country: deps.country,
    showsCheckable: async () => deps.configured && deps.signedIn(),
    checkShows: (context) => checkShows(store, context),
    fetch: deps.fetch,
  });

  /** The cards as Home shows them now, with each release's artist. */
  const cards = async () => {
    const now = Date.now();
    const country = deps.country();
    const { known } = await Effect.runPromise(readHomeFollowSnapshot(store, country, now));
    const shown = homeFollowCards(known, {
      now,
      enabled: enabled(),
      ytMusic: ytMusic(),
      blockExplicit: deps.setting(DONT_PLAY_EXPLICIT) === "on",
      country,
    });
    const names = new Map(known.follows.map((follow) => [follow.key, follow.name]));
    return { ...shown, artist: (key: string) => names.get(key) ?? "" };
  };

  const covers = new Map<string, Promise<string | null>>();
  const cover = (url: string): Promise<string | null> => {
    const kept = covers.get(url);
    if (kept) return kept;
    const loading = (async () => {
      const answer = await deps.fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      const type = answer.headers.get("content-type") ?? "";
      if (!answer.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
      const bytes = Buffer.from(await answer.arrayBuffer());
      return bytes.length > MAX_ARTWORK_BYTES
        ? null
        : `data:${type};base64,${bytes.toString("base64")}`;
    })().catch(() => null);
    covers.set(url, loading);
    // A cover that didn't come is asked for again; the oldest give way to new ones.
    void loading.then((data) => {
      if (data === null) covers.delete(url);
    });
    if (covers.size > MAX_ARTWORK_KEPT) covers.delete(covers.keys().next().value!);
    return loading;
  };

  let checking: Promise<boolean> | undefined;
  return {
    view: async () => {
      const { releaseCards, showCards, artist } = await cards();
      return {
        releases: releaseCards.map((r) => ({
          key: r.key,
          title: r.title,
          artist: artist(r.artistKey),
          type: r.type,
          releaseDate: r.releaseDate,
          hasArtwork: deezerCover(r.artworkUrl),
        })),
        shows: showCards.map((s) => ({
          id: s.id,
          artist: artist(s.artistKey),
          startsAt: s.startsAt,
          city: s.city,
          venue: s.venue,
          ticketUrl: s.ticketUrl,
        })),
      };
    },
    check: () => {
      checking ??= Effect.runPromise(checkReleases(store, yt, "home"))
        .catch(() => false)
        .finally(() => {
          checking = undefined;
        });
      return checking;
    },
    open: async (key) => {
      const { releaseCards, artist } = await cards();
      const release: FollowRelease | undefined = releaseCards.find((r) => r.key === key);
      if (release === undefined) return { kind: "notFound" };
      if (release.libraryAlbumId) return { kind: "album", id: release.libraryAlbumId };
      // The album read here is the one its page shows, so the page doesn't ask again.
      let shown: YtAlbumView | undefined;
      const opening = await Effect.runPromise(
        openFollowRelease(store, release, artist(release.artistKey), {
          ytMusic,
          keep: enabled,
          searchAlbums: async (query) => {
            const found = await pages.catalog(query);
            return found.status === "ok" ? found.albums : null;
          },
          album: async (browseId): Promise<FollowAlbumRead> => {
            const found = await pages.album(browseId);
            if (found.status !== "ok") return "noAnswer";
            if (found.album === null) return "missing";
            const songs = found.album.songs.map(ytRow);
            shown = {
              status: "ok",
              album: { ...found.album, songs: { items: songs, offset: 0, total: songs.length } },
            };
            return { videoIds: found.album.songs.map((song) => song.videoId) };
          },
        }),
      );
      // "search" and "gone" never leave `openFollowRelease`.
      return opening.kind === "open"
        ? shown === undefined
          ? { kind: "ytAlbum", browseId: opening.browseId }
          : { kind: "ytAlbum", browseId: opening.browseId, album: shown }
        : {
            kind:
              opening.kind === "search"
                ? "noAnswer"
                : opening.kind === "gone"
                  ? "notFound"
                  : opening.kind,
          };
    },
    artwork: async (key) => {
      const url = (await cards()).releaseCards.find((r) => r.key === key)?.artworkUrl ?? null;
      return deezerCover(url) ? cover(url) : null;
    },
  };
};

export class HomeFollow extends Context.Service<HomeFollow, HomeFollowShape>()(
  "@wave/desktop/HomeFollow",
) {}

/**
 * HomeFollow over the Library and YT Music's pages, and FollowedArtists beside it; shows are
 * asked with the account's session.
 */
const homeFollowLayer = (options: {
  readonly request: WaveServiceRequest;
  readonly configured: boolean;
  readonly signedIn: () => boolean;
  readonly online: () => boolean;
  /** The system's region; the owner's Country choice in Settings comes first. */
  readonly country: () => string;
  readonly fetch: typeof fetch;
}) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const db = yield* Database;
      const yt = yield* YtMusic;
      const features = yield* YtFeatures;
      const followed = createFollowedArtists({
        db,
        configured: options.configured,
        signedIn: options.signedIn,
        systemCountry: options.country,
        setting: (key) => syncedPreference(db, key),
        saveSetting: (key, value) => {
          keepPreference(db, key, value);
          stampPreference(db, key, Date.now());
        },
        local: {
          get: (key) => preference(db, key),
          set: (key, value) => {
            if (value === null) db.run(sql`DELETE FROM desktop_settings WHERE key = ${key}`);
            else savePreference(db, key, value);
          },
        },
        fetch: options.fetch,
      });
      const home = createHomeFollow({
        db,
        configured: options.configured,
        signedIn: options.signedIn,
        ask: (path) => askWaveService(options.request, path),
        online: options.online,
        country: followed.country,
        setting: (key) => syncedPreference(db, key),
        local: {
          get: (key) => preference(db, key),
          set: (key, value) => savePreference(db, key, value),
        },
        ytEnabled: yt.enabled,
        pages: features.pages,
        fetch: options.fetch,
      });
      return Context.make(HomeFollow, home).pipe(Context.add(FollowedArtists, followed));
    }),
  );

/** [base] with HomeFollow and FollowedArtists over it. */
export const withHomeFollow =
  (options: Parameters<typeof homeFollowLayer>[0]) =>
  <A, E, R>(base: Layer.Layer<A, E, R>) =>
    homeFollowLayer(options).pipe(Layer.provideMerge(base));
