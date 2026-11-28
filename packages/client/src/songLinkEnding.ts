/** The phone and desktop's song-link read, before either platform starts playback or shows a card. */
import {
  albumLinkOpening,
  artistLinkOpening,
  deezerShortLinkLanding,
  spotifyShortLinkLanding,
  trackLinkPlay,
  ytAlbumPlaylistOpening,
  ytChannelLinkOpening,
  ytMusicLinkPlay,
  type AlbumRead,
  type ArtistLinkOpening,
  type ArtistRead,
  type ServiceAlbum,
  type FoundYtAlbum,
  type LinkedSong,
  type PlaylistLink,
  type SongLink,
  type SongLinkFailure,
  type SongLinkPlay,
  type TrackRead,
  type ServiceTrack,
  type YtAlbumPlaylistRead,
  type YtArtistCandidate,
  type YtArtistNameRead,
  type YtSong,
  type YtSongSearch,
} from "@wave/core";

export interface LinkLibrarySong {
  readonly id: number;
  readonly title: string;
  readonly path: string | null;
}
export type SongLinkEnding<S, L> =
  | SongLinkPlay<S, L>
  | { readonly play: "failed"; readonly failure: SongLinkFailure }
  | { readonly playlist: PlaylistLink }
  /**
   * An album link's album: its YT Music page (`MPREb_…`), and the album as its link's service read
   * it (null for a YT Music album page, which nothing was read for).
   */
  | { readonly album: string; readonly read: ServiceAlbum | null }
  /** An artist link's artist: their YT Music page (`UC…`), and their name when it was read. */
  | { readonly artist: string; readonly name: string | null };

/** What a link Wave can't open here ends in. */
const CANT_OPEN = { play: "failed", failure: "cantOpen" } as const;

/** What album and artist links read (`ytAlbumPlaylist`, `ytArtist`, Spotify and Deezer artists). */
export interface LinkPagePorts {
  /** The first page of a YT Music album's playlist (`OLAK5uy_…`). */
  readonly albumPlaylist: (playlistId: string) => Promise<YtAlbumPlaylistRead>;
  /** The YT Music artist page `UC…`, read for its name. */
  readonly artistPage: (channelId: string) => Promise<YtArtistNameRead>;
  readonly spotifyArtist: (id: string, signal: AbortSignal) => Promise<ArtistRead>;
  readonly deezerArtist: (id: string, signal: AbortSignal) => Promise<ArtistRead>;
  /** One YT Music Artists search; null when it got no answer. */
  readonly searchArtists: (query: string) => Promise<readonly YtArtistCandidate[] | null>;
}

export interface SongLinkPorts<S extends YtSong, L extends LinkLibrarySong> {
  readonly stored: (videoId: string) => Promise<L | null>;
  readonly find: () => Promise<(song: LinkedSong) => L | null>;
  readonly radio: (videoId: string) => Promise<YtSongSearch<S> | null>;
  readonly search: (song: ServiceTrack) => Promise<YtSongSearch<S> | null>;
  readonly spotify: (id: string, signal: AbortSignal) => Promise<TrackRead>;
  readonly deezer: (id: string, signal: AbortSignal) => Promise<TrackRead>;
  readonly spotifyAlbum: (id: string, signal: AbortSignal) => Promise<AlbumRead>;
  /** One YT Music Albums search; null when it got no answer. */
  readonly searchAlbums: (query: string) => Promise<readonly FoundYtAlbum[] | null>;
  readonly follow: (
    url: string,
    body: boolean,
    signal: AbortSignal,
  ) => Promise<{ readonly url: string; readonly body: string }>;
  /** Album and artist links' reads; without them those links can't be opened (`cantOpen`). */
  readonly pages?: LinkPagePorts;
}

export const songLinkEnding = async <S extends YtSong, L extends LinkLibrarySong>(
  link: SongLink,
  ports: SongLinkPorts<S, L>,
  signal: AbortSignal,
): Promise<SongLinkEnding<S, L>> => {
  if (link.service === "ytMusic") {
    const [stored, find] = await Promise.all([ports.stored(link.videoId), ports.find()]);
    return ytMusicLinkPlay(link.videoId, { stored, find, radio: () => ports.radio(link.videoId) });
  }
  if (link.service === "spotifyAlbum") return albumEnding(link.albumId, ports, signal);
  if (link.service === "ytAlbum") return { album: link.browseId, read: null };
  switch (link.service) {
    case "ytAlbumPlaylist":
    case "ytArtist":
    case "spotifyArtist":
    case "deezerArtist":
      return pageEnding(link, ports.pages, signal);
  }
  const service = link.service.startsWith("spotify") ? "spotify" : "deezer";
  let trackId: string;
  if (link.service === "spotifyShort" || link.service === "deezerShort") {
    let landed;
    try {
      landed = await ports.follow(link.url, service === "spotify", signal);
    } catch {
      return { play: "failed", failure: { unread: "unreachable", service } };
    }
    if (service === "spotify") {
      const target = spotifyShortLinkLanding(landed.url, landed.body);
      if (target === null) return CANT_OPEN;
      if (target.kind === "import") return { playlist: target.link };
      if (target.kind === "album") return albumEnding(target.link.albumId, ports, signal);
      if (target.kind === "artist") return pageEnding(target.link, ports.pages, signal);
      trackId = target.link.trackId;
    } else {
      const target = deezerShortLinkLanding(landed.url);
      if (target === null) return CANT_OPEN;
      if (target.service === "deezerArtist") return pageEnding(target, ports.pages, signal);
      trackId = target.trackId;
    }
  } else trackId = link.trackId;
  const read = await ports[service](trackId, signal);
  if (!read.ok) return { play: "failed", failure: { unread: read.reason, service } };
  return trackLinkPlay(read.song, { find: await ports.find(), search: ports.search });
};

/** The YT Music album the Spotify album [albumId] opens on, or why none opens (`albumLinkOpening`). */
const albumEnding = async <S extends YtSong, L extends LinkLibrarySong>(
  albumId: string,
  ports: SongLinkPorts<S, L>,
  signal: AbortSignal,
): Promise<SongLinkEnding<S, L>> => {
  const read = await ports.spotifyAlbum(albumId, signal);
  if (!read.ok)
    return { play: "failed", failure: { unread: read.reason, service: "spotify", album: true } };
  const opening = await albumLinkOpening(read.album, ports.searchAlbums);
  return "album" in opening ? { album: opening.album, read: read.album } : opening;
};

/** A link that opens a page only with the platform's page reads (`LinkPagePorts`). */
type PageLink = Extract<
  SongLink,
  { readonly service: "ytAlbumPlaylist" | "ytArtist" | "spotifyArtist" | "deezerArtist" }
>;

/** Where the album or artist [link] opens, or why none opens; `cantOpen` without [pages]. */
const pageEnding = async (
  link: PageLink,
  pages: LinkPagePorts | undefined,
  signal: AbortSignal,
): Promise<{ readonly album: string; readonly read: ServiceAlbum } | ArtistLinkOpening> => {
  if (pages === undefined) return CANT_OPEN;
  switch (link.service) {
    case "ytAlbumPlaylist":
      return ytAlbumPlaylistOpening(() => pages.albumPlaylist(link.playlistId));
    case "ytArtist":
      return ytChannelLinkOpening(link.channelId, () => pages.artistPage(link.channelId));
    case "spotifyArtist":
      return artistEnding("spotify", link.artistId, pages, signal);
    case "deezerArtist":
      return artistEnding("deezer", link.artistId, pages, signal);
  }
};

/**
 * The YT Music artist the Spotify or Deezer artist [artistId] opens on: their name read from
 * [service], then one Artists search for it (`artistLinkOpening`), or why none opens.
 */
const artistEnding = async (
  service: "spotify" | "deezer",
  artistId: string,
  pages: LinkPagePorts,
  signal: AbortSignal,
): Promise<ArtistLinkOpening> => {
  const read = await (service === "spotify" ? pages.spotifyArtist : pages.deezerArtist)(
    artistId,
    signal,
  );
  if (!read.ok) return { play: "failed", failure: { unread: read.reason, service, artist: true } };
  return artistLinkOpening(read.name, pages.searchArtists);
};
