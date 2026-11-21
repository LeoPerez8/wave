/**
 * Following artists on the desktop (docs/spec.md, Followed Artists): the Follow button of an
 * artist's page and Settings › Followed artists. Follows are the account's rows, saved as the
 * phone saves them (`@wave/client/db/follows`), and the switch is the account's setting. The
 * country shows are looked up in is this computer's own, as it is each phone's.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  removeFollow,
  restoreFollow,
  saveFollow,
  selectFollow,
  selectFollows,
} from "@wave/client/db/follows";
import { listArtistsSync } from "@wave/client/db/libraryQueries";
import { askFollowArtists } from "@wave/client/follows/followArtistSearch";
import {
  FOLLOWED_ARTISTS_SETTING,
  artistFindText,
  createFindableList,
  followArtistKey,
  isShowCountry,
  mergeFollowArtistSearch,
  type FollowLevel,
  type FollowedArtist,
} from "@wave/core";
import * as Context from "effect/Context";

import type {
  FollowLevels,
  FollowSearchView,
  FollowState,
  FollowTargetInput,
  FollowedArtistsView,
} from "../../shared/follows.ts";

/** Where this computer keeps its Country choice; the phone's key, never synced. */
export const FOLLOW_COUNTRY_SETTING = "settings.followCountry";
/** How long Deezer gets to answer a search. */
const SEARCH_TIMEOUT_MS = 10_000;

/** The country shows are looked up in: the owner's choice, else [system]'s region. */
export const followCountry = (choice: string | undefined, system: string): string =>
  isShowCountry(choice) ? choice : system;

export interface FollowedArtistsDeps {
  readonly db: LibraryDatabase;
  /** Whether this build has a sync service to ask about shows. */
  readonly configured: boolean;
  readonly signedIn: () => boolean;
  /** The system's region, "" when unknown. */
  readonly systemCountry: () => string;
  /** A synced setting's stored value. */
  readonly setting: (key: string) => string | null;
  /** Keeps a synced setting and stamps it for sync to push. */
  readonly saveSetting: (key: string, value: string | null) => void;
  /** This computer's own settings. */
  readonly local: {
    readonly get: (key: string) => string | undefined;
    readonly set: (key: string, value: string | null) => void;
  };
  /** Deezer's artist search. */
  readonly fetch: typeof fetch;
}

export interface FollowedArtistsShape {
  readonly state: (name: string) => FollowState;
  /** Follows [target] at [level], or unfollows with null. Refused while the switch is off. */
  readonly set: (target: FollowTargetInput, level: FollowLevel | null) => FollowState;
  /** Undo for the unfollow of [key]: false when there is none, or a newer follow stays. */
  readonly restore: (key: string) => boolean;
  readonly view: () => FollowedArtistsView;
  readonly setEnabled: (on: boolean) => FollowedArtistsView;
  readonly setCountry: (country: string | null) => FollowedArtistsView;
  readonly search: (query: string) => Promise<FollowSearchView>;
  /** The country shows are looked up in, for the checks. */
  readonly country: () => string;
}

export const createFollowedArtists = (deps: FollowedArtistsDeps): FollowedArtistsShape => {
  const { db } = deps;
  const enabled = () => deps.setting(FOLLOWED_ARTISTS_SETTING) !== "off";
  const country = () => followCountry(deps.local.get(FOLLOW_COUNTRY_SETTING), deps.systemCountry());
  const levels = (): FollowLevels => {
    const signedIn = deps.signedIn();
    return {
      enabled: enabled(),
      showsAvailable: deps.configured && signedIn,
      signInForShows: deps.configured && !signedIn,
      country: country(),
    };
  };
  const state = (name: string): FollowState => {
    const shared = levels();
    return { ...shared, level: shared.enabled ? (selectFollow(db, name)?.level ?? null) : null };
  };
  /** Follows unfollowed here since Wave opened, for Undo. */
  const unfollowed = new Map<string, FollowedArtist>();
  const view = (): FollowedArtistsView => {
    const artists = new Map(
      listArtistsSync(db).map((artist) => [followArtistKey(artist.name), artist.id]),
    );
    const choice = deps.local.get(FOLLOW_COUNTRY_SETTING);
    return {
      ...levels(),
      showsConfigured: deps.configured,
      countryChoice: isShowCountry(choice) ? choice : null,
      follows: selectFollows(db).map((follow) => ({
        key: follow.key,
        name: follow.name,
        level: follow.level,
        artistId: artists.get(follow.key) ?? null,
        ytBrowseId: follow.ytBrowseId,
      })),
    };
  };

  return {
    state,
    set: (target, level) => {
      if (!enabled()) throw new Error("Followed artists is off");
      const now = Date.now();
      if (level === null) {
        const follow = selectFollow(db, target.name);
        if (follow !== null) {
          unfollowed.set(follow.key, follow);
          removeFollow(db, target.name, now);
        }
      } else {
        saveFollow(db, target, level, now);
        unfollowed.delete(followArtistKey(target.name));
      }
      return state(target.name);
    },
    restore: (key) => {
      const follow = unfollowed.get(key);
      if (follow === undefined) return false;
      unfollowed.delete(key);
      return restoreFollow(db, follow, Date.now());
    },
    view,
    setEnabled: (on) => {
      if (on !== enabled()) deps.saveSetting(FOLLOWED_ARTISTS_SETTING, on ? null : "off");
      return view();
    },
    setCountry: (choice) => {
      if (choice !== null && !isShowCountry(choice)) throw new Error("Not a country");
      deps.local.set(FOLLOW_COUNTRY_SETTING, choice);
      return view();
    },
    search: async (query) => {
      const text = query.trim();
      if (text === "" || !enabled()) return { results: [], answered: true };
      const found = await askFollowArtists(
        deps.fetch,
        text,
        AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      );
      // Read after the answer, so a follow made while Deezer was asked shows.
      const artists = listArtistsSync(db);
      const matches = createFindableList(
        artists,
        (artist) => artistFindText(artist.name),
        true,
      ).show(text).songs;
      const follows = new Map(selectFollows(db).map((follow) => [follow.key, follow.level]));
      return {
        answered: found !== null,
        results: mergeFollowArtistSearch(artists, matches, found ?? []).map((artist) => ({
          key: artist.key,
          name: artist.name,
          level: follows.get(artist.key) ?? null,
          artistId: artist.library?.id ?? null,
          deezerId: artist.deezerId,
        })),
      };
    },
    country,
  };
};

export class FollowedArtists extends Context.Service<FollowedArtists, FollowedArtistsShape>()(
  "@wave/desktop/FollowedArtists",
) {}
