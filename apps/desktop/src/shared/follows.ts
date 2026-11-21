/**
 * Following artists on the desktop (docs/spec.md, Followed Artists): the Follow button of an
 * artist's page and Settings › Followed artists, as the window draws them.
 */
import type { FollowLevel } from "@wave/core";

import type { Invoke } from "./bridge.ts";

/** The artist a Follow button or a search result follows. */
export interface FollowTargetInput {
  readonly name: string;
  readonly deezerId?: number;
  readonly ytBrowseId?: string;
}

/** What decides which levels are offered (Core's `followLevelEntries`). */
export interface FollowLevels {
  /** The Followed artists switch; off, no Follow button shows and nothing is read. */
  readonly enabled: boolean;
  /** Shows can be followed: this build has the sync service and a Wave account is signed in. */
  readonly showsAvailable: boolean;
  /** Signing in to a Wave account would make shows available. */
  readonly signInForShows: boolean;
  /** The country shows are looked up in, as its two-letter code; "" when unknown. */
  readonly country: string;
}

/** One artist's follow, for their page's button. */
export interface FollowState extends FollowLevels {
  readonly level: FollowLevel | null;
}

/** A followed artist on Settings › Followed artists. */
export interface FollowedArtistRow {
  readonly key: string;
  readonly name: string;
  readonly level: FollowLevel;
  /** The Library's artist of that name, whose page the row opens. */
  readonly artistId: number | null;
  readonly ytBrowseId: string | null;
}

export interface FollowedArtistsView extends FollowLevels {
  /** Whether this build can look shows up at all: without it there is no Country row. */
  readonly showsConfigured: boolean;
  /** The Country choice; null follows the system's region. */
  readonly countryChoice: string | null;
  /** The artists followed, A to Z. */
  readonly follows: readonly FollowedArtistRow[];
}

/** An artist Find artists to follow lists. */
export interface FollowSearchResult {
  readonly key: string;
  readonly name: string;
  readonly level: FollowLevel | null;
  readonly artistId: number | null;
  readonly deezerId: number | null;
}

export interface FollowSearchView {
  /** The Library's matches first, then Deezer's. */
  readonly results: readonly FollowSearchResult[];
  /** False when Deezer gave no answer: the Library's matches are still listed. */
  readonly answered: boolean;
}

/** Whether [value] names an artist the window may follow. */
export const validFollowTarget = (value: unknown): value is FollowTargetInput => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { name, deezerId, ytBrowseId, ...rest } = value as Record<string, unknown>;
  return (
    Object.keys(rest).length === 0 &&
    validFollowName(name) &&
    (deezerId === undefined || (Number.isSafeInteger(deezerId) && (deezerId as number) > 0)) &&
    (ytBrowseId === undefined ||
      (typeof ytBrowseId === "string" && /^[\w-]{1,64}$/.test(ytBrowseId)))
  );
};
/** An artist's name, or a search for one. */
export const validFollowName = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && value.length <= 300;
export const validFollowLevel = (value: unknown): value is FollowLevel | null =>
  value === null || value === "releases" || value === "shows";

/** The calls to main. */
export interface FollowsContract {
  readonly "follows.state": {
    readonly args: readonly [name: string];
    readonly result: FollowState;
  };
  /** Follows at a level, or unfollows with null. */
  readonly "follows.set": {
    readonly args: readonly [target: FollowTargetInput, level: FollowLevel | null];
    readonly result: FollowState;
  };
  /** Undo after an unfollow: false when the artist was followed again meanwhile. */
  readonly "follows.restore": { readonly args: readonly [key: string]; readonly result: boolean };
  readonly "follows.view": { readonly args: readonly []; readonly result: FollowedArtistsView };
  readonly "follows.setEnabled": {
    readonly args: readonly [on: boolean];
    readonly result: FollowedArtistsView;
  };
  readonly "follows.setCountry": {
    readonly args: readonly [country: string | null];
    readonly result: FollowedArtistsView;
  };
  readonly "follows.search": {
    readonly args: readonly [query: string];
    readonly result: FollowSearchView;
  };
}

export const FOLLOWS_CALLS = [
  "follows.state",
  "follows.set",
  "follows.restore",
  "follows.view",
  "follows.setEnabled",
  "follows.setCountry",
  "follows.search",
] as const satisfies readonly (keyof FollowsContract)[];

type Call<C extends keyof FollowsContract> = (
  ...args: FollowsContract[C]["args"]
) => Promise<FollowsContract[C]["result"]>;

/** `window.wave.follows`. */
export interface FollowsBridge {
  readonly state: Call<"follows.state">;
  readonly set: Call<"follows.set">;
  readonly restore: Call<"follows.restore">;
  readonly view: Call<"follows.view">;
  readonly setEnabled: Call<"follows.setEnabled">;
  readonly setCountry: Call<"follows.setCountry">;
  readonly search: Call<"follows.search">;
}

export const followsBridge = (invoke: Invoke): FollowsBridge => ({
  state: (name) => invoke("follows.state", name),
  set: (target, level) => invoke("follows.set", target, level),
  restore: (key) => invoke("follows.restore", key),
  view: () => invoke("follows.view"),
  setEnabled: (on) => invoke("follows.setEnabled", on),
  setCountry: (country) => invoke("follows.setCountry", country),
  search: (query) => invoke("follows.search", query),
});
