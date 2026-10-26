import {
  albumPlayTotals,
  artistPlayTotals,
  rankEntityPlays,
  recentlyPlayedAlbums,
  sortKey,
  streamedCredits,
  type ArtistStatsInput,
  type EntityPlayTotals,
  type PlayedAlbumKey,
  type PlayedArtistKey,
  type PlayTotals,
  type SongListening,
  type SongPlayTotals,
  type StatsWindow,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";

import type { AlbumRow, ArtistRow } from "../LibraryStore.ts";
import { selectAlbums } from "./albums.ts";
import { selectArtists } from "./artists.ts";
import { readCredits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { artistPlays, creditedPlayTotals, streamedTrack, type ArtistPlays } from "./stats.ts";
import { streamedSongsOf } from "./streamedSongs.ts";

export type OnlineAlbum = PlayedAlbumKey & {
  readonly id: string;
  readonly online: true;
  readonly albumArtist: string;
};
export type OnlineArtist = PlayedArtistKey & {
  readonly id: string;
  readonly online: true;
  readonly thumbPath: null;
  readonly artworkPath: null;
};
export type PlayedAlbum = AlbumRow | OnlineAlbum;
export type PlayedArtist = ArtistRow | OnlineArtist;
export type PlayedEntityTotal<A> = EntityPlayTotals & { readonly item: A };
export interface PlayedEntityTotals {
  readonly albums: readonly PlayedEntityTotal<PlayedAlbum>[];
  readonly artists: readonly PlayedEntityTotal<PlayedArtist>[];
}

export interface StreamedListeningTotal {
  readonly videoId: string;
  readonly trackId: number | null;
  readonly countedPlays: number;
  readonly listenedMs: number;
  readonly countedListenedMs: number;
  readonly latestPlayAt: number;
  readonly lastPlayedAt: number;
}

/** All-time reads kept per-video totals; period reads aggregate only streamed events in that window. */
export const streamedListeningTotals = (
  db: LibraryDatabase,
  window?: StatsWindow,
): StreamedListeningTotal[] => {
  const from =
    window?.from === null
      ? sql`streamed_totals AS kept CROSS JOIN play_events
        ON play_events.video_id = kept.video_id
          AND coalesce(play_events.recording_key, '') = kept.recording_key
        WHERE kept.last_played_at > ${window.to}`
      : sql`play_events WHERE play_events.video_id IS NOT NULL`;
  const aggregate = sql`SELECT play_events.video_id, play_events.recording_key,
    sum(play_events.counted) AS counted_plays, sum(play_events.listened_ms) AS listened_ms,
    sum(CASE WHEN play_events.counted THEN play_events.listened_ms ELSE 0 END) AS counted_listened_ms,
    max(play_events.started_at) AS last_played_at,
    max(CASE WHEN play_events.counted THEN play_events.started_at END) AS last_counted_at
    FROM ${from}
      ${window?.from == null ? sql`` : sql`AND play_events.started_at >= ${window.from}`}
      ${window === undefined ? sql`` : sql`AND play_events.started_at <= ${window.to}`}
    GROUP BY play_events.video_id, play_events.recording_key`;
  const source =
    window === undefined
      ? sql`SELECT * FROM streamed_totals`
      : window.from !== null
        ? aggregate
        : sql`SELECT video_id, recording_key, counted_plays, listened_ms,
      counted_listened_ms, last_played_at, last_counted_at FROM streamed_totals
      WHERE last_played_at <= ${window.to}
    UNION ALL ${aggregate}`;
  return db.all<StreamedListeningTotal>(sql`WITH streamed AS (${source})
    SELECT video_id AS "videoId", ${streamedTrack(sql`streamed.video_id`, sql`nullif(streamed.recording_key, '')`)} AS "trackId",
      counted_plays AS "countedPlays", listened_ms AS "listenedMs", counted_listened_ms AS "countedListenedMs",
      coalesce(last_counted_at, 0) AS "latestPlayAt", last_played_at AS "lastPlayedAt" FROM streamed`);
};

/**
 * The all-time counted plays streamed of each Library song they are now
 * (`streamedTrack`), by its id, from the kept totals: what a Library song's
 * own counted plays leave out.
 */
export const streamedLibraryPlays = (db: LibraryDatabase): Map<number, number> => {
  const plays = new Map<number, number>();
  for (const entry of streamedListeningTotals(db))
    if (entry.trackId !== null && entry.countedPlays > 0)
      plays.set(entry.trackId, (plays.get(entry.trackId) ?? 0) + entry.countedPlays);
  return plays;
};

/** Metadata needed by Core's credit resolver, without reading play history. */
const playedLibrary = (db: LibraryDatabase, releases: Iterable<YtAlbumSong> = []) => {
  const artists = selectArtists(db, {});
  const albums = selectAlbums(db, undefined);
  const credits = db
    .all<{ credit: string; stored: string | null }>(
      sql`
    SELECT DISTINCT artist_credit AS credit, artist_credits AS stored FROM tracks
    UNION SELECT album_artist_credit, album_artist_credits FROM albums`,
    )
    .flatMap(({ credit, stored }) => readCredits(credit, stored));
  return { artists, albums, resolve: streamedCredits({ artists, albums, credits, releases }) };
};

/** Stats and Home's album/artist totals share one resolution of every streamed song. */
export const playedEntityTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
): PlayedEntityTotals => {
  const credits = creditedPlayTotals(db, window);
  const streams = streamedListeningTotals(db, window).filter((entry) => entry.countedPlays > 0);
  const songs = streamedSongsOf(
    db,
    streams.map((entry) => entry.videoId),
  );
  const library = playedLibrary(db, songs.values());
  const artists = new Map<number | string, PlayedEntityTotal<PlayedArtist>>();
  const albums = new Map<number | string, PlayedEntityTotal<PlayedAlbum>>();
  const artistRows = new Map(library.artists.map((row) => [row.id, row]));
  const albumRows = new Map(library.albums.map((row) => [row.id, row]));
  const add = <A extends { readonly id: number | string }>(
    entries: Map<number | string, PlayedEntityTotal<A>>,
    item: A | undefined,
    key: string,
    totals: Pick<EntityPlayTotals, "countedPlays" | "listenedMs" | "latestPlayAt">,
  ) => {
    if (item === undefined) return;
    const previous = entries.get(item.id);
    entries.set(item.id, {
      ...totals,
      id: item.id,
      item,
      sortKey: key,
      countedPlays: (previous?.countedPlays ?? 0) + totals.countedPlays,
      listenedMs: (previous?.listenedMs ?? 0) + totals.listenedMs,
      latestPlayAt: Math.max(previous?.latestPlayAt ?? 0, totals.latestPlayAt),
    });
  };
  for (const totals of albumPlayTotals(credits))
    add(albums, albumRows.get(totals.id), totals.sortKey, totals);
  for (const totals of artistPlayTotals(credits))
    add(artists, artistRows.get(totals.id), totals.sortKey, totals);
  const downloaded = new Map<number, { albumId: number; artistId: number }[]>();
  for (const row of db.all<{ id: number; albumId: number; artistId: number }>(
    sql`
    SELECT tracks.id, tracks.album_id AS "albumId", track_artists.artist_id AS "artistId"
    FROM tracks JOIN track_artists ON track_artists.track_id = tracks.id
    WHERE tracks.id IN (SELECT value FROM json_each(${JSON.stringify([...new Set(streams.flatMap((entry) => (entry.trackId === null ? [] : [entry.trackId])))])}))`,
  )) {
    const links = downloaded.get(row.id) ?? [];
    links.push(row);
    downloaded.set(row.id, links);
  }
  for (const entry of streams) {
    const totals = { ...entry, listenedMs: entry.countedListenedMs };
    if (entry.trackId !== null) {
      const links = downloaded.get(entry.trackId) ?? [];
      for (const link of links) {
        const artist = artistRows.get(link.artistId);
        add(artists, artist, artist?.sort ?? "", totals);
      }
      const album = links[0] === undefined ? undefined : albumRows.get(links[0].albumId);
      add(albums, album, album?.titleSort ?? "", totals);
      continue;
    }
    const song = songs.get(entry.videoId);
    if (song === undefined) continue;
    const resolved = library.resolve(song);
    for (const artist of resolved.artists) {
      const item =
        typeof artist.id === "number"
          ? artistRows.get(artist.id)
          : { ...artist, id: artist.id, online: true as const, thumbPath: null, artworkPath: null };
      add(artists, item, sortKey(artist.name), totals);
    }
    const album = resolved.album;
    if (album !== null)
      add(
        albums,
        typeof album.id === "number"
          ? albumRows.get(album.id)
          : { ...album, id: album.id, online: true, albumArtist: album.artists.join(", ") },
        sortKey(album.title),
        totals,
      );
  }
  return {
    albums: rankEntityPlays([...albums.values()], Infinity),
    artists: rankEntityPlays([...artists.values()], Infinity),
  };
};

/** Merge the already-settled Library shelf with streamed albums, including uncounted starts. */
export const recentlyPlayedEntities = (
  db: LibraryDatabase,
  local: readonly AlbumRow[],
  limit: number,
  streams: readonly StreamedListeningTotal[],
): PlayedAlbum[] => {
  if (streams.length === 0) return [...local];
  const songs = streamedSongsOf(
    db,
    streams.map((entry) => entry.videoId),
  );
  const library = playedLibrary(db, songs.values());
  const rows = new Map<number | string, PlayedAlbum>(local.map((album) => [album.id, album]));
  const latest = db.all<{ albumId: number | string; lastPlayedAt: number }>(sql`
    SELECT tracks.album_id AS "albumId", max(play_totals.last_played_at) AS "lastPlayedAt"
    FROM tracks JOIN play_totals ON play_totals.track_id = tracks.id
    WHERE tracks.album_id IN (${sql.join([sql`NULL`, ...local.map((album) => sql`${album.id}`)], sql`, `)})
    GROUP BY tracks.album_id`);
  const trackAlbums = new Map(
    db
      .all<{ id: number; albumId: number }>(
        sql`
    SELECT id, album_id AS "albumId" FROM tracks WHERE id IN
      (SELECT value FROM json_each(${JSON.stringify([...new Set(streams.flatMap((entry) => (entry.trackId === null ? [] : [entry.trackId])))])}))`,
      )
      .map((row) => [row.id, row.albumId]),
  );
  for (const entry of streams) {
    const song = songs.get(entry.videoId);
    const resolved = song === undefined ? null : library.resolve(song).album;
    const albumId = entry.trackId === null ? resolved?.id : trackAlbums.get(entry.trackId);
    const album =
      typeof albumId === "number"
        ? library.albums.find((row) => row.id === albumId)
        : resolved === null || typeof resolved.id !== "string"
          ? undefined
          : {
              ...resolved,
              id: resolved.id,
              online: true as const,
              albumArtist: resolved.artists.join(", "),
            };
    if (album === undefined) continue;
    rows.set(album.id, album);
    latest.push({ albumId: album.id, lastPlayedAt: entry.lastPlayedAt });
  }
  // Core consumes latest-first songs and uses its usual tie-break between albums.
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  latest.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  return (recentlyPlayedAlbums(latest, limit, true) ?? []).flatMap((id) => rows.get(id) ?? []);
};

export interface PlayedArtistSongs extends ArtistPlays {
  readonly streamedListening: NonNullable<ArtistStatsInput["streamedListening"]>;
  readonly streamedSongPlays: readonly SongPlayTotals[];
}

/** Keep the artist's indexed Library read; add per-video summaries without scanning their events. */
export const playedArtistSongs = (
  db: LibraryDatabase,
  artistId: number,
  now: number,
): PlayedArtistSongs => {
  const base = artistPlays(db, artistId, now);
  const streams = streamedListeningTotals(db);
  if (streams.length === 0) return { ...base, streamedListening: [], streamedSongPlays: [] };
  const library = playedLibrary(db);
  const ids = new Set(base.songIds);
  const songs = streamedSongsOf(
    db,
    streams.map((entry) => entry.videoId),
  );
  const listening = new Map<number, SongListening>(
    base.listening.map((song) => [song.trackId, song]),
  );
  const played = new Map<number, PlayTotals>(base.songPlays.map((song) => [song.id, song]));
  const streamedListening: StreamedListeningTotal[] = [];
  const online = new Set<string>();
  const credited = (entry: StreamedListeningTotal): boolean => {
    if (entry.trackId !== null) return ids.has(entry.trackId);
    const song = songs.get(entry.videoId);
    return (
      song !== undefined && library.resolve(song).artists.some((artist) => artist.id === artistId)
    );
  };
  for (const entry of streams) {
    if (!credited(entry)) continue;
    if (entry.trackId === null) {
      streamedListening.push(entry);
      online.add(entry.videoId);
      continue;
    }
    const previous = listening.get(entry.trackId);
    listening.set(entry.trackId, {
      trackId: entry.trackId,
      artistIds: previous?.artistIds ?? [artistId],
      inLibrary: true,
      countedPlays: (previous?.countedPlays ?? 0) + entry.countedPlays,
      listenedMs: (previous?.listenedMs ?? 0) + entry.listenedMs,
      lastPlayedAt: Math.max(previous?.lastPlayedAt ?? 0, entry.lastPlayedAt),
    });
  }
  const titles = new Map(
    db
      .all<{ id: number; titleSort: string }>(
        sql`
    SELECT id, title_sort AS "titleSort" FROM tracks WHERE id IN
      (SELECT value FROM json_each(${JSON.stringify([...new Set(streams.flatMap((entry) => (entry.trackId !== null && ids.has(entry.trackId) ? [entry.trackId] : [])))])}))`,
      )
      .map((row) => [row.id, row.titleSort]),
  );
  const streamedSongPlays = new Map<string, SongPlayTotals>();
  for (const entry of streamedListeningTotals(db, { from: null, to: now })) {
    if (entry.countedPlays === 0 || !credited(entry)) continue;
    if (entry.trackId === null) {
      if (!online.has(entry.videoId)) continue;
      const previous = streamedSongPlays.get(entry.videoId);
      streamedSongPlays.set(entry.videoId, {
        song: { kind: "yt", videoId: entry.videoId },
        sortKey: sortKey(songs.get(entry.videoId)?.title ?? ""),
        countedPlays: (previous?.countedPlays ?? 0) + entry.countedPlays,
        listenedMs: (previous?.listenedMs ?? 0) + entry.countedListenedMs,
        latestPlayAt: Math.max(previous?.latestPlayAt ?? 0, entry.latestPlayAt),
      });
    } else {
      const previous = played.get(entry.trackId);
      played.set(entry.trackId, {
        id: entry.trackId,
        sortKey: titles.get(entry.trackId) ?? "",
        countedPlays: (previous?.countedPlays ?? 0) + entry.countedPlays,
        listenedMs: (previous?.listenedMs ?? 0) + entry.countedListenedMs,
        latestPlayAt: Math.max(previous?.latestPlayAt ?? 0, entry.latestPlayAt),
      });
    }
  }
  return {
    ...base,
    listening: [...listening.values()],
    songPlays: [...played.values()],
    streamedListening,
    streamedSongPlays: [...streamedSongPlays.values()],
  };
};
