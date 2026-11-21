import {
  searchOnlineAlways,
  type YtSection,
  stepYtSection,
  ytSearchQuery,
  ytSectionToggle,
  ytSectionView,
  YT_SECTION_HIDDEN,
  type SearchOnline,
  type YtSearchLibrary,
  type YtSong,
} from "@wave/core";
import { useEffect, useMemo, useReducer, useState, type MouseEvent, type ReactNode } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { YtSearchPage } from "../../shared/yt.ts";
import { Icon } from "./Icon.tsx";
import { labels, text } from "./text.ts";
import { Artwork, time } from "./VirtualTable.tsx";
import { AlbumCredit, ArtistCredit, type YtCreditLinks } from "./YtCredit.tsx";
import { Shelf } from "./YtLists.tsx";
import { listRowDrag, songDragProps } from "./songDrag.ts";

type SearchSong = YtSong & { readonly row: BrowseRow };

/** What Search's YouTube Music results open: a song's credits, an artist's or an album's page. */
export interface YtSearchLinks extends YtCreditLinks {
  /** Opens the YouTube Music artist page [browseId]. */
  readonly onArtistPage: (browseId: string) => void;
}

/** What the Library already has of the answer to [query], by id, as main found it. */
interface InLibrary {
  readonly query: string;
  readonly songs: ReadonlySet<string>;
  readonly artists: ReadonlySet<string>;
  readonly albums: ReadonlySet<string>;
}

const NOTHING_IN_LIBRARY: Omit<InLibrary, "query"> = {
  songs: new Set(),
  artists: new Set(),
  albums: new Set(),
};

const FAILED: YtSearchPage = {
  status: "failed",
  songs: { items: [], offset: 0, total: 0 },
  artists: [],
  albums: [],
  inLibrary: { songs: [], artists: [], albums: [] },
};

/** The line the section shows instead of results; offline and failures have their quiet line. */
const notes = (): Readonly<Record<string, string>> => ({
  noMatches: text.playbackText.nothingOnlineMatches,
  allInLibrary: text.playbackText.everythingFoundOnlineIsAlreadyInYourLibrary,
});

/**
 * The section Search showed last, so Back to Search shows it again as it was (Online picked or
 * not) instead of starting over; a page holds one search at a time.
 */
let kept: { readonly section: YtSection<SearchSong>; readonly inLibrary?: InLibrary } | undefined;

/**
 * Search's Library | Online toggle, the Library's results ([children]) and YouTube Music's songs,
 * artists and albums under them. Core's `stepYtSection` decides when YT Music is asked, as on the
 * phone: when Online is picked, when the Library has nothing for the query, or as you type with
 * Search online set to Always. Core's `ytSectionView` leaves out what the Library already has.
 * Hidden while YT Music is off; offline, one quiet line says the results come back online.
 */
export function YtResults({
  query,
  enabled,
  preference,
  libraryHasResults,
  onPlay,
  onDownload,
  onMenu,
  links,
  children,
}: {
  readonly query: string;
  readonly enabled: boolean;
  readonly preference: SearchOnline | undefined;
  /** Undefined while the Library is still answering this query. */
  readonly libraryHasResults: boolean | undefined;
  readonly onPlay: (videoId: string) => void;
  /** Downloads a song into the Library; it shows on the Downloads page. */
  readonly onDownload: (videoId: string) => void;
  /** Opens a song's menu (a right-click). */
  readonly onMenu?: ((row: BrowseRow, event: MouseEvent<HTMLElement>) => void) | undefined;
  readonly links: YtSearchLinks;
  readonly children: ReactNode;
}) {
  const trimmed = query.trim();
  const [section, dispatch] = useReducer(stepYtSection<SearchSong>, YT_SECTION_HIDDEN, () =>
    kept !== undefined && "query" in kept.section && kept.section.query === ytSearchQuery(trimmed)
      ? kept.section
      : YT_SECTION_HIDDEN,
  );
  const [selected, setSelected] = useState<number>();
  const [inLibrary, setInLibrary] = useState(() => kept?.inLibrary);
  useEffect(() => {
    kept = { section, ...(inLibrary === undefined ? {} : { inLibrary }) };
  }, [section, inLibrary]);
  const ready = preference !== undefined;
  useEffect(() => {
    if (preference === undefined) return;
    dispatch({
      type: "typed",
      query: trimmed,
      enabled,
      libraryHasResults,
      // The desktop has no mobile data.
      always: searchOnlineAlways(preference, { onMobileData: false }),
    });
  }, [trimmed, enabled, preference, libraryHasResults]);
  const current =
    enabled && ready && "query" in section && section.query === ytSearchQuery(trimmed);
  const loading = current && section.status === "loading" ? section.query : null;
  const delay = section.status === "loading" ? section.delayMs : 0;
  useEffect(() => {
    if (loading === null) return;
    let active = true;
    const timer = setTimeout(() => {
      void window.wave.yt
        .search(loading)
        .catch((): YtSearchPage => FAILED)
        .then((page) => {
          if (!active) return;
          if (page.status === "ok") {
            setInLibrary({
              query: loading,
              songs: new Set(page.inLibrary.songs),
              artists: new Set(page.inLibrary.artists),
              albums: new Set(page.inLibrary.albums),
            });
            dispatch({
              type: "found",
              query: loading,
              songs: page.songs.items.flatMap((row): SearchSong[] =>
                row.videoId === undefined
                  ? []
                  : [
                      {
                        videoId: row.videoId,
                        title: row.title,
                        artists: row.artists ?? [row.artist],
                        album: row.album,
                        durationMs: row.durationMs,
                        artworkUrl: row.artworkUrl ?? null,
                        explicit: false,
                        row,
                      },
                    ],
              ),
              artists: page.artists,
              albums: page.albums,
            });
          } else
            dispatch({
              type: "failed",
              query: loading,
              reason: page.status === "offline" ? "offline" : "failed",
            });
          setSelected(undefined);
        });
    }, delay);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [loading, delay]);
  const pick = ytSectionToggle(section);
  const view = useMemo(() => {
    const query = "query" in section ? section.query : null;
    const known = inLibrary?.query === query ? inLibrary : NOTHING_IN_LIBRARY;
    const library: YtSearchLibrary<SearchSong> = {
      hasSong: (song) => known.songs.has(song.videoId),
      hasArtist: (artist) => known.artists.has(artist.browseId),
      hasAlbum: (album) => known.albums.has(album.browseId),
    };
    return ytSectionView(section, library);
  }, [section, inLibrary]);
  const results = current && section.status === "results" ? view : null;
  const songs = results?.songs.map((song) => song.row) ?? [];
  return (
    <>
      {enabled && (
        <div className="search-online-toggle" role="group" aria-label={text.settings.searchOnline}>
          {(["library", "online"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={pick === value}
              disabled={!ready}
              title={value === "library" ? text.library.libraryHint : text.library.onlineHint}
              onClick={() => dispatch({ type: "picked", pick: value })}
            >
              {text.library[value]}
            </button>
          ))}
        </div>
      )}
      {children}
      {current && section.status === "quiet" && (
        <p className="yt-quiet secondary" role="status" data-testid="yt-status">
          {section.reason === "offline" ? labels.ytOffline : labels.ytFailed}
        </p>
      )}
      {current && section.status === "loading" && (
        <p className="yt-quiet secondary" role="status">
          {text.library.searching}
        </p>
      )}
      {results !== null && (
        <section
          className="yt-results"
          aria-labelledby="yt-results-heading"
          data-testid="yt-results"
        >
          <h2 id="yt-results-heading">{labels.youTubeMusic}</h2>
          {results.note !== null && notes()[results.note] !== undefined && (
            <p className="secondary">{notes()[results.note]}</p>
          )}
          {songs.length > 0 && (
            <div role="list" aria-label={text.playbackText.songs} data-testid="yt-songs">
              {songs.map((row, index) => (
                <div
                  key={row.videoId ?? index}
                  role="listitem"
                  className="yt-item table-columns"
                  onContextMenu={(event) => {
                    if (onMenu === undefined) return;
                    event.preventDefault();
                    setSelected(index);
                    onMenu(row, event);
                  }}
                >
                  <button
                    className="table-row table-columns yt-row"
                    aria-selected={selected === index}
                    aria-label={[row.title, row.artist].filter(Boolean).join(", ")}
                    {...songDragProps(() => listRowDrag(row))}
                    onClick={() => setSelected(index)}
                    onDoubleClick={() => row.videoId !== undefined && onPlay(row.videoId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (row.videoId !== undefined) onPlay(row.videoId);
                      }
                    }}
                  >
                    <span className="title-cell">
                      <span className="row-picture">
                        <Artwork url={row.artworkUrl} />
                        <span className="row-play">
                          <Icon name="play" size={16} />
                        </span>
                      </span>
                      <span className="truncate">{row.title}</span>
                    </span>
                    <span />
                    <span className="album-column" />
                    <span className="star-column" />
                    <span className="time-column secondary">
                      {row.durationMs > 0 ? time(row.durationMs) : ""}
                    </span>
                  </button>
                  {/* Over the row's own cells: a name opens its page, the rest of the row plays. */}
                  <ArtistCredit row={row} links={links} className="yt-credit truncate secondary" />
                  <AlbumCredit
                    row={row}
                    links={links}
                    className="yt-credit yt-credit-album album-column truncate secondary"
                  />
                  {row.videoId !== undefined && (
                    <button
                      className="icon-button yt-download"
                      aria-label={`${text.itemActions.labels.download}, ${row.title}`}
                      title={text.itemActions.labels.download}
                      onClick={() => onDownload(row.videoId!)}
                    >
                      <Icon name="download" size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <Shelf
            title={text.playbackText.artists}
            artists
            items={results.artists.map((artist) => ({
              key: artist.browseId,
              title: artist.name,
              artworkUrl: artist.artworkUrl ?? null,
              label: text.library.artistLabel(artist.name),
            }))}
            onOpen={(index) => links.onArtistPage(results.artists[index]!.browseId)}
          />
          <Shelf
            title={text.playbackText.albums}
            items={results.albums.map((album) => ({
              key: album.browseId,
              title: album.title,
              caption: album.artists.join(", "),
              artworkUrl: album.artworkUrl,
              label: text.library.albumLabel(album.title, album.artists.join(", ")),
            }))}
            onOpen={(index) => links.onAlbum(results.albums[index]!.browseId)}
          />
        </section>
      )}
    </>
  );
}
