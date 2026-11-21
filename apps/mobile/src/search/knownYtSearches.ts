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

/** [songless]: a search embedded in another flow, which asks for artists and albums alone. */
const searchKey = (query: string, songless: boolean): string =>
  `${songless ? "scoped" : "all"}:${query}`;

export const keptYtSearch = (query: string, songless: boolean): KeptYtSearch | undefined =>
  SEARCHES.get(searchKey(query, songless));

export const keepYtSearch = (query: string, songless: boolean, answer: KeptYtSearch): void =>
  SEARCHES.set(searchKey(query, songless), answer);
