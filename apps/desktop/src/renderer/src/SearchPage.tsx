import {
  checkedTableRow,
  desktopKey,
  formatNumber,
  tableSelectionOf,
  type CollectionKind,
  type SearchOnline,
} from "@wave/core";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { CollectionTarget } from "../../shared/collectionActions.ts";
import {
  searchSections,
  type LibrarySearchView,
  type LyricsHitView,
  type SearchExpansion,
  type SearchKind,
  type SearchSection,
} from "../../shared/search.ts";
import { Icon } from "./Icon.tsx";
import { OnlineLyrics, type OnlineLyricsProps } from "./OnlineLyrics.tsx";
import { itemMenuEvents, type MenuPoint } from "./Menu.tsx";
import { language, labels, text, albumName, artistName, tagTitle } from "./text.ts";
import type { SongState } from "../../shared/songState.ts";
import { markClass, rowMark, SongMark, useSongStates } from "./SongMark.tsx";
import { Artwork, time } from "./VirtualTable.tsx";
import { YtResults, type YtSearchLinks } from "./YtResults.tsx";
import {
  openTableSongMenu,
  rowDrag,
  SelectionBar,
  type SongSelectionControls,
} from "./SongActions.tsx";
import { songDragProps } from "./songDrag.ts";
import { useTableSelection, type TableSelectionProps } from "./useTableSelection.ts";
import { pressOf } from "./keys.ts";

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
  onKey,
  checkboxes,
  testId,
  states,
  drag,
}: {
  readonly states: ReadonlyMap<number, SongState>;
  /** Drags the row, or the checked rows with it, onto a playlist or the Queue. */
  readonly drag: Parameters<typeof songDragProps>[0];
  readonly row: BrowseRow;
  readonly subtitle?: ReactNode;
  readonly selected: boolean;
  readonly onSelect: (event: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">) => void;
  readonly onPlay: () => void;
  readonly onMenu: (at: { readonly x: number; readonly y: number }) => void;
  readonly onKey: (event: KeyboardEvent<HTMLButtonElement>) => boolean;
  readonly checkboxes: boolean;
  readonly testId: string;
}) {
  const mark = rowMark(row, states);
  return (
    <button
      role="option"
      className={`table-row table-columns search-row ${markClass(mark)}`}
      data-testid={testId}
      aria-selected={selected}
      aria-disabled={row.unavailable}
      aria-label={[row.title, artistName(row.artist)].filter(Boolean).join(", ")}
      {...songDragProps(drag)}
      onMouseDown={(event) => {
        if (event.shiftKey) event.preventDefault();
      }}
      onClick={(event) => {
        event.currentTarget.focus();
        onSelect(event);
      }}
      onDoubleClick={(event) => {
        if (!checkboxes && !event.shiftKey && !event.ctrlKey && !event.metaKey) onPlay();
      }}
      onKeyDown={(event) => {
        if (onKey(event)) {
          event.preventDefault();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          if (checkboxes) onSelect(event);
          else onPlay();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <span className="title-cell">
        {checkboxes && (
          <span
            className="row-check"
            role="checkbox"
            aria-checked={selected}
            aria-label={text.desktopLibrary.checkSong(row.title)}
          />
        )}
        <span className="row-picture">
          <Artwork kind="song" id={row.id} hash={row.artworkHash} />
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
  readonly selectionFor: (owner: string) => SongSelectionControls;
  /** The checked albums, artists, playlists or genres, which check with the songs. */
  readonly collectionSelection: (kind: CollectionKind) => TableSelectionProps;
  readonly onCollectionMenu: (target: CollectionTarget, title: string, at: MenuPoint) => void;
  /** A song on a drive that isn't connected was asked to play. */
  readonly onUnavailable: () => void;
  /** A recent search was picked. */
  readonly onPick: (query: string) => void;
  readonly onError: () => void;
  readonly ytMusic: boolean;
  readonly searchOnline: SearchOnline | undefined;
  readonly onYtPlay: (videoId: string) => void;
  readonly onYtDownload: (videoId: string) => void;
  /** Opens a YouTube Music result's song menu. */
  readonly onYtMenu?: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
  /** Where YouTube Music's artists, albums and song credits lead. */
  readonly ytLinks: YtSearchLinks;
  /** Search's online lyrics: the account's access, Sign In and a clicked hit. */
  readonly onlineLyrics: Pick<OnlineLyricsProps, "access" | "onSignIn" | "onOpen">;
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
        onMenu={props.onYtMenu}
        links={props.ytLinks}
      >
        <LibraryResults {...props} view={current} />
        <OnlineLyrics
          {...props.onlineLyrics}
          query={trimmed}
          ready={current !== undefined}
          shown={(current?.lyrics ?? []).map((hit) => hit.row)}
          namesSong={current?.namesSong ?? false}
          onError={onError}
        />
      </YtResults>
    </div>
  );
}

function LibraryResults({
  query,
  revision,
  onOpen,
  onPlay,
  selectionFor,
  collectionSelection,
  onCollectionMenu,
  onUnavailable,
  onPick,
  onError,
  view,
}: SearchPageProps & { readonly view: LibrarySearchView | undefined }) {
  const trimmed = query.trim();
  const [expanded, setExpanded] = useState<{ query: string; open: SearchExpansion }>();
  const scope = useMemo<BrowseScope>(() => ({ kind: "search", query: trimmed }), [trimmed]);
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
      const menu =
        kind === "song"
          ? undefined
          : itemMenuEvents((at) => onCollectionMenu({ kind, id: row.id }, row.title, at));
      return (
        <section key="top" className="search-section">
          <h2>{text.playbackText.topResult}</h2>
          <button
            className="search-top"
            data-testid="search-top"
            aria-label={[tagTitle(row.title, kind), kindLabel()[kind]].join(", ")}
            onDoubleClick={() => openRow(kind, row)}
            onClick={() => kind !== "song" && openRow(kind, row)}
            onContextMenu={menu?.onContextMenu}
            onKeyDown={(event) => {
              menu?.onKeyDown(event);
              if (event.key === "Enter") {
                event.preventDefault();
                openRow(kind, row);
              }
            }}
          >
            <span className={kind === "artist" ? "search-top-art artist-image" : "search-top-art"}>
              <Artwork
                large
                kind={kind === "song" || kind === "album" || kind === "artist" ? kind : undefined}
                id={row.id}
                hash={row.artworkHash}
                artist={kind === "artist"}
              />
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
    if (section.type === "lyrics" || section.type === "songs") {
      const key = section.type;
      return (
        <section
          key={key}
          className="search-section"
          data-testid={key === "lyrics" ? "search-lyrics" : "search-songs"}
        >
          {heading}
          <SearchSongList
            scope={scope}
            revision={revision}
            controls={selectionFor(`search-${key}:${trimmed}`)}
            rows={section.type === "lyrics" ? section.hits.map((hit) => hit.row) : section.rows}
            lyrics={section.type === "lyrics" ? section : undefined}
            songs={key === "lyrics" ? view.lyrics.map((hit) => hit.row) : songs}
            states={states}
            play={play}
            onError={onError}
          />
          {more}
        </section>
      );
    }
    const { kind } = section;
    return (
      <section
        key={section.kind}
        className="search-section"
        data-testid={`search-shelf-${section.kind}`}
      >
        {heading}
        <SearchShelf
          kind={kind}
          rows={section.rows}
          controls={kind === "song" ? {} : collectionSelection(kind)}
          order={view.query}
          revision={revision}
          onOpen={(row) => openRow(kind, row)}
          onMenu={
            kind === "song"
              ? undefined
              : (row, at) => onCollectionMenu({ kind, id: row.id }, row.title, at)
          }
          onError={onError}
        />
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

/** A shelf of tiles; Ctrl+click and Shift+click check them, and so does a click while selecting. */
function SearchShelf({
  kind,
  rows: items,
  controls,
  order,
  revision,
  onOpen,
  onMenu,
  onError,
}: {
  readonly kind: SearchKind;
  readonly rows: readonly BrowseRow[];
  readonly controls: TableSelectionProps;
  readonly order: string;
  readonly revision: number;
  readonly onOpen: (row: BrowseRow) => void;
  readonly onMenu: ((row: BrowseRow, at: MenuPoint) => void) | undefined;
  readonly onError: () => void;
}) {
  const { selection } = controls;
  const rows = useTableSelection({
    ...controls,
    total: items.length,
    order,
    revision,
    onError,
    read: (start, end) => items.slice(start, end + 1).map((row) => row.id),
  });
  return (
    <div role="list" className="search-shelf">
      {items.map((row, index) => {
        const checked = selection !== undefined && checkedTableRow(selection, row.id);
        return (
          <button
            key={row.id}
            role="listitem"
            className={checked ? "search-tile selected" : "search-tile"}
            aria-label={[tagTitle(row.title, kind), artistName(row.artist)]
              .filter(Boolean)
              .join(", ")}
            onClick={(event) => {
              const selecting =
                selection?.checkboxes || event.shiftKey || event.ctrlKey || event.metaKey;
              if (selecting && controls.onSelection) rows.click(index, row.id, event);
              else onOpen(row);
            }}
            {...(onMenu && itemMenuEvents((at) => onMenu(row, at)))}
          >
            <span className={kind === "artist" ? "artist-image" : undefined}>
              <Artwork
                large
                kind={kind === "song" || kind === "album" || kind === "artist" ? kind : undefined}
                id={row.id}
                hash={row.artworkHash}
                artist={kind === "artist"}
              />
            </span>
            <span className="truncate">{tagTitle(row.title, kind)}</span>
            <span className="truncate secondary">
              {kind === "album" ? artistName(row.artist) : labels.songCount(row.count)}
            </span>
            {(checked || selection?.checkboxes) && (
              <span
                className="row-check"
                role="checkbox"
                aria-checked={checked}
                aria-label={text.desktopLibrary.checkSong(row.title)}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function SearchSongList({
  scope,
  revision,
  controls,
  rows: items,
  lyrics,
  songs,
  states,
  play,
  onError,
}: {
  readonly scope: BrowseScope;
  readonly revision: number;
  readonly controls: SongSelectionControls;
  readonly rows: readonly BrowseRow[];
  readonly lyrics: Extract<SearchSection, { type: "lyrics" }> | undefined;
  readonly songs: readonly BrowseRow[];
  readonly states: ReadonlyMap<number, SongState>;
  readonly play: (row: BrowseRow, index: number) => void;
  readonly onError: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const { selection, onSelection, actions } = controls;
  const selectAll = () =>
    tableSelectionOf(
      songs.map((row) => row.id),
      selection?.checkboxes,
    );
  const rows = useTableSelection({
    ...controls,
    selectAll,
    total: items.length,
    order: scope.query,
    revision,
    onError,
    read: (start, end) => items.slice(start, end + 1).map((row) => row.id),
  });
  return (
    <>
      {selection && controls.bar !== false && (
        <SelectionBar
          scope={scope}
          revision={revision}
          selection={selection}
          actions={actions}
          onChange={(next) => onSelection?.(next)}
          onDone={() => onSelection?.(undefined)}
          selectAll={selectAll}
        />
      )}
      <div
        ref={list}
        role="listbox"
        aria-label={lyrics ? text.playbackText.lyricsSearchSection : text.playbackText.songs}
        aria-multiselectable="true"
      >
        {items.map((row, index) => (
          <SongRow
            states={states}
            key={row.id}
            testId={lyrics ? "search-lyric" : "search-song"}
            row={row}
            subtitle={lyrics && <LyricLine hit={lyrics.hits[index]!} />}
            selected={selection ? checkedTableRow(selection, row.id) : rows.ordinary === row.id}
            checkboxes={selection?.checkboxes === true}
            onSelect={(event) => rows.click(index, row.id, event)}
            drag={() => rowDrag(controls, scope, row)}
            onPlay={() => play(row, (lyrics?.firstIndex ?? 0) + index)}
            onKey={(event) => {
              const command = desktopKey(pressOf(event), "list");
              if (command === undefined) return false;
              if (command === "songMenu") {
                const rect = event.currentTarget.getBoundingClientRect();
                openTableSongMenu(controls, scope, row, { x: rect.left + 48, y: rect.bottom });
                return true;
              }
              const move = (next: number) => (list.current?.children[next] as HTMLElement)?.focus();
              if (rows.key(command, index, move)) return true;
              if (command === "rowUp" || command === "rowDown") {
                move(index + (command === "rowDown" ? 1 : -1));
                return true;
              }
              return false;
            }}
            onMenu={(at) => {
              rows.point(row.id);
              openTableSongMenu(controls, scope, row, at);
            }}
          />
        ))}
      </div>
    </>
  );
}
