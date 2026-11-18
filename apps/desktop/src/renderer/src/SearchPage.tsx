import { formatNumber, type SearchOnline } from "@wave/core";
import { useEffect, useState, type ReactNode } from "react";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import {
  searchSections,
  type LibrarySearchView,
  type LyricsHitView,
  type SearchExpansion,
  type SearchKind,
  type SearchSection,
} from "../../shared/search.ts";
import { Icon } from "./Icon.tsx";
import { language, labels, text, albumName, artistName, tagTitle } from "./text.ts";
import type { SongState } from "../../shared/songState.ts";
import { markClass, rowMark, SongMark, useSongStates } from "./SongMark.tsx";
import { Artwork, time } from "./VirtualTable.tsx";
import { YtResults } from "./YtResults.tsx";

const groupLabel = (): Readonly<Record<SearchKind, string>> => ({
  song: text.playbackText.songs,
  album: text.playbackText.albums,
  artist: text.playbackText.artists,
  playlist: text.playbackText.playlists,
  genre: text.playbackText.genres,
});
const kindLabel = (): Readonly<Record<SearchKind, string>> => ({
  song: text.playbackText.song,
  album: labels.album,
  artist: labels.artist,
  playlist: labels.playlist,
  genre: labels.genre,
});
const count = (value: number) => formatNumber(language, value);

/** A song row of Search: double-click or Enter plays it, the context menu opens its actions. */
function SongRow({
  row,
  subtitle,
  selected,
  onSelect,
  onPlay,
  onMenu,
  testId,
  states,
}: {
  readonly states: ReadonlyMap<number, SongState>;
  readonly row: BrowseRow;
  readonly subtitle?: ReactNode;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onPlay: () => void;
  readonly onMenu: (at: { readonly x: number; readonly y: number }) => void;
  readonly testId: string;
}) {
  const mark = rowMark(row, states);
  return (
    <button
      role="listitem"
      className={`table-row table-columns search-row ${markClass(mark)}`}
      data-testid={testId}
      aria-selected={selected}
      aria-disabled={row.unavailable}
      aria-label={[row.title, row.artist].filter(Boolean).join(", ")}
      onClick={onSelect}
      onDoubleClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onPlay();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <span className="title-cell">
        <span className="row-picture">
          <Artwork hash={row.artworkHash} />
          <SongMark mark={mark} title={row.title} />
        </span>
        <span className="search-row-title">
          <span className="truncate">{row.title}</span>
          {subtitle}
        </span>
      </span>
      <span className="truncate secondary">{artistName(row.artist)}</span>
      <span className="album-column truncate secondary">{albumName(row.album)}</span>
      <span className="star-column">{row.favorite && <Icon name="favorites" size={14} />}</span>
      <span className="time-column secondary">
        {row.durationMs > 0 ? time(row.durationMs) : ""}
      </span>
    </button>
  );
}

/** The lyrics line a song was found by, with the query's words marked. */
function LyricLine({ hit }: { readonly hit: LyricsHitView }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const range of hit.ranges) {
    if (range.start > at) parts.push(hit.line.slice(at, range.start));
    parts.push(<mark key={range.start}>{hit.line.slice(range.start, range.end)}</mark>);
    at = range.end;
  }
  if (at < hit.line.length) parts.push(hit.line.slice(at));
  return <span className="lyric-line truncate secondary">{parts}</span>;
}

/** "Show all" under a preview, or the note that only the best matches are listed. */
function More({
  section,
  onShowAll,
}: {
  readonly section: Exclude<SearchSection, { type: "top" }>;
  readonly onShowAll: () => void;
}) {
  if (section.more)
    return (
      <button className="search-more" onClick={onShowAll}>
        {text.playbackText.showAllValue(count(section.total))}
      </button>
    );
  if (section.capped)
    return (
      <p className="search-capped secondary">
        {text.playbackText.theBestValueOfValueKeepTypingToNarrowThemDown(
          count(section.shown),
          count(section.total),
        )}
      </p>
    );
  return null;
}

/** Recent searches while the field is empty, as on the phone: pick one, or clear them all. */
function RecentSearches({
  revision,
  onPick,
  onError,
}: {
  readonly revision: number;
  readonly onPick: (query: string) => void;
  readonly onError: () => void;
}) {
  const [recent, setRecent] = useState<readonly string[]>();
  useEffect(() => {
    let current = true;
    void window.wave.search
      .recent()
      .then((page) => current && setRecent(page.items))
      .catch(onError);
    return () => {
      current = false;
    };
  }, [revision, onError]);
  if (recent === undefined) return null;
  if (recent.length === 0)
    return (
      <div className="search-empty" data-testid="search-empty">
        <h2>{text.playbackText.searchYourLibrary}</h2>
        <p className="secondary">{text.playbackText.findSongsAlbumsArtistsGenresAndPlaylists}</p>
      </div>
    );
  return (
    <section className="search-section" data-testid="recent-searches">
      <div className="search-heading">
        <h2>{text.playbackText.recentSearches}</h2>
        <button
          className="search-more"
          onClick={() =>
            void window.wave.search
              .clearRecent()
              .then(() => setRecent([]))
              .catch(onError)
          }
        >
          {text.playbackText.clear}
        </button>
      </div>
      <div role="list">
        {recent.map((query) => (
          <button
            key={query}
            role="listitem"
            className="recent-search"
            onClick={() => onPick(query)}
          >
            <Icon name="search" size={14} />
            <span className="truncate">{query}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export interface SearchPageProps {
  readonly query: string;
  /** Changes when the Library or playback did, to search again. */
  readonly revision: number;
  /** Opens an album, artist, playlist or genre. */
  readonly onOpen: (route: BrowseScope) => void;
  /** Plays song [index] of the songs Search lists (its Songs group, then its lyrics hits). */
  readonly onPlay: (index: number, row: BrowseRow) => void;
  readonly onMenu: (row: BrowseRow, at: { readonly x: number; readonly y: number }) => void;
  /** A song on a drive that isn't connected was asked to play. */
  readonly onUnavailable: () => void;
  /** A recent search was picked. */
  readonly onPick: (query: string) => void;
  readonly onError: () => void;
  readonly ytMusic: boolean;
  readonly searchOnline: SearchOnline | undefined;
  readonly onYtPlay: (videoId: string) => void;
  readonly onYtDownload: (videoId: string) => void;
}

/**
 * Search over the Library, ranked by Core as on the phone: the top result, the Songs table,
 * the songs found by their lyrics and the Albums, Artists, Playlists and Genres shelves.
 * An empty field shows the recent searches.
 */
export function SearchPage(props: SearchPageProps) {
  const { query, revision, onError } = props;
  const trimmed = query.trim();
  const [view, setView] = useState<LibrarySearchView>();
  useEffect(() => {
    if (trimmed === "") return;
    let current = true;
    void window.wave.search
      .library(trimmed)
      .then((found) => current && setView(found))
      .catch(onError);
    return () => {
      current = false;
    };
  }, [trimmed, revision, onError]);
  const current = view?.query === trimmed ? view : undefined;
  return (
    <div className="search-page" data-testid="search-page">
      <YtResults
        query={trimmed}
        enabled={props.ytMusic}
        preference={props.searchOnline}
        // As on the phone, lyrics hits alone don't keep YouTube Music from being asked.
        libraryHasResults={current === undefined ? undefined : current.groups.length > 0}
        onPlay={props.onYtPlay}
        onDownload={props.onYtDownload}
      >
        <LibraryResults {...props} view={current} />
      </YtResults>
    </div>
  );
}

function LibraryResults({
  query,
  revision,
  onOpen,
  onPlay,
  onMenu,
  onUnavailable,
  onPick,
  onError,
  view,
}: SearchPageProps & { readonly view: LibrarySearchView | undefined }) {
  const trimmed = query.trim();
  const [expanded, setExpanded] = useState<{ query: string; open: SearchExpansion }>();
  const [selected, setSelected] = useState<number>();
  const songs = view?.groups.find((group) => group.kind === "song")?.items ?? [];
  const states = useSongStates([
    ...songs.map((row) => row.id),
    ...(view?.lyrics ?? []).map((hit) => hit.row.id),
  ]);
  if (trimmed === "")
    return <RecentSearches revision={revision} onPick={onPick} onError={onError} />;
  if (view === undefined)
    return (
      <p className="search-empty secondary" role="status">
        {text.playbackText.gettingYourLibraryReadyToSearch}
      </p>
    );
  const open = expanded?.query === view.query ? expanded.open : new Set<SearchKind | "lyrics">();
  const showAll = (key: SearchKind | "lyrics") =>
    setExpanded({ query: view.query, open: new Set([...open, key]) });
  const sections = searchSections(view, open);
  const play = (row: BrowseRow, index: number) => {
    if (row.unavailable) return onUnavailable();
    onPlay(index, row);
  };
  const openRow = (kind: SearchKind, row: BrowseRow) => {
    if (kind === "song") {
      const index = songs.findIndex((song) => song.id === row.id);
      if (index >= 0) play(row, index);
    } else onOpen({ kind, id: row.id });
  };
  const render = (section: SearchSection) => {
    if (section.type === "top") {
      const { kind, row } = section.result;
      return (
        <section key="top" className="search-section">
          <h2>{text.playbackText.topResult}</h2>
          <button
            className="search-top"
            data-testid="search-top"
            aria-label={[tagTitle(row.title, kind), kindLabel()[kind]].join(", ")}
            onDoubleClick={() => openRow(kind, row)}
            onClick={() => kind !== "song" && openRow(kind, row)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                openRow(kind, row);
              }
            }}
          >
            <span className={kind === "artist" ? "search-top-art artist-image" : "search-top-art"}>
              <Artwork large hash={row.artworkHash} artist={kind === "artist"} />
            </span>
            <span className="search-top-name">{tagTitle(row.title, kind)}</span>
            <span className="secondary">
              {[kindLabel()[kind], kind === "artist" ? "" : artistName(row.artist)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
        </section>
      );
    }
    const heading = (
      <h2>
        {section.type === "lyrics"
          ? text.playbackText.lyricsSearchSection
          : groupLabel()[section.kind]}
        {` · ${count(section.total)}`}
      </h2>
    );
    const more = (
      <More
        section={section}
        onShowAll={() => showAll(section.type === "lyrics" ? "lyrics" : section.kind)}
      />
    );
    if (section.type === "lyrics")
      return (
        <section key="lyrics" className="search-section" data-testid="search-lyrics">
          {heading}
          <div role="list">
            {section.hits.map((hit, i) => (
              <SongRow
                states={states}
                key={hit.row.id}
                testId="search-lyric"
                row={hit.row}
                subtitle={<LyricLine hit={hit} />}
                selected={selected === section.firstIndex + i}
                onSelect={() => setSelected(section.firstIndex + i)}
                onPlay={() => play(hit.row, section.firstIndex + i)}
                onMenu={(at) => onMenu(hit.row, at)}
              />
            ))}
          </div>
          {more}
        </section>
      );
    if (section.type === "songs")
      return (
        <section key="song" className="search-section" data-testid="search-songs">
          {heading}
          <div role="list">
            {section.rows.map((row, index) => (
              <SongRow
                states={states}
                key={row.id}
                testId="search-song"
                row={row}
                selected={selected === index}
                onSelect={() => setSelected(index)}
                onPlay={() => play(row, index)}
                onMenu={(at) => onMenu(row, at)}
              />
            ))}
          </div>
          {more}
        </section>
      );
    return (
      <section
        key={section.kind}
        className="search-section"
        data-testid={`search-shelf-${section.kind}`}
      >
        {heading}
        <div role="list" className="search-shelf">
          {section.rows.map((row) => (
            <button
              key={row.id}
              role="listitem"
              className="search-tile"
              aria-label={[tagTitle(row.title, section.kind), artistName(row.artist)]
                .filter(Boolean)
                .join(", ")}
              onClick={() => openRow(section.kind, row)}
            >
              <span className={section.kind === "artist" ? "artist-image" : undefined}>
                <Artwork large hash={row.artworkHash} artist={section.kind === "artist"} />
              </span>
              <span className="truncate">{tagTitle(row.title, section.kind)}</span>
              <span className="truncate secondary">
                {section.kind === "album" ? artistName(row.artist) : labels.songCount(row.count)}
              </span>
            </button>
          ))}
        </div>
        {more}
      </section>
    );
  };
  return (
    <>
      {sections.length === 0 ? (
        <p className="search-empty secondary" data-testid="search-nothing">
          {text.playbackText.nothingInYourLibraryMatchesValue(trimmed)}
        </p>
      ) : (
        sections.map(render)
      )}
    </>
  );
}
