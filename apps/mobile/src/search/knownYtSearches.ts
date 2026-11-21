/**
 * YT Music's answers to the queries Search asked this session, so asking one
 * again (typing it back, reopening Search) draws its results in the first
 * frame with no request (docs/spec.md › Fluidity, online screens). Only whole
 * answers are kept: a failed search is asked again.
 */
import {
  knownPages,
  type YtArtistAlbum,
  type YtArtistCandidate,
  type YtCommunityPlaylist,
} from "@wave/core";

import type { NativeYtSong } from "@/native/waveYtMusic";

export interface KeptYtSearch {
  readonly songs: readonly NativeYtSong[];
  readonly artists: readonly YtArtistCandidate[];
  readonly albums: readonly YtArtistAlbum[];
  readonly videos: readonly NativeYtSong[] | undefined;
  readonly playlists: readonly YtCommunityPlaylist[];
}

/** A few result pages each; queries typed back and forth during a visit. */
const SEARCHES = knownPages<KeptYtSearch>(24);

type SearchKind = "all" | "artistsAlbums" | "songs";

/** Search scopes keep separate answers because each asks different endpoints. */
const searchKey = (query: string, kind: SearchKind): string => `${kind}:${query}`;

export const keptYtSearch = (query: string, kind: SearchKind): KeptYtSearch | undefined =>
  SEARCHES.get(searchKey(query, kind));

export const keepYtSearch = (query: string, kind: SearchKind, answer: KeptYtSearch): void =>
  SEARCHES.set(searchKey(query, kind), answer);
