/**
 * YouTube Music's pages on the desktop (docs/spec-desktop.md, Window and layout): artist pages,
 * albums, song and artist radios and the Related tab, read in the JVM (`YtPages`) and checked
 * here before Discover, the Magic Queue and Related use them. Each read says how it went
 * (`YtStatus`): offline, YT Music off or a failure leave nothing, and the window shows its quiet
 * line. Songs a page brings are kept (`keep`) so they can stream.
 */
import {
  pickYtArtist,
  readYtPlaylist,
  relatedWithoutPlaying,
  songSearchMatch,
  songSearchQuery,
  type LibrarySongKey,
  type SongSearchKey,
  type YtAlbumSong,
  type YtArtistAlbum,
  type YtArtistCandidate,
  type YtArtistPage,
  type YtArtistSongsRead,
  ytArtistFullPage,
} from "@wave/core";

import type { YtStatus } from "../../shared/yt.ts";
import type { KotlinMethods } from "../kotlin/protocol.ts";
import { ytSongs } from "./ytMusic.ts";

type PagesMethod =
  | "artist"
  | "playlist"
  | "playlistMore"
  | "album"
  | "search"
  | "searchArtists"
  | "searchAlbums"
  | "songRadio"
  | "artistRadio"
  | "radioMore"
  | "related";

/** A JVM call; rejects with an error carrying the JVM's `code`. */
export type YtPagesCall = <M extends PagesMethod>(
  method: M,
  params: KotlinMethods[M]["params"],
) => Promise<KotlinMethods[M]["result"]>;

export interface YtPagesDeps {
  readonly call: YtPagesCall;
  /** Remembers songs a page brought, so they can stream and be queued. */
  readonly keep: (songs: readonly YtAlbumSong[]) => void;
  /** YT Music's setting: off, nothing is asked. */
  readonly enabled: () => boolean;
}

export interface YtArtistRead {
  readonly status: YtStatus;
  readonly page: YtArtistPage<YtAlbumSong> | null;
}

export interface YtRadioRead {
  readonly status: YtStatus;
  /** The radio's songs, music videos left out. */
  readonly songs: readonly YtAlbumSong[];
  /** Where the radio goes on (`radioMore`), or null at its end. */
  readonly continuation: string | null;
}

export interface YtRelatedRead {
  readonly status: YtStatus;
  readonly songs: readonly YtAlbumSong[];
  readonly artists: readonly YtArtistCandidate[];
}

export interface YtCatalogRead {
  readonly status: YtStatus;
  readonly artists: readonly YtArtistCandidate[];
  readonly albums: readonly YtArtistAlbum[];
}

export interface YtAlbumRead {
  readonly status: YtStatus;
  readonly album: {
    readonly title: string;
    readonly artists: readonly string[];
    readonly year: number | null;
    readonly artworkUrl: string | null;
    readonly songs: readonly YtAlbumSong[];
  } | null;
}

export interface YtPagesShape {
  readonly artist: (browseId: string) => Promise<YtArtistRead>;
  /** The YouTube Music artist named [name] (`pickYtArtist`), or null without one. */
  readonly findArtist: (
    name: string,
  ) => Promise<{ readonly status: YtStatus; readonly browseId: string | null }>;
  /**
   * The artist [browseId]'s page with every song of theirs (`ytArtistFullPage`), as a Library
   * artist's section reads it; rejects with the JVM's `code` when it gets no answer.
   */
  readonly artistWhole: (browseId: string) => Promise<YtArtistPage<YtAlbumSong>>;
  /** An Artists search; rejects as [artistWhole]. */
  readonly searchArtists: (query: string) => Promise<readonly YtArtistCandidate[]>;
  readonly searchAlbums: (query: string) => Promise<readonly YtArtistAlbum[]>;
  readonly album: (browseId: string) => Promise<YtAlbumRead>;
  /**
   * The album [browseId]'s title and songs as its page was last read this session, so its
   * download works from what the page shows; null when it wasn't read.
   */
  readonly albumSongs: (
    browseId: string,
  ) => { readonly title: string; readonly songs: readonly YtAlbumSong[] } | null;
  /** YouTube Music's artists and albums for [query], as Search shows them with its songs. */
  readonly catalog: (query: string) => Promise<YtCatalogRead>;
  readonly songRadio: (videoId: string) => Promise<YtRadioRead>;
  readonly artistRadio: (browseId: string) => Promise<YtRadioRead>;
  readonly radioMore: (continuation: string) => Promise<YtRadioRead>;
  /** The Related tab of [videoId], without [playing] in any version (`relatedWithoutPlaying`). */
  readonly related: (
    videoId: string,
    playing: Pick<LibrarySongKey, "title" | "artist"> | null,
  ) => Promise<YtRelatedRead>;
  /** The video id of [song]'s recording, by one Songs search (`songSearchMatch`), or null. */
  readonly findSong: (song: SongSearchKey) => Promise<string | null>;
}

const text = (value: unknown): value is string => typeof value === "string";
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
/** Album pages kept for their downloads before the oldest is dropped. */
const ALBUMS_KEPT = 50;
const BROWSE_ID = /^[A-Za-z0-9_-]{2,128}$/;

const coded = (code: string) => Object.assign(new Error(code), { code });

/** Why a read failed; never "ok". */
const statusOf = (error: unknown): Exclude<YtStatus, "ok"> => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_YT_OFFLINE" ? "offline" : code === "ERR_YT_DISABLED" ? "disabled" : "failed";
};

const albumOf = (value: unknown): YtArtistAlbum | undefined => {
  const item = record(value);
  if (!text(item["browseId"]) || !BROWSE_ID.test(item["browseId"]) || !text(item["title"]))
    return undefined;
  const release = item["releaseType"];
  return {
    kind: "album",
    browseId: item["browseId"],
    title: item["title"],
    artists: list(item["artists"]).filter(text),
    year: typeof item["year"] === "number" ? item["year"] : null,
    artworkUrl: text(item["artworkUrl"]) ? item["artworkUrl"] : null,
    ...(release === "single" || release === "ep" || release === "album"
      ? { releaseType: release }
      : {}),
  };
};

const artistOf = (value: unknown): YtArtistCandidate | undefined => {
  const item = record(value);
  if (!text(item["name"]) || !text(item["browseId"]) || !BROWSE_ID.test(item["browseId"]))
    return undefined;
  return {
    name: item["name"],
    browseId: item["browseId"],
    audience: typeof item["audience"] === "number" ? item["audience"] : null,
    artworkUrl: text(item["artworkUrl"]) ? item["artworkUrl"] : null,
  };
};

const albums = (value: unknown) => list(value).flatMap((item) => albumOf(item) ?? []);
const artists = (value: unknown) => list(value).flatMap((item) => artistOf(item) ?? []);

export const createYtPages = (deps: YtPagesDeps): YtPagesShape => {
  /** Runs [read] when YT Music is on, its failure as a status with [empty]. */
  const read = async <R extends { readonly status: YtStatus }>(
    empty: Omit<R, "status">,
    run: () => Promise<Omit<R, "status">>,
  ): Promise<R> => {
    if (!deps.enabled()) return { status: "disabled", ...empty } as R;
    try {
      return { status: "ok", ...(await run()) } as R;
    } catch (error) {
      return { status: statusOf(error), ...empty } as R;
    }
  };
  const songs = (value: unknown) => {
    const found = ytSongs(value);
    deps.keep(found);
    return found;
  };
  const radio = (answer: unknown) => {
    const page = record(answer);
    return {
      songs: songs(list(page["songs"]).filter((song) => record(song)["video"] !== true)),
      continuation: text(page["continuation"]) ? page["continuation"] : null,
    };
  };
  const noRadio = { songs: [], continuation: null };
  /** Album pages read this session, the latest last, so a download finds what its page shows. */
  const albumsRead = new Map<string, { readonly title: string; readonly songs: YtAlbumSong[] }>();
  /** The artist page [browseId] as read, its songs kept; rejects when it isn't one. */
  const artistPage = async (browseId: string) => {
    const page = record(await deps.call("artist", { browseId }));
    if (!text(page["name"])) throw new Error("Not an artist page");
    return {
      name: page["name"],
      artworkUrl: text(page["artworkUrl"]) ? page["artworkUrl"] : null,
      songs: songs(page["songs"]),
      songsPlaylistId: text(page["songsPlaylistId"]) ? page["songsPlaylistId"] : null,
      albums: albums(page["albums"]),
      singles: albums(page["singles"]),
      similar: artists(page["similar"]),
    };
  };
  const playlistPage = (value: unknown) => {
    const page = record(value);
    return {
      songs: songs(page["songs"]),
      continuation: text(page["continuation"]) ? page["continuation"] : null,
    };
  };
  return {
    artistWhole: async (browseId) => {
      if (!deps.enabled()) throw coded("ERR_YT_DISABLED");
      const page = await artistPage(browseId);
      const playlistId = page.songsPlaylistId;
      let read: YtArtistSongsRead<YtAlbumSong> | null = null;
      if (playlistId !== null) {
        let pagesRead = 0;
        try {
          const playlist = await readYtPlaylist(
            async () => ({
              title: "",
              author: null,
              artworkUrl: null,
              ...playlistPage(await deps.call("playlist", { playlistId })),
            }),
            async (continuation) => playlistPage(await deps.call("playlistMore", { continuation })),
            { onPage: () => void (pagesRead += 1) },
          );
          read = { status: "read", songs: playlist.songs, truncated: playlist.truncated };
        } catch (error) {
          read = { status: "failed", reason: statusOf(error), pagesRead };
        }
      }
      const full = ytArtistFullPage(page, read);
      if (full.status === "failed")
        throw coded(
          full.reason === "offline"
            ? "ERR_YT_OFFLINE"
            : full.reason === "disabled"
              ? "ERR_YT_DISABLED"
              : "ERR_YT_FAILED",
        );
      return full.page;
    },
    searchArtists: async (query) => {
      if (!deps.enabled()) throw coded("ERR_YT_DISABLED");
      return artists(await deps.call("searchArtists", { query }));
    },
    searchAlbums: async (query) => {
      if (!deps.enabled()) throw coded("ERR_YT_DISABLED");
      return albums(await deps.call("searchAlbums", { query }));
    },
    artist: (browseId) =>
      read<YtArtistRead>({ page: null }, async () => ({ page: await artistPage(browseId) })),
    findArtist: (name) =>
      read<{ status: YtStatus; browseId: string | null }>({ browseId: null }, async () => {
        if (pickYtArtist(name, [{ name, browseId: "-", audience: null }]) === null)
          return { browseId: null };
        return {
          browseId: pickYtArtist(name, artists(await deps.call("searchArtists", { query: name }))),
        };
      }),
    album: (browseId) =>
      read<YtAlbumRead>({ album: null }, async () => {
        const album = record(await deps.call("album", { browseId }));
        if (!text(album["title"])) throw new Error("Not an album page");
        // Each song names its album page, so its download is tagged as the album (decisions.ts).
        const read = songs(
          list(album["tracks"]).map((track) => ({
            album: album["title"],
            artworkUrl: album["artworkUrl"],
            ...record(track),
            albumId: browseId,
          })),
        );
        albumsRead.delete(browseId);
        albumsRead.set(browseId, { title: album["title"], songs: read });
        if (albumsRead.size > ALBUMS_KEPT) albumsRead.delete(albumsRead.keys().next().value!);
        return {
          album: {
            title: album["title"],
            artists: list(album["artists"]).filter(text),
            year: typeof album["year"] === "number" ? album["year"] : null,
            artworkUrl: text(album["artworkUrl"]) ? album["artworkUrl"] : null,
            songs: read,
          },
        };
      }),
    albumSongs: (browseId) => albumsRead.get(browseId) ?? null,
    catalog: (query) =>
      read<YtCatalogRead>({ artists: [], albums: [] }, async () => {
        const [found, releases] = await Promise.all([
          deps.call("searchArtists", { query }),
          deps.call("searchAlbums", { query }),
        ]);
        return { artists: artists(found), albums: albums(releases) };
      }),
    songRadio: (videoId) =>
      read<YtRadioRead>(noRadio, async () => radio(await deps.call("songRadio", { videoId }))),
    artistRadio: (browseId) =>
      read<YtRadioRead>(noRadio, async () => radio(await deps.call("artistRadio", { browseId }))),
    radioMore: (continuation) =>
      read<YtRadioRead>(noRadio, async () => radio(await deps.call("radioMore", { continuation }))),
    related: (videoId, playing) =>
      read<YtRelatedRead>({ songs: [], artists: [] }, async () => {
        const page = record(await deps.call("related", { videoId }));
        return {
          songs: relatedWithoutPlaying(playing, songs(page["songs"])),
          artists: artists(page["artists"]),
        };
      }),
    findSong: async (song) => {
      if (!deps.enabled()) return null;
      try {
        const page = record(await deps.call("search", { query: songSearchQuery(song) }));
        return songSearchMatch(song, songs(page["songs"]));
      } catch {
        return null;
      }
    },
  };
};
