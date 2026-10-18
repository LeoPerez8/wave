/**
 * Reading a public Spotify playlist without an account or key (docs/spec.md,
 * "Importing playlists from a link"; the research is docs/spotify-playlists.md).
 * The embed page gives the playlist's first 100 songs and an anonymous token;
 * with that token the web player's own `fetchPlaylist` gives every song, page
 * by page. Requests go through the app's transport; Core builds and reads them.
 */

import { array, at, positive, text } from "./json.ts";

/** A song as Spotify lists it in a playlist. */
export interface SpotifySong {
  readonly title: string;
  /** Every credited artist, in Spotify's order; none for a local file without one. */
  readonly artists: readonly string[];
  /** Its album, when Spotify gives it (`fetchPlaylist` does, the embed page doesn't). */
  readonly album: string | null;
  readonly durationMs: number | null;
  /** Its album's cover, when Spotify gives one (`fetchPlaylist` does for a song on Spotify). */
  readonly artworkUrl?: string | null;
}

/** One page of `fetchPlaylist`'s answer. */
export interface SpotifyPlaylistPage {
  readonly title: string;
  readonly artworkUrl: string | null;
  /** How many items the playlist has. */
  readonly total: number;
  /** How many items this page held, songs or not: the next page starts after them. */
  readonly items: number;
  /** Its songs, in order; items that aren't songs (podcast episodes) left out. */
  readonly songs: readonly SpotifySong[];
}

/** A playlist as the embed page shows it: its first 100 songs at most. */
export interface SpotifyEmbedPlaylist {
  readonly title: string;
  readonly artworkUrl: string | null;
  readonly songs: readonly SpotifySong[];
}

export type SpotifyEmbed =
  | {
      readonly status: "found";
      readonly playlist: SpotifyEmbedPlaylist;
      /** The anonymous token the page was given, which `fetchPlaylist` accepts. */
      readonly token: string | null;
    }
  /** No such public playlist (unknown, malformed, private or deleted). */
  | { readonly status: "notFound" };

/** The first source's address of a list of images (`[{ sources: [{ url }] }]` or `{ sources }`). */
export const firstImage = (sources: unknown): string | null =>
  array(sources)
    .map((source) => text(at(source, "url")))
    .find((url) => url !== null) ?? null;

/** What one page of a paged read says: how many items it held and how many there are in all, or that the read ends with [done]. */
export type SpotifyPageStep<R> =
  { readonly items: number; readonly total: number } | { readonly done: R };

/**
 * Reads a Spotify list page by page with [page], from offset 0, each page
 * starting after the items of the one before, until a page is empty or the
 * items reach its total: then [end]'s result. A page can end the read sooner
 * with its own (`done`).
 */
export const readSpotifyPages = async <R>(
  page: (offset: number) => Promise<SpotifyPageStep<R>>,
  end: () => R,
): Promise<R> => {
  for (let offset = 0; ;) {
    const step = await page(offset);
    if ("done" in step) return step.done;
    offset += step.items;
    if (step.items === 0 || offset >= step.total) return end();
  }
};

/** A `fetchPlaylist` item, or null when it isn't a song. */
const pageSong = (item: unknown): SpotifySong | null =>
  spotifyTrackSong(at(item, "itemV2", "data"));

/**
 * A track's `data` as the web player's queries give it (a `fetchPlaylist`
 * item's, a `fetchLibraryTracks` item's), or null when it isn't a song:
 * an episode, or a song Spotify no longer has.
 */
export const spotifyTrackSong = (data: unknown): SpotifySong | null => {
  const kind = text(at(data, "__typename"));
  if (kind === "Track") {
    const title = text(at(data, "name"));
    if (title === null) return null;
    const artworkUrl = firstImage(at(data, "albumOfTrack", "coverArt", "sources"));
    const song: SpotifySong = {
      title,
      artists: array(at(data, "artists", "items"))
        .map((artist) => text(at(artist, "profile", "name")))
        .filter((name) => name !== null),
      album: text(at(data, "albumOfTrack", "name")),
      durationMs:
        positive(at(data, "trackDuration", "totalMilliseconds")) ??
        positive(at(data, "duration", "totalMilliseconds")),
    };
    return artworkUrl === null ? song : { ...song, artworkUrl };
  }
  if (kind === "LocalTrack") {
    const title = text(at(data, "name"));
    if (title === null) return null;
    const artist = text(at(data, "artistName"));
    return {
      title,
      artists: artist === null ? [] : [artist],
      album: text(at(data, "albumName")),
      durationMs: positive(at(data, "localTrackDuration", "totalMilliseconds")),
    };
  }
  return null;
};

/** Spotify's answers for a playlist that isn't there: an unknown id, or a malformed one. */
const NOT_FOUND = new Set(["NotFound", "GenericError"]);

/**
 * A page of `fetchPlaylist`'s answer: the playlist's name, cover, size and
 * this page's songs. `"notFound"` when Spotify has no such public playlist;
 * null when the answer isn't a playlist at all.
 */
export const spotifyPlaylistPage = (response: unknown): SpotifyPlaylistPage | "notFound" | null => {
  const playlist = at(response, "data", "playlistV2");
  const kind = text(at(playlist, "__typename"));
  if (kind !== null && NOT_FOUND.has(kind)) return "notFound";
  if (kind !== "Playlist") return null;
  const content = at(playlist, "content");
  const items = at(content, "items");
  const total = at(content, "totalCount");
  if (!Array.isArray(items) || typeof total !== "number") return null;
  return {
    title: text(at(playlist, "name")) ?? "",
    artworkUrl: firstImage(at(array(at(playlist, "images", "items"))[0], "sources")),
    total,
    items: items.length,
    songs: items.map(pageSong).filter((song) => song !== null),
  };
};

// ---------------------------------------------------------------------------
// Reading a playlist

/** A request to Spotify, for the app's transport to send. */
export interface SpotifyRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

/** Spotify's answer: its HTTP status and body. */
export interface SpotifyAnswer {
  readonly status: number;
  readonly body: string;
}

/** Sends a request to Spotify; rejects when Spotify can't be reached. */
export type SpotifyTransport = (request: SpotifyRequest) => Promise<SpotifyAnswer>;

/** A Spotify playlist as read: its name, cover and songs in its order. */
export interface SpotifyPlaylist {
  readonly title: string;
  readonly artworkUrl: string | null;
  readonly songs: readonly SpotifySong[];
  /** It goes on past [songs]: the read stopped at the cap, or had only the embed page's first 100. */
  readonly truncated: boolean;
  /**
   * How many items Spotify says the playlist has (`totalCount`), songs or
   * not; the songs read when only the embed page was.
   */
  readonly total: number;
}

/**
 * Why a playlist wasn't read: Spotify has no such public playlist, Spotify
 * couldn't be reached, or it answered with something else (cancelled too).
 */
export type SpotifyReadFailure = "missing" | "unreachable" | "failed";

export type SpotifyRead =
  | { readonly ok: true; readonly playlist: SpotifyPlaylist }
  | { readonly ok: false; readonly reason: SpotifyReadFailure };

/** Songs asked for per `fetchPlaylist` call: 1,000 works, 5,000 times out. */
const PAGE_SIZE = 500;

/** The embed page shows at most this many songs. */
const EMBED_CAP = 100;

/**
 * `fetchPlaylist`'s persisted-query id in the web player's bundle. Spotify
 * changes it when it changes the query; an unknown one answers 412 and the
 * read falls back to the embed page (docs/spotify-playlists.md says how to
 * find the new one).
 */
const FETCH_PLAYLIST_HASH = "8964e8eafb21aa992a7d951d256d83285c04be2105d209262901de70cb97584a";

const embedRequest = (playlistId: string): SpotifyRequest => ({
  method: "GET",
  url: `https://open.spotify.com/embed/playlist/${playlistId}`,
  headers: {},
  body: null,
});

const pageRequest = (playlistId: string, offset: number, token: string): SpotifyRequest => ({
  method: "POST",
  url: "https://api-partner.spotify.com/pathfinder/v2/query",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    variables: {
      uri: `spotify:playlist:${playlistId}`,
      offset,
      limit: PAGE_SIZE,
      enableWatchFeedEntrypoint: false,
    },
    operationName: "fetchPlaylist",
    extensions: { persistedQuery: { version: 1, sha256Hash: FETCH_PLAYLIST_HASH } },
  }),
});

const parsed = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/** Every song through `fetchPlaylist`; null when any page fails. */
const readPages = async (
  playlistId: string,
  token: string,
  send: SpotifyTransport,
  signal: AbortSignal | undefined,
): Promise<SpotifyPlaylist | null> => {
  const songs: SpotifySong[] = [];
  let first: SpotifyPlaylistPage | null = null;
  let last: SpotifyPlaylistPage | null = null;
  let reached = 0;
  return readSpotifyPages<SpotifyPlaylist | null>(
    async (offset) => {
      if (signal?.aborted === true) return { done: null };
      let answer: SpotifyAnswer;
      try {
        answer = await send(pageRequest(playlistId, offset, token));
      } catch {
        return { done: null };
      }
      const page = answer.status === 200 ? spotifyPlaylistPage(parsed(answer.body)) : null;
      if (page === null || page === "notFound") return { done: null };
      first ??= page;
      last = page;
      reached = offset + page.items;
      songs.push(...page.songs);
      return page;
    },
    () =>
      first === null || last === null
        ? null
        : {
            title: first.title,
            artworkUrl: first.artworkUrl,
            songs,
            truncated: reached < last.total,
            total: last.total,
          },
  );
};

/**
 * Reads the public playlist [playlistId] through [send]: the embed page
 * (`open.spotify.com/embed/playlist/<id>`), which says whether the playlist
 * is there and gives an anonymous token, then every song with that token
 * through `fetchPlaylist`, 500 a page, with no song limit. When
 * `fetchPlaylist` fails (its query id changed, the token is refused, Spotify
 * throttles), the embed page's first 100 songs stand in. Spotify is sent the
 * playlist id, the page asked for and the token it gave, nothing else. Once
 * [signal] is aborted nothing more is asked.
 */
export const readSpotifyPlaylist = async (
  playlistId: string,
  send: SpotifyTransport,
  signal?: AbortSignal,
): Promise<SpotifyRead> => {
  const cancelled = (): boolean => signal?.aborted === true;
  let answer: SpotifyAnswer;
  try {
    answer = await send(embedRequest(playlistId));
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const embed = answer.status === 200 ? spotifyEmbed(answer.body) : null;
  if (embed === null) return { ok: false, reason: "failed" };
  if (embed.status === "notFound") return { ok: false, reason: "missing" };
  if (cancelled()) return { ok: false, reason: "failed" };
  const whole =
    embed.token === null ? null : await readPages(playlistId, embed.token, send, signal);
  if (cancelled()) return { ok: false, reason: "failed" };
  const playlist = whole ?? {
    ...embed.playlist,
    truncated: embed.playlist.songs.length >= EMBED_CAP,
    total: embed.playlist.songs.length,
  };
  return { ok: true, playlist };
};

/** The embed page's data: Next.js's JSON in its `__NEXT_DATA__` script. */
const NEXT_DATA = /<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/u;

/** The artists of an embed track: its subtitle, "A, B" (a name with a comma splits, as nothing better is given). */
const embedArtists = (subtitle: string | null): string[] =>
  (subtitle ?? "")
    .split(", ")
    .map((name) => name.trim())
    .filter((name) => name !== "");

const embedSong = (track: unknown): SpotifySong | null => {
  const title = text(at(track, "title"));
  if (title === null || text(at(track, "entityType")) !== "track") return null;
  return {
    title,
    artists: embedArtists(text(at(track, "subtitle"))),
    album: null,
    durationMs: positive(at(track, "duration")),
  };
};

/**
 * What the playlist's embed page (`spotifyEmbedUrl`) says: the playlist (its
 * first 100 songs at most) and an anonymous token, or that there's no such
 * public playlist. Null when the page holds neither, as when Spotify serves
 * something else.
 */
export const spotifyEmbed = (html: string): SpotifyEmbed | null => {
  const script = NEXT_DATA.exec(html)?.[1];
  if (script === undefined) return null;
  let data: unknown;
  try {
    data = JSON.parse(script);
  } catch {
    return null;
  }
  const props = at(data, "props", "pageProps");
  const status = at(props, "status");
  if (status === 404 || status === 500) return { status: "notFound" };
  const entity = at(props, "state", "data", "entity");
  const tracks = at(entity, "trackList");
  if (text(at(entity, "type")) !== "playlist" || !Array.isArray(tracks)) return null;
  return {
    status: "found",
    token: text(at(props, "state", "settings", "session", "accessToken")),
    playlist: {
      title: text(at(entity, "name")) ?? text(at(entity, "title")) ?? "",
      artworkUrl: firstImage(at(entity, "coverArt", "sources")),
      songs: tracks.map(embedSong).filter((song) => song !== null),
    },
  };
};
