/**
 * Home's Recently played: one card per place the owner played from (a
 * playlist, album or artist page, a song on its own, a mix), the latest
 * first. Core's `recentlyPlayedContexts` picks and orders them; this reads
 * the plays a page at a time and finds what each card shows.
 */
import {
  mixReplayContext,
  parseTrackId,
  recentlyPlayedContexts,
  ytTrackId,
  type PlayContext,
  type RecentlyPlayedContext,
  type RecentPlay,
  type YtAlbumSong,
} from "@wave/core";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import type { AlbumRow, ArtistRow, PlaylistRow, SongRow } from "../types.ts";
import { selectAlbums } from "./albums.ts";
import { selectArtists } from "./artists.ts";
import type { LibraryDatabase } from "./database.ts";
import type { OnlineAlbum, OnlineArtist, PlayedAlbum, PlayedArtist } from "./playedEntities.ts";
import { selectPlaylistsById } from "./playlists.ts";
import * as schema from "./schema.ts";
import { streamedSongsOf } from "./streamedSongs.ts";
import { trackQuery, type TrackScope } from "./tracks.ts";

/** A song a card shows: a Library song, or a streamed one the Library hasn't. */
export type RecentSong = SongRow | YtAlbumSong;

interface Played {
  /** What the card opens or plays (Core's `RecentlyPlayedContext`). */
  readonly context: PlayContext;
  /** When its latest play started. */
  readonly playedAt: number;
}

/** One Recently played card. */
export type RecentlyPlayedEntry = Played &
  (
    | { readonly kind: "playlist"; readonly playlist: PlaylistRow }
    /** A YT Music playlist ([context]'s id), with the song played last from it for its cover. */
    | { readonly kind: "ytPlaylist"; readonly song: RecentSong | null }
    | { readonly kind: "album"; readonly album: PlayedAlbum }
    | { readonly kind: "artist"; readonly artist: PlayedArtist }
    | { readonly kind: "song"; readonly song: RecentSong }
    /** A mix ([context] as it played), with the song played last in it for its cover. */
    | { readonly kind: "mix"; readonly song: RecentSong | null }
  );

/** How many cards the shelf shows. */
export const RECENTLY_PLAYED_SHELF = 12;
/** The shelf reads this many plays per card, then this many times more until settled. */
const PAGE_GROWTH = 4;

/** Wave's own plays of songs still known (not imported, not of a song gone since). */
const shelfPlays = and(
  isNull(schema.playEvents.importedFrom),
  or(isNotNull(schema.playEvents.trackId), isNotNull(schema.playEvents.videoId)),
);

const trackIdOf = (row: { trackId: number | null; videoId: string | null }): string =>
  row.trackId === null ? ytTrackId(row.videoId!) : String(row.trackId);

/** The contexts the shelf shows (Core's `recentlyPlayedContexts`), the plays read a page at a time. */
const playedContexts = (db: LibraryDatabase, limit: number): readonly RecentlyPlayedContext[] => {
  const { playEvents } = schema;
  for (let page = limit * PAGE_GROWTH; ; page *= PAGE_GROWTH) {
    const plays: RecentPlay[] = db
      .select({
        contextType: playEvents.contextType,
        contextId: playEvents.contextId,
        trackId: playEvents.trackId,
        videoId: playEvents.videoId,
        startedAt: playEvents.startedAt,
      })
      .from(playEvents)
      .where(shelfPlays)
      .orderBy(desc(playEvents.startedAt), desc(playEvents.id))
      .limit(page)
      .all()
      .map((row) => ({
        context:
          row.contextType === null ? null : { kind: row.contextType, id: row.contextId },
        trackId: trackIdOf(row),
        startedAt: row.startedAt,
      }));
    const contexts = recentlyPlayedContexts(plays, limit, plays.length < page);
    if (contexts !== null) return contexts;
  }
};

const byId = <R extends { readonly id: number }>(rows: readonly R[]) =>
  new Map(rows.map((row) => [row.id, row]));

/** The songs of [trackIds] (Library ids or `yt:` ones), a streamed one as its Library song once downloaded. */
const songsOf = (
  db: LibraryDatabase,
  trackIds: readonly string[],
  scope: TrackScope,
): Map<string, RecentSong> => {
  const ids: number[] = [];
  const videoIds: string[] = [];
  for (const trackId of trackIds) {
    const ref = parseTrackId(trackId);
    if (ref?.kind === "library") ids.push(ref.id);
    else if (ref?.kind === "yt") videoIds.push(ref.videoId);
  }
  const { tracks } = schema;
  const downloads =
    videoIds.length === 0
      ? []
      : db
          .select({ id: tracks.id, videoId: tracks.videoId })
          .from(tracks)
          .where(inArray(tracks.videoId, videoIds))
          .all();
  const wanted = [...ids, ...downloads.map((row) => row.id)];
  const rows = byId(
    wanted.length === 0 ? [] : trackQuery(db, scope).where(inArray(tracks.id, wanted)).all(),
  );
  const songs = new Map<string, RecentSong>();
  for (const id of ids) {
    const song = rows.get(id);
    if (song !== undefined) songs.set(String(id), song);
  }
  for (const { id, videoId } of downloads) {
    const song = rows.get(id);
    if (song !== undefined && videoId !== null) songs.set(ytTrackId(videoId), song);
  }
  if (scope === "files") return songs;
  const streamed = streamedSongsOf(
    db,
    videoIds.filter((videoId) => !songs.has(ytTrackId(videoId))),
  );
  for (const [videoId, song] of streamed) songs.set(ytTrackId(videoId), song);
  return songs;
};

/** A streamed album's card, from its page's [id] and the song played last from it. */
const onlineAlbum = (id: string, song: RecentSong | undefined): OnlineAlbum | undefined => {
  if (song === undefined) return undefined;
  const artists = "videoId" in song ? song.artists : [song.artist];
  return {
    id,
    online: true,
    title: song.album ?? "",
    artists,
    albumId: id.startsWith("name:") ? null : id,
    artworkUrl: "videoId" in song ? song.artworkUrl : null,
    albumArtist: artists.join(", "),
  };
};

/** A streamed artist's card, from their page's [id] (a browse id, or `name:` and their name). */
const onlineArtist = (id: string, song: RecentSong | undefined): OnlineArtist | undefined => {
  const name = id.startsWith("name:")
    ? id.slice("name:".length)
    : song === undefined
      ? undefined
      : "videoId" in song
        ? song.artists[0]
        : song.artist;
  if (name === undefined || name === "") return undefined;
  return { id, name, online: true, thumbPath: null, artworkPath: null };
};

const numericIds = (contexts: readonly RecentlyPlayedContext[], kind: string): number[] =>
  contexts.flatMap((entry) =>
    entry.context.kind === kind && /^\d+$/.test(entry.context.id ?? "")
      ? [Number(entry.context.id)]
      : [],
  );

/**
 * Recently played's cards in [scope] (Android Auto's: songs with a file, so
 * no streamed page, streamed song or mix), the latest played first. A card
 * whose playlist, album, artist or song is gone is left out.
 */
export const recentlyPlayedEntries = (
  db: LibraryDatabase,
  scope: TrackScope = "library",
  limit = RECENTLY_PLAYED_SHELF,
): RecentlyPlayedEntry[] => {
  const contexts = playedContexts(db, limit);
  if (contexts.length === 0) return [];
  const playlists = selectPlaylistsById(db, numericIds(contexts, "playlist"));
  const albumIds = numericIds(contexts, "album");
  const albums: Map<number, AlbumRow> = byId(
    albumIds.length === 0
      ? []
      : selectAlbums(db, inArray(schema.albums.id, albumIds), undefined, scope),
  );
  const artistIds = numericIds(contexts, "artist");
  const artists: Map<number, ArtistRow> = byId(
    artistIds.length === 0 ? [] : selectArtists(db, { ids: artistIds, scope }),
  );
  const songs = songsOf(
    db,
    contexts.map((entry) => entry.trackId),
    scope,
  );
  const streamedOn = scope === "library";
  return contexts.flatMap((entry): RecentlyPlayedEntry[] => {
    const { context, playedAt } = entry;
    const played = { context, playedAt };
    const song = songs.get(entry.trackId);
    const id = context.id ?? "";
    switch (context.kind) {
      case "playlist": {
        const playlist = playlists.get(Number(id));
        return playlist === undefined ? [] : [{ ...played, kind: "playlist", playlist }];
      }
      case "ytPlaylist":
        return streamedOn ? [{ ...played, kind: "ytPlaylist", song: song ?? null }] : [];
      case "album": {
        const album = albums.get(Number(id));
        return album === undefined ? [] : [{ ...played, kind: "album", album }];
      }
      case "ytAlbum": {
        const album = streamedOn ? onlineAlbum(id, song) : undefined;
        return album === undefined ? [] : [{ ...played, kind: "album", album }];
      }
      case "artist": {
        const artist = artists.get(Number(id));
        return artist === undefined ? [] : [{ ...played, kind: "artist", artist }];
      }
      case "ytArtist": {
        const artist = streamedOn ? onlineArtist(id, song) : undefined;
        return artist === undefined ? [] : [{ ...played, kind: "artist", artist }];
      }
    }
    if (entry.kind === "song") return song === undefined ? [] : [{ ...played, kind: "song", song }];
    return streamedOn ? [{ ...played, kind: "mix", song: song ?? null }] : [];
  });
};

/**
 * The songs played in the mix [mix] (as it played, or played again from its
 * card, `mixReplayContext`), each once, in the order they first played: what
 * its card plays again. A song gone since is left out.
 */
export const contextSongs = (db: LibraryDatabase, mix: PlayContext): RecentSong[] => {
  const { playEvents } = schema;
  const replay = mixReplayContext(mix);
  const under = (context: PlayContext) =>
    and(
      eq(playEvents.contextType, context.kind),
      context.id === null ? isNull(playEvents.contextId) : eq(playEvents.contextId, context.id),
    );
  const trackIds = [
    ...new Set(
      db
        .select({ trackId: playEvents.trackId, videoId: playEvents.videoId })
        .from(playEvents)
        .where(and(shelfPlays, or(under(mix), under(replay))))
        .orderBy(asc(playEvents.startedAt), asc(playEvents.id))
        .all()
        .map(trackIdOf),
    ),
  ];
  const songs = songsOf(db, trackIds, "library");
  const seen = new Set<RecentSong>();
  return trackIds.flatMap((trackId) => {
    const song = songs.get(trackId);
    if (song === undefined || seen.has(song)) return [];
    seen.add(song);
    return [song];
  });
};
