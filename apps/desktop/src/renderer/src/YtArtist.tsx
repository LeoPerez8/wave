import { useEffect, useState, type MouseEvent } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { YtStatus } from "../../shared/yt.ts";
import type { YtAlbumView, YtArtistRelease, YtArtistView } from "../../shared/ytPages.ts";
import { Icon } from "./Icon.tsx";
import { ARTIST_PAGE_SONGS, listDuration } from "@wave/core";
import { FollowButton } from "./FollowButton.tsx";
import { labels, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";
import { Shelf, YtQuiet, YtSongList } from "./YtLists.tsx";
import { YtListDownloadButton } from "./YtListDownloadButton.tsx";

type Run = (action: Promise<unknown>) => void;
type Menu = (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;

/**
 * Reads [key]'s page; undefined while it reads, [failed] when the call fails. `again` reads it
 * once more (Try Again on the quiet line).
 */
const useRead = <T,>(key: string, load: (key: string) => Promise<T>, failed: T) => {
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{ key: string; attempt: number; value: T }>();
  useEffect(() => {
    let current = true;
    void load(key)
      .catch(() => failed)
      .then((value) => {
        if (current) setRead({ key, attempt, value });
      });
    return () => {
      current = false;
    };
  }, [key, attempt, load, failed]);
  const again = () => setAttempt((count) => count + 1);
  return {
    value: read?.key === key && read.attempt === attempt ? read.value : undefined,
    again,
  };
};

/** The quiet line of a page YT Music didn't answer, with Try Again, which reads it again. */
function YtPageQuiet({ status, again }: { readonly status: YtStatus; readonly again: () => void }) {
  return (
    <YtQuiet status={status === "ok" ? "failed" : status}>
      {status !== "disabled" && (
        <button className="yt-quiet-again" onClick={again}>
          {text.library.tryAgain}
        </button>
      )}
    </YtQuiet>
  );
}

/** The artist page read last, so their Songs view shows the same songs without asking again. */
let lastArtist: { readonly id: string; readonly view: YtArtistView } | undefined;
const readArtist = (id: string) =>
  window.wave.yt.artist(id).then((view) => {
    lastArtist = { id, view };
    return view;
  });
const readArtistSongs = (id: string) =>
  lastArtist?.id === id && lastArtist.view.page !== null
    ? Promise.resolve(lastArtist.view)
    : readArtist(id);
const noArtist: YtArtistView = { status: "failed", page: null };
/** An album page its opener already read (a new release's tap), shown once instead of asking again. */
let held: { readonly id: string; readonly view: YtAlbumView } | undefined;
/** Hands the album page [id] the read [view], for the page about to open. */
export const holdYtAlbum = (id: string, view: YtAlbumView): void => {
  held = { id, view };
};
const readAlbum = (id: string) => {
  const given = held?.id === id ? held.view : undefined;
  held = undefined;
  return given === undefined ? window.wave.yt.album(id) : Promise.resolve(given);
};
const noAlbum: YtAlbumView = { status: "failed", album: null };

const videoIds = (songs: readonly BrowseRow[]) =>
  songs.flatMap((row) => (row.videoId === undefined ? [] : [row.videoId]));

/** Plays [songs] from [index], as Search's YouTube Music rows do. */
const playFrom = (run: Run, songs: readonly BrowseRow[], index: number) => {
  const ids = videoIds(songs);
  if (ids.length > 0) run(window.wave.playback.startYt(ids, Math.min(index, ids.length - 1)));
};

/** Plays [songs] shuffled, as a Library album's Shuffle does. */
const shuffle = (run: Run, songs: readonly BrowseRow[]) => {
  const ids = videoIds(songs);
  if (ids.length > 0) run(window.wave.playback.startYt(ids, 0, true));
};

/** Play and Shuffle, a page head's first two buttons. */
function PlayButtons({ run, songs }: { readonly run: Run; readonly songs: readonly BrowseRow[] }) {
  return (
    <>
      <button onClick={() => playFrom(run, songs, 0)}>
        <Icon name="play" size={16} />
        {labels.play}
      </button>
      <button onClick={() => shuffle(run, songs)}>
        <Icon name="shuffle" size={16} />
        {labels.shuffle}
      </button>
    </>
  );
}

const releaseTiles = (releases: readonly YtArtistRelease[]) =>
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

/**
 * A YouTube Music artist's page: their first songs in YouTube Music's order under a heading with
 * the count of all of them, See more past them to their Songs view (docs/spec.md, "Artist
 * songs"), then their albums, singles and similar artists. Play, Shuffle and a song's click play
 * every song.
 */
export function YtArtistPage({
  id,
  run,
  onSongMenu,
  onAlbum,
  onLibraryAlbum,
  onArtist,
  onSongs,
  onError,
}: {
  readonly id: string;
  readonly run: Run;
  readonly onSongMenu: Menu;
  readonly onAlbum: (browseId: string) => void;
  /** Opens the Library's album page: a release the Library already has. */
  readonly onLibraryAlbum: (albumId: number) => void;
  readonly onArtist: (browseId: string) => void;
  /** Opens the artist's Songs view. */
  readonly onSongs: () => void;
  /** Shows that following the artist didn't work. */
  readonly onError: (message: string) => void;
}) {
  const { value: read, again } = useRead(id, readArtist, noArtist);
  if (read === undefined) return <Loading />;
  const { page } = read;
  if (page === null) return <YtPageQuiet status={read.status} again={again} />;
  const songs = page.songs.items;
  const open = (release: YtArtistRelease) =>
    release.libraryId === null ? onAlbum(release.browseId) : onLibraryAlbum(release.libraryId);
  return (
    <div className="yt-page" data-testid="yt-artist">
      <div className="hero">
        <Artwork url={page.artworkUrl} artist large />
        <div className="hero-copy">
          <h1>{page.name}</h1>
          <p className="hero-meta">{[labels.artist, labels.youTubeMusic].join(" · ")}</p>
          <div className="hero-actions">
            {songs.length > 0 && <PlayButtons run={run} songs={songs} />}
            <FollowButton artist={{ name: page.name, ytBrowseId: id }} onError={onError} />
          </div>
        </div>
      </div>
      {songs.length > 0 && (
        <>
          <h2 data-testid="yt-artist-songs-heading">
            {text.library.countedHeading(text.library.songs, songs.length)}
          </h2>
          <YtSongList
            songs={songs.slice(0, ARTIST_PAGE_SONGS)}
            label={text.library.songs}
            onPlay={(index) => playFrom(run, songs, index)}
            onMenu={onSongMenu}
          />
          {songs.length > ARTIST_PAGE_SONGS && (
            <button className="artist-more" data-testid="yt-artist-see-more" onClick={onSongs}>
              {text.library.seeMore}
            </button>
          )}
        </>
      )}
      <Shelf
        title={text.library.albums}
        items={releaseTiles(page.albums)}
        onOpen={(index) => open(page.albums[index]!)}
      />
      <Shelf
        title={text.library.singlesAndEps}
        items={releaseTiles(page.singles)}
        onOpen={(index) => open(page.singles[index]!)}
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

/** A YouTube Music artist's Songs view: their name, the count, Play, Shuffle and every song. */
export function YtArtistSongsPage({
  id,
  run,
  onSongMenu,
}: {
  readonly id: string;
  readonly run: Run;
  readonly onSongMenu: Menu;
}) {
  const { value: read, again } = useRead(id, readArtistSongs, noArtist);
  if (read === undefined) return <Loading />;
  const { page } = read;
  if (page === null) return <YtPageQuiet status={read.status} again={again} />;
  const songs = page.songs.items;
  return (
    <div className="yt-page" data-testid="yt-artist-songs">
      <div className="page-heading">
        <h1>{page.name}</h1>
        <p className="secondary">{text.library.countedHeading(text.library.songs, songs.length)}</p>
        {songs.length > 0 && (
          <div className="hero-actions">
            <PlayButtons run={run} songs={songs} />
          </div>
        )}
      </div>
      <YtSongList
        songs={songs}
        label={text.library.songs}
        onPlay={(index) => playFrom(run, songs, index)}
        onMenu={onSongMenu}
      />
    </div>
  );
}

/** A YouTube Music album's page: its hero and its songs. */
export function YtAlbumPage({
  id,
  run,
  onSongMenu,
  onError,
}: {
  readonly id: string;
  readonly run: Run;
  readonly onSongMenu: Menu;
  /** Shows that the album's download didn't start or stop. */
  readonly onError: (message: string) => void;
}) {
  const { value: read, again } = useRead(id, readAlbum, noAlbum);
  if (read === undefined) return <Loading />;
  const { album } = read;
  if (album === null) return <YtPageQuiet status={read.status} again={again} />;
  const songs = album.songs.items;
  const length = listDuration(
    songs.reduce((sum, row) => sum + row.durationMs, 0),
    text.library,
  );
  return (
    <div className="yt-page" data-testid="yt-album">
      <div className="hero">
        <Artwork url={album.artworkUrl} large />
        <div className="hero-copy">
          <h1>{album.title}</h1>
          {album.artists.length > 0 && <p className="hero-artist">{album.artists.join(", ")}</p>}
          <p className="hero-meta">
            {[labels.album, album.year, labels.songCount(songs.length), length]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {songs.length > 0 && (
            <div className="hero-actions">
              <PlayButtons run={run} songs={songs} />
              <YtListDownloadButton
                list={{ kind: "album", id }}
                onError={() => onError(text.desktopLibrary.actionFailed)}
              />
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
