import { useEffect, useState, type MouseEvent } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { YtAlbumView, YtArtistAlbum, YtArtistView } from "../../shared/ytPages.ts";
import { Icon } from "./Icon.tsx";
import { labels, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";
import { Shelf, YtQuiet, YtSongList } from "./YtLists.tsx";

type Run = (action: Promise<unknown>) => void;
type Menu = (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;

/** Reads [key]'s page once; undefined while it reads, [failed] when the call fails. */
const useRead = <T,>(key: string, load: (key: string) => Promise<T>, failed: T) => {
  const [read, setRead] = useState<{ key: string; value: T }>();
  useEffect(() => {
    let current = true;
    void load(key)
      .catch(() => failed)
      .then((value) => {
        if (current) setRead({ key, value });
      });
    return () => {
      current = false;
    };
  }, [key, load, failed]);
  return read?.key === key ? read.value : undefined;
};

const readArtist = (id: string) => window.wave.yt.artist(id);
const noArtist: YtArtistView = { status: "failed", page: null };
const readAlbum = (id: string) => window.wave.yt.album(id);
const noAlbum: YtAlbumView = { status: "failed", album: null };

const videoIds = (songs: readonly BrowseRow[]) =>
  songs.flatMap((row) => (row.videoId === undefined ? [] : [row.videoId]));

/** Plays [songs] from [index], as Search's YouTube Music rows do. */
const playFrom = (run: Run, songs: readonly BrowseRow[], index: number) => {
  const ids = videoIds(songs);
  if (ids.length > 0) run(window.wave.playback.startYt(ids, Math.min(index, ids.length - 1)));
};

const releaseTiles = (releases: readonly YtArtistAlbum[]) =>
  releases.map((release) => ({
    key: release.browseId,
    title: release.title,
    caption: release.year === null ? null : String(release.year),
    artworkUrl: release.artworkUrl,
  }));

function Loading() {
  return (
    <p className="yt-quiet secondary" role="status">
      {labels.loading}
    </p>
  );
}

/** A YouTube Music artist's page: their songs, albums, singles and similar artists. */
export function YtArtistPage({
  id,
  run,
  onSongMenu,
  onAlbum,
  onArtist,
}: {
  readonly id: string;
  readonly run: Run;
  readonly onSongMenu: Menu;
  readonly onAlbum: (browseId: string) => void;
  readonly onArtist: (browseId: string) => void;
}) {
  const read = useRead(id, readArtist, noArtist);
  if (read === undefined) return <Loading />;
  const { page } = read;
  if (page === null) return <YtQuiet status={read.status === "ok" ? "failed" : read.status} />;
  const songs = page.songs.items;
  return (
    <div className="yt-page" data-testid="yt-artist">
      <div className="hero">
        <Artwork url={page.artworkUrl} artist large />
        <div className="hero-copy">
          <h1>{page.name}</h1>
          <p className="hero-meta">{[labels.artist, labels.youTubeMusic].join(" · ")}</p>
          {songs.length > 0 && (
            <div className="hero-actions">
              <button onClick={() => playFrom(run, songs, 0)}>
                <Icon name="play" size={16} />
                {labels.play}
              </button>
            </div>
          )}
        </div>
      </div>
      {songs.length > 0 && (
        <>
          <h2>{text.library.songs}</h2>
          <YtSongList
            songs={songs}
            label={text.library.songs}
            onPlay={(index) => playFrom(run, songs, index)}
            onMenu={onSongMenu}
          />
        </>
      )}
      <Shelf
        title={text.library.albums}
        items={releaseTiles(page.albums)}
        onOpen={(index) => onAlbum(page.albums[index]!.browseId)}
      />
      <Shelf
        title={text.library.singlesAndEps}
        items={releaseTiles(page.singles)}
        onOpen={(index) => onAlbum(page.singles[index]!.browseId)}
      />
      <Shelf
        title={labels.similarArtists}
        artists
        items={page.similar.map((artist) => ({
          key: artist.browseId,
          title: artist.name,
          artworkUrl: artist.artworkUrl ?? null,
          label: text.library.artistLabel(artist.name),
        }))}
        onOpen={(index) => onArtist(page.similar[index]!.browseId)}
      />
    </div>
  );
}

/** A YouTube Music album's page: its hero and its songs. */
export function YtAlbumPage({
  id,
  run,
  onSongMenu,
}: {
  readonly id: string;
  readonly run: Run;
  readonly onSongMenu: Menu;
}) {
  const read = useRead(id, readAlbum, noAlbum);
  if (read === undefined) return <Loading />;
  const { album } = read;
  if (album === null) return <YtQuiet status={read.status === "ok" ? "failed" : read.status} />;
  const songs = album.songs.items;
  const minutes = Math.round(songs.reduce((sum, row) => sum + row.durationMs, 0) / 60000);
  return (
    <div className="yt-page" data-testid="yt-album">
      <div className="hero">
        <Artwork url={album.artworkUrl} large />
        <div className="hero-copy">
          <h1>{album.title}</h1>
          {album.artists.length > 0 && <p className="hero-artist">{album.artists.join(", ")}</p>}
          <p className="hero-meta">
            {[labels.album, album.year, labels.songCount(songs.length), labels.minutes(minutes)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {songs.length > 0 && (
            <div className="hero-actions">
              <button onClick={() => playFrom(run, songs, 0)}>
                <Icon name="play" size={16} />
                {labels.play}
              </button>
            </div>
          )}
        </div>
      </div>
      <YtSongList
        songs={songs}
        label={album.title}
        onPlay={(index) => playFrom(run, songs, index)}
        onMenu={onSongMenu}
      />
    </div>
  );
}
