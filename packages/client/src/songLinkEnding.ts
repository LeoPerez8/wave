/** The phone and desktop's song-link read, before either platform starts playback or shows a card. */
import {
  albumLinkOpening,
  deezerShortLinkLanding,
  spotifyShortLinkLanding,
  trackLinkPlay,
  ytMusicLinkPlay,
  type AlbumRead,
  type ServiceAlbum,
  type FoundYtAlbum,
  type LinkedSong,
  type PlaylistLink,
  type SongLink,
  type SongLinkFailure,
  type SongLinkPlay,
  type TrackRead,
  type ServiceTrack,
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
  /** A Spotify album link's album: its YT Music page (`MPREb_…`), and the album as Spotify read it. */
  | { readonly album: string; readonly read: ServiceAlbum };

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
      if (target === null) return { play: "failed", failure: "cantOpen" };
      if (target.kind === "import") return { playlist: target.link };
      if (target.kind === "album") return albumEnding(target.link.albumId, ports, signal);
      trackId = target.link.trackId;
    } else {
      const target = deezerShortLinkLanding(landed.url);
      if (target === null) return { play: "failed", failure: "cantOpen" };
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
