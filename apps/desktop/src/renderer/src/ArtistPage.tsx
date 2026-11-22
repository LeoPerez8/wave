import { ARTIST_PAGE_SONGS, type YtPick } from "@wave/core";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type {
  ArtistAlbums,
  ArtistPageSongs,
  ArtistSectionView,
  CreditedArtist,
} from "../../shared/artistPage.ts";
import type { BrowseRow } from "../../shared/browse.ts";
import type { ArtistStatsPage, StatsRow } from "../../shared/stats.ts";
import type { MenuItem, MenuPoint } from "./Menu.tsx";
import { labels, text, language } from "./text.ts";
import { Shelf, YtSongList, type TileItem } from "./YtLists.tsx";
import { VirtualTable } from "./VirtualTable.tsx";
import "./artist.css";

/**
 * A Library artist's page beyond its hero and songs table (docs/spec.md, "Artist page"): the
 * album shelves, the Library | Online toggle and, with Online, the songs and releases of the
 * artist YouTube Music has and the Library lacks. Also the album hero's artist link.
 */

/** How many of YouTube Music's songs the page reads at a time. */
const SONGS_PAGE = 100;

/** A Library artist's Songs view: every song of theirs, sorted, from See more on their page. */
export interface ArtistSongsRoute {
  readonly kind: "artistSongs";
  readonly id: number;
}

export interface ArtistSection {
  /** The section, or null without one (YT Music off, a name that isn't an artist's). */
  readonly view: ArtistSectionView | null;
  /** The artist page's songs, in Popular order; null while they're read. */
  readonly songs: ArtistPageSongs | null;
  /** The toggle's segment picked on this visit; null: none yet. */
  readonly pick: YtPick | null;
  readonly setPick: (pick: YtPick) => void;
  /** Reads the next page of YouTube Music's songs. */
  readonly more: () => void;
}

/**
 * The YouTube Music section of the artist [artistId] (undefined: no artist page). It asks
 * YouTube Music only when Core says so: Online picked, or Search online set to Always, with no
 * saved answer standing.
 */
export const useArtistSection = (
  artistId: number | undefined,
  ytMusic: boolean,
  revision: number,
  onError: () => void,
): ArtistSection => {
  const [picked, setPicked] = useState<{ id: number | undefined; pick: YtPick | null }>({
    id: artistId,
    pick: null,
  });
  const pick = picked.id === artistId ? picked.pick : null;
  const [limit, setLimit] = useState(SONGS_PAGE);
  const [read, setRead] = useState<{
    key: string;
    view: ArtistSectionView | null;
    songs: ArtistPageSongs;
  }>();
  const [asked, setAsked] = useState(0);
  const key = `${artistId}:${pick}:${limit}:${ytMusic}:${revision}:${asked}`;
  useEffect(() => {
    if (artistId === undefined) return;
    let current = true;
    void Promise.all([
      window.wave.artistPage.section(artistId, pick, 0, limit),
      window.wave.artistPage.songs(artistId, pick, ARTIST_PAGE_SONGS),
    ])
      .then(([view, songs]) => {
        if (!current) return;
        setRead({ key, view, songs });
        if (view?.asks)
          void window.wave.artistPage
            .ask(artistId)
            .then(() => current && setAsked((n) => n + 1))
            .catch(onError);
      })
      .catch(onError);
    return () => {
      current = false;
    };
  }, [artistId, pick, limit, key, onError]);
  // While another artist's answer is read, keep the toggle where it was; then show this one's.
  const view = read?.key.startsWith(`${artistId}:`) ? read.view : null;
  return {
    view: view === null ? null : view.asks ? { ...view, note: "loading" } : view,
    songs: read?.key.startsWith(`${artistId}:`) ? read.songs : null,
    pick,
    setPick: (next) => {
      setPicked({ id: artistId, pick: next });
      setLimit(SONGS_PAGE);
      // Online after a failure asks again.
      const failed = view?.note === "offline" || view?.note === "failed";
      if (next === "online" && artistId !== undefined && failed)
        void window.wave.artistPage
          .ask(artistId)
          .then(() => setAsked((n) => n + 1))
          .catch(onError);
    },
    more: () => setLimit((n) => n + SONGS_PAGE),
  };
};

/** The Library | Online toggle at the end of the hero's Play and Shuffle. */
export function ArtistToggle({
  section,
}: {
  readonly section: {
    readonly view: { readonly toggle: YtPick } | null;
    readonly setPick: (pick: YtPick) => void;
  };
}) {
  const { view } = section;
  if (view === null) return null;
  return (
    <div className="search-online-toggle artist-toggle" role="group" aria-label={labels.ytMusic}>
      {(["library", "online"] as const).map((value) => (
        <button
          key={value}
          aria-pressed={view.toggle === value}
          title={value === "library" ? text.library.libraryHint : text.library.onlineHint}
          onClick={() => section.setPick(value)}
        >
          {text.library[value]}
        </button>
      ))}
    </div>
  );
}

const noteText = (note: NonNullable<ArtistSectionView["note"]>): string => {
  switch (note) {
    case "loading":
      return labels.loading;
    case "allInLibrary":
      return text.library.allInLibrary;
    case "noSongs":
      return text.library.noSongsOnline;
    case "notFound":
      return text.library.notFoundOnline;
    case "offline":
      return text.library.offlineTapOnline;
    case "failed":
      return text.library.noAnswerTapOnline;
  }
};

const libraryTiles = (rows: readonly BrowseRow[]): TileItem[] =>
  rows.map((row) => ({
    key: `album-${row.id}`,
    title: row.title,
    caption: row.artist,
    artworkHash: row.artworkHash,
    artworkKind: "album",
    artworkId: row.id,
  }));

const releaseTiles = (releases: ArtistSectionView["albums"]): TileItem[] =>
  releases.map((release) => ({
    key: release.browseId,
    title: release.title,
    caption: release.artists.join(", "),
    artworkUrl: release.artworkUrl,
  }));

function ArtistListening({
  artistId,
  revision,
  onError,
  onPlay,
  onMenu,
}: {
  readonly artistId: number;
  readonly revision: number;
  readonly onError: () => void;
  readonly onPlay: (row: StatsRow) => void;
  readonly onMenu: (
    row: BrowseRow,
    at: { readonly x: number; readonly y: number },
    element: Element,
  ) => void;
}) {
  const [read, setRead] = useState<{ key: string; stats: ArtistStatsPage }>();
  const key = `${artistId}:${language}:${revision}`;
  useEffect(() => {
    let current = true;
    void window.wave.stats
      .artist(artistId, language)
      .then((stats) => current && setRead({ key, stats }))
      .catch(onError);
    return () => {
      current = false;
    };
  }, [artistId, key, onError]);
  const stats = read?.key === key ? read.stats : undefined;
  if (stats === undefined)
    return (
      <p className="secondary" role="status">
        {text.stats.loadingListeningStats}
      </p>
    );
  if (!stats.played)
    return (
      <p className="secondary" role="status" data-testid="artist-not-played">
        {text.stats.notPlayedYet}
      </p>
    );
  const preview = {
    id: `artist-stats-${artistId}`,
    label: text.stats.mostPlayed,
    page: { items: stats.mostPlayed, offset: 0, total: stats.mostPlayed.length },
    trailing: (row: BrowseRow) => text.stats.plays((row as StatsRow).countedPlays),
    trailingHeading: text.stats.facts.plays,
  };
  return (
    <section
      className="artist-listening"
      aria-label={text.stats.mostPlayed}
      data-testid="artist-listening-stats"
    >
      <div className="artist-listening-facts">
        <span>{stats.plays}</span>
        <span>{stats.minutesListened}</span>
        <span>{stats.songsListened}</span>
        <span>{stats.lastPlayed}</span>
      </div>
      <h2>{text.stats.mostPlayed}</h2>
      <VirtualTable
        scope={{ kind: "artist", id: artistId }}
        revision={revision}
        preview={preview}
        onOpen={(row) => onPlay(row as StatsRow)}
        onError={onError}
        onMenu={(row, at) => {
          const element = document.getElementById(
            `artist-stats-${artistId}-${stats.mostPlayed.findIndex((item) => item.key === (row as StatsRow).key)}`,
          );
          onMenu(row, at, element ?? document.activeElement ?? document.body);
        }}
      />
    </section>
  );
}

/**
 * The artist's songs as their Songs view lists them: the Library's ([children], the songs table,
 * in its sort) and, with Online, the songs YouTube Music adds. Once the artist's list is known
 * and the sort is Popular, Online shows them all as one Popular list in YouTube Music's order,
 * each ranked song led by its rank, in place of the table, which keeps its header to sort by.
 */
export function ArtistSongs({
  section,
  onPlayStreamed,
  onSongMenu,
  children,
}: {
  readonly section: ArtistSection;
  readonly onPlayStreamed: (index: number) => void;
  readonly onSongMenu: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
  readonly children: ReactNode;
}) {
  const { view } = section;
  const online = view?.toggle === "online" ? view : null;
  const songs = online?.songs.items ?? [];
  return (
    <>
      {/* Under Popular the table keeps only its header: it reads the page's hero and sorts the list. */}
      {online?.popular ? <div className="artist-popular-head">{children}</div> : children}
      {songs.length > 0 && (
        <YtSongList
          songs={songs}
          ranked={online?.popular ? online.ranked : 0}
          label={online?.popular ? text.library.popular : labels.youTubeMusic}
          onPlay={onPlayStreamed}
          onMenu={onSongMenu}
        />
      )}
      {online !== null && online.songs.total > songs.length && (
        <button className="artist-more" onClick={section.more}>
          {text.desktopLibrary.showMoreSongs}
        </button>
      )}
      <OnlineNote section={section} />
    </>
  );
}

/** With Online, the quiet line about YouTube Music's songs (loading, none, no answer), if any. */
function OnlineNote({ section }: { readonly section: ArtistSection }) {
  const note = section.view?.toggle === "online" ? section.view.note : null;
  if (note === null) return null;
  return (
    <p className="yt-quiet secondary" role="status" data-testid="artist-online-note">
      {noteText(note)}
    </p>
  );
}

/**
 * The artist page's content: the album shelves (Albums, with the releases YouTube Music adds
 * after the Library's; Singles & EPs; Appears on), then the artist's first songs in Popular order
 * whatever the Songs view's sort (docs/spec.md, "Artist songs"), with Online YouTube Music's among
 * them, under a heading with the whole list's count; See more opens the Songs view with all of
 * them. While Find narrows the songs, every song it finds shows in the table ([children]). The
 * page scrolls as one.
 */
export function ArtistPage({
  artistId,
  revision,
  section,
  finding,
  onAlbum,
  onAlbumMenu,
  onYtAlbum,
  onPlay,
  onPlayStreamed,
  onSeeMore,
  onSongMenu,
  onStatsPlay,
  onStatsMenu,
  onError,
  children,
}: {
  readonly artistId: number;
  readonly revision: number;
  readonly section: ArtistSection;
  /** Find narrows the songs: the table lists every song it finds, with no cut. */
  readonly finding: boolean;
  readonly onAlbum: (id: number) => void;
  readonly onAlbumMenu: (row: BrowseRow, at: MenuPoint) => void;
  readonly onYtAlbum: (browseId: string) => void;
  /** Plays the page's whole Popular list from its song [index]. */
  readonly onPlay: (index: number) => void;
  readonly onPlayStreamed: (index: number) => void;
  /** Opens the artist's Songs view. */
  readonly onSeeMore: () => void;
  readonly onSongMenu: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
  readonly onStatsPlay: (row: StatsRow) => void;
  readonly onStatsMenu: (
    row: BrowseRow,
    at: { readonly x: number; readonly y: number },
    element: Element,
  ) => void;
  readonly onError: () => void;
  readonly children: ReactNode;
}) {
  const [albums, setAlbums] = useState<{ id: number; albums: ArtistAlbums }>();
  useEffect(() => {
    let current = true;
    void window.wave.artistPage
      .albums(artistId)
      .then((read) => current && setAlbums({ id: artistId, albums: read }))
      .catch(onError);
    return () => {
      current = false;
    };
  }, [artistId, revision, onError]);
  const library = albums?.id === artistId ? albums.albums : { albums: [], appearsOn: [] };
  const { view } = section;
  const online = view?.toggle === "online" ? view : null;
  const added = online?.albums ?? [];
  const singles = online?.singles ?? [];
  const listed = section.songs;
  const label = listed?.popular ? text.library.popular : text.library.songs;
  return (
    <div className="artist-page" data-testid="artist-page">
      <ArtistListening
        artistId={artistId}
        revision={revision}
        onError={onError}
        onPlay={onStatsPlay}
        onMenu={onStatsMenu}
      />
      <Shelf
        title={text.library.albums}
        items={[...libraryTiles(library.albums), ...releaseTiles(added)]}
        onOpen={(index) =>
          index < library.albums.length
            ? onAlbum(library.albums[index]!.id)
            : onYtAlbum(added[index - library.albums.length]!.browseId)
        }
        onMenu={(index, at) => {
          const row = library.albums[index];
          if (row) onAlbumMenu(row, at);
        }}
      />
      <Shelf
        title={text.library.singlesAndEps}
        items={releaseTiles(singles)}
        onOpen={(index) => onYtAlbum(singles[index]!.browseId)}
      />
      <Shelf
        title={text.library.appearsOn}
        items={libraryTiles(library.appearsOn)}
        onOpen={(index) => onAlbum(library.appearsOn[index]!.id)}
        onMenu={(index, at) => onAlbumMenu(library.appearsOn[index]!, at)}
      />
      {finding ? (
        <>
          <h2 className="artist-songs-heading">{label}</h2>
          <ArtistSongs section={section} onPlayStreamed={onPlayStreamed} onSongMenu={onSongMenu}>
            {children}
          </ArtistSongs>
        </>
      ) : (
        <>
          {listed !== null && listed.total > 0 && (
            <>
              <h2 className="artist-songs-heading" data-testid="artist-songs-heading">
                {text.library.countedHeading(label, listed.total)}
              </h2>
              <YtSongList
                songs={listed.songs}
                ranked={Math.min(listed.ranked, listed.songs.length)}
                label={label}
                onPlay={onPlay}
                onMenu={onSongMenu}
              />
              {listed.total > ARTIST_PAGE_SONGS && (
                <button className="artist-more" data-testid="artist-see-more" onClick={onSeeMore}>
                  {text.library.seeMore}
                </button>
              )}
            </>
          )}
          <OnlineNote section={section} />
        </>
      )}
    </div>
  );
}

/**
 * An album hero's artist line: a link to the artist's page, or with several credited, to a
 * choice of them. Plain text while the credit names no Library artist.
 */
export function AlbumArtistLink({
  albumId,
  credit,
  onArtist,
  onChoose,
}: {
  readonly albumId: number;
  readonly credit: string;
  readonly onArtist: (id: number) => void;
  readonly onChoose: (items: readonly MenuItem[], element: Element) => void;
}) {
  const [read, setRead] = useState<{ id: number; artists: readonly CreditedArtist[] }>();
  useEffect(() => {
    let current = true;
    void window.wave.artistPage
      .albumArtists(albumId)
      .then(({ artists }) => current && setRead({ id: albumId, artists }))
      .catch(() => current && setRead({ id: albumId, artists: [] }));
    return () => {
      current = false;
    };
  }, [albumId]);
  const artists = read?.id === albumId ? read.artists : [];
  if (artists.length === 0) return <p className="hero-artist">{credit}</p>;
  return (
    <p className="hero-artist">
      <button
        className="hero-artist-link"
        title={text.itemActions.labels.goToArtist}
        onClick={(event) =>
          artists.length === 1
            ? onArtist(artists[0]!.id)
            : onChoose(
                artists.map((artist) => ({
                  key: `artist-${artist.id}`,
                  label: artist.name,
                  run: () => onArtist(artist.id),
                })),
                event.currentTarget,
              )
        }
      >
        {credit}
      </button>
    </p>
  );
}
