/**
 * A Wave playlist written to the signed-in YouTube Music account, as Share
 * sends it (unlisted) and Export to YT Music sends it (private): its songs
 * matched there (Core's `ytShareSong`, `matchSharedSongs`; what a search
 * finds for a Library song remembered by `ytMatchMemory`), and the account's
 * playlists as Core's `syncSharedPlaylist` makes and updates them, the one
 * made for each Wave playlist remembered on this phone
 * (`share.<service>.<playlist id>`), whichever of the two made it.
 */
import {
  exportYtFavorites,
  librarySearchSong,
  matchSharedSongs,
  sharePlaylistFailureLine,
  sharedEditBatches,
  ytNewPlaylistPrivacy,
  ytPrivacyChange,
  ytShareMatch,
  ytShareSong,
  type PlaylistShareService,
  type SharedPlaylistService,
  type SharedSongs,
  type SharePlaylistFailure,
  type SpotifySong,
  type YtPlaylistPurpose,
  type YtShareItem,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { Storage } from "expo-sqlite/kv-store";

import { LibraryStore, type SongRow, type PlaylistEntryRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { settleUnsearchedSong } from "@/library/unsearchedEntries";
import { currentLocalisation } from "@/localisation/localisation";
import type { NativeYtPlaylistEdit } from "@/native/waveYtMusic";
import { askYtMusic, searchRecordingInTurn } from "@/ytmusic/askYtMusic";
import { ytMatchMemory } from "@/ytmusic/ytMatchMemory";
import { YtLibraryError, type YtMusic } from "@/ytmusic/YtMusic";

/** A search that got no answer: sharing or exporting stops rather than leave songs out for it. */
export class SearchFailed extends Error {}

/**
 * Where the [service] playlist made for the Wave playlist [id] is remembered
 * (this phone only), read and written as Core's `syncSharedPlaylist` asks.
 */
export const rememberedSharedPlaylist = (
  service: PlaylistShareService,
  id: number,
): Pick<SharedPlaylistService, "recall" | "remember"> => {
  const key = `share.${service}.${id}`;
  return {
    recall: () => Storage.getItem(key),
    remember: (playlistId) => Storage.setItem(key, playlistId),
  };
};

/** The YT Music matches this phone remembers for Library songs. */
const ytMatches = ytMatchMemory(Storage);

/**
 * [item] as YT Music sees it, with the video ids the Library's songs were
 * downloaded from and the matches remembered for them.
 */
const ytShareItem = (
  item: PlaylistEntryRow | { readonly source: "library"; readonly track: SongRow },
  videoIds: ReadonlyMap<number, string>,
  matches: ReadonlyMap<number, string>,
): YtShareItem =>
  item.source === "library"
    ? {
        source: "library",
        trackId: item.track.id,
        videoId: videoIds.get(item.track.id) ?? null,
        matched: matches.get(item.track.id) ?? null,
        song: librarySearchSong(item.track),
      }
    : item;

/** The playlist [id] (null once deleted): its name, its entries and the video ids of its Library songs. */
const readPlaylistVideoIds = (id: number) =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((store) =>
    Effect.gen(function* () {
      const detail = yield* store.getPlaylist(id, "library");
      if (detail === null) return null;
      const trackIds = detail.items.flatMap((item) =>
        item.source === "library" ? [item.track.id] : [],
      );
      const videoIds = yield* store.videoIds(trackIds);
      return { name: detail.playlist.name, items: detail.items, trackIds, videoIds };
    }),
  );

/** The playlist [id]'s name and entries as YT Music sees them; null once it's deleted. */
const readYtShareItems = async (
  id: number,
): Promise<{ readonly name: string; readonly items: YtShareItem[] } | null> => {
  const read = await appRuntime.runPromise(readPlaylistVideoIds(id));
  if (read === null) return null;
  const { name, items, trackIds, videoIds } = read;
  const matches = await ytMatches.recall(trackIds.filter((trackId) => !videoIds.has(trackId)));
  return { name, items: items.map((item) => ytShareItem(item, videoIds, matches)) };
};

/**
 * One YouTube Music Songs search for [song] in the shared allowance (as
 * Share), and the video id of the result that is the same recording. An
 * unsearched entry searched this way is settled in its playlists too, as
 * playing it would.
 */
const searchVideoId = async (song: SpotifySong, unsearched: boolean): Promise<string | null> => {
  const answer = await searchRecordingInTurn("share", song);
  if (answer === null || !answer.ok) throw new SearchFailed();
  if (unsearched) {
    const settled = await settleUnsearchedSong(
      { ...song, artworkUrl: song.artworkUrl ?? null },
      answer,
    );
    return settled.kind === "found" ? settled.becomes.song.videoId : null;
  }
  return ytShareMatch(song, answer.songs);
};

/** A Wave playlist matched on YT Music: its name now, and its songs there. */
export interface YtMatchedPlaylist {
  readonly name: string;
  readonly songs: SharedSongs;
}

/**
 * The playlist [id]'s songs matched on YT Music, remembering what a search
 * finds for a Library song so sharing or exporting again doesn't search it.
 * [progress] hears how many of its [total] songs are done. Null once the
 * playlist is deleted.
 */
export const matchOnYtMusic = async (
  id: number,
  progress?: (done: number, total: number) => void,
): Promise<YtMatchedPlaylist | null> => {
  const read = await readYtShareItems(id);
  if (read === null) return null;
  const { name, items } = read;
  // An unsearched entry is searched by its own song (`ytShareSong`), so it's told apart by identity.
  const unsearched = new Set<SpotifySong>(
    items.flatMap((item) => (item.source === "unsearched" ? [item.song] : [])),
  );
  progress?.(0, items.length);
  const songs = await matchSharedSongs(
    items.map(ytShareSong),
    (song) => searchVideoId(song, unsearched.has(song)),
    ytMatches.remember,
    progress === undefined ? undefined : (done) => progress(done, items.length),
  );
  return { name, songs };
};

/** Runs [use] on YT Music, failing with its reason. */
const ask = async <A>(
  use: (ytMusic: YtMusic["Service"]) => Effect.Effect<A, YtLibraryError>,
): Promise<A> => {
  const result = await askYtMusic(use);
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
};

/** Applies [edits] to the account's playlist [playlistId], a request's worth at a time. */
const edit = async (playlistId: string, edits: readonly NativeYtPlaylistEdit[]): Promise<void> => {
  for (const batch of sharedEditBatches(edits))
    await ask((ytMusic) => ytMusic.editPlaylist(playlistId, batch));
};

/**
 * The account's YT Music playlists, as sharing ([purpose] `share`) or
 * exporting (`export`) the Wave playlist [id] changes them: a new one is
 * unlisted when shared and private when exported (Core's
 * `ytNewPlaylistPrivacy`); sharing one that reads as private makes it
 * unlisted, and exporting leaves who sees it alone (`ytPrivacyChange`).
 */
export const ytMusicPlaylists = (id: number, purpose: YtPlaylistPurpose): SharedPlaylistService => {
  // Who sees the playlist as last read: Core's sync reads it before each change.
  let privacy: string | null = null;
  return {
    ...rememberedSharedPlaylist("ytMusic", id),
    read: async (playlistId) => {
      const playlist = await ask((ytMusic) => ytMusic.ownPlaylist(playlistId));
      if (playlist === null) return null;
      privacy = playlist.privacy;
      return playlist.entries.map(({ videoId, setVideoId }) => ({
        id: videoId,
        entryId: setVideoId,
      }));
    },
    change: (playlistId, { name, removes, adds }) => {
      const visibility = ytPrivacyChange(purpose, privacy);
      return edit(playlistId, [
        { kind: "rename", title: name },
        ...(visibility === null ? [] : [{ kind: "privacy", privacy: visibility } as const]),
        ...removes.map(
          ({ id: videoId, entryId }) => ({ kind: "remove", videoId, setVideoId: entryId }) as const,
        ),
        ...adds.map((videoId) => ({ kind: "add", videoId }) as const),
      ]);
    },
    move: (playlistId, moves) =>
      edit(
        playlistId,
        moves.map(
          ({ entryId, before }) => ({ kind: "move", setVideoId: entryId, before }) as const,
        ),
      ),
    // Made with its first request's worth and filled with the rest.
    create: async (name, ids) => {
      const [first = [], ...rest] = sharedEditBatches(ids);
      const playlistId = await ask((ytMusic) =>
        ytMusic.createPlaylist(name, first, ytNewPlaylistPrivacy(purpose)),
      );
      await edit(
        playlistId,
        rest.flat().map((videoId) => ({ kind: "add", videoId }) as const),
      );
      return playlistId;
    },
  };
};

/** Why writing a playlist on YT Music stopped, from its reason. */
export const ytMusicFailure = (error: unknown): SharePlaylistFailure | null =>
  error instanceof YtLibraryError
    ? error.reason === "offline" || error.reason === "signedOut"
      ? error.reason
      : "failed"
    : null;

/**
 * Why writing a playlist on YT Music stopped, as Share's message says it
 * (Core's `sharePlaylistFailureLine`); anything else by its own message.
 */
export const ytMusicFailureMessage = (error: unknown): string => {
  const failure = error instanceof SearchFailed ? "noSearchAnswer" : ytMusicFailure(error);
  if (failure !== null) {
    return sharePlaylistFailureLine("ytMusic", failure, currentLocalisation().strings);
  }
  return error instanceof Error ? error.message : String(error);
};

/** Favorites use the same stored ids, match memory and Songs search as playlists. */
export const likeFavoritesOnYtMusic = async (
  progress: (done: number, total: number) => void,
): Promise<SharedSongs> => {
  const read = await appRuntime.runPromise(
    // oxlint-disable-next-line react/rules-of-hooks -- Effect service lookup, not a React Hook.
    LibraryStore.use((store) =>
      Effect.gen(function* () {
        const favorites = yield* store.listFavorites;
        const videoIds = yield* store.videoIds(favorites.map((track) => track.id));
        return { favorites, videoIds };
      }),
    ),
  );
  const matches = await ytMatches.recall(
    read.favorites.filter((track) => !read.videoIds.has(track.id)).map((track) => track.id),
  );
  return exportYtFavorites(
    read.favorites.map((track) => ({
      starredAt: track.starredAt,
      song: ytShareSong(ytShareItem({ source: "library", track }, read.videoIds, matches)),
    })),
    (song) => searchVideoId(song, false),
    (videoId) => ask((ytMusic) => ytMusic.like(videoId)),
    ytMatches.remember,
    progress,
  );
};
