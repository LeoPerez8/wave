import {
  checkedTableRow,
  desktopKey,
  formatDuration,
  formatReleaseDate,
  libraryTableSortsFor,
  PLAYLIST_SONG_SORTS,
  playlistSongSortLabelFor,
  songSortHasSpine,
  songSortLabelFor,
  streamedCoverUrls,
  type AppLanguage,
  type DiscHead,
  type PlaylistSongSort,
  type SongSort,
  type SongSortKey,
} from "@wave/core";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  MAX_ROW_IDS_PAGE,
  type BrowsePage,
  type BrowseRow,
  type BrowseScope,
} from "../../shared/browse.ts";
import { Icon } from "./Icon.tsx";
import { pressOf } from "./keys.ts";
import { markClass, rowMark, SongMark, useSongStates } from "./SongMark.tsx";
import { labels, language, text, albumName, artistName, tagTitle } from "./text.ts";
import { tableColumns } from "../../shared/tableColumns.ts";
import { useTableSelection, type TableSelectionProps } from "./useTableSelection.ts";
import { TableSortHeader } from "./TableSortHeader.tsx";
import { findNoMatchFor } from "./FindField.tsx";
import { rowDrag } from "./SongActions.tsx";
import { songDragProps } from "./songDrag.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import { useRowReorder } from "./rowReorder.ts";
import "./tables.css";

const SIZE = 100;
const HEIGHT = 40;
const dateFormats = new Map<AppLanguage, Intl.DateTimeFormat>();
const rowDate = (date: number | undefined) => {
  if (date === undefined) return "";
  let format = dateFormats.get(language);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(language === "en" ? "en-US" : language, {
      dateStyle: "short",
    });
    dateFormats.set(language, format);
  }
  return format.format(date);
};
/** A song's or a list's length, "3:07" or "36:43:09": Core's, as the phone's. */
export const time = formatDuration;
const images = new Map<string, Promise<string | null>>();
/** A streamed cover at the largest size YouTube has (Core's `streamedCoverUrls`), else [url] itself. */
export const largestCover = async (url: string): Promise<string | null> => {
  for (const asked of [...streamedCoverUrls(url), url]) {
    const image = await window.wave.yt.artwork(asked).catch(() => null);
    if (image !== null) return image;
  }
  return null;
};
/**
 * A Library cover by its hash, a YouTube Music cover by its address (`url`), or a playlist's own
 * image ([playlist] with its [image] key, which changes whenever the image does). A [full] cover
 * (Now Playing) asks for a streamed song's cover at its largest, not the row's thumbnail.
 */
export function Artwork({
  hash,
  kind,
  id,
  url,
  playlist,
  image: playlistImage,
  artist = false,
  large = false,
  full = false,
}: {
  readonly hash?: string | null;
  readonly kind?: "song" | "album" | "artist" | undefined;
  readonly id?: number | undefined;
  readonly url?: string | null;
  readonly playlist?: number;
  readonly image?: string | null;
  readonly artist?: boolean;
  readonly large?: boolean;
  readonly full?: boolean;
}) {
  const [loaded, setLoaded] = useState<{ key: string; image: string | null }>();
  const own = playlist !== undefined && playlistImage ? playlist : undefined;
  const lookup = kind !== undefined && id !== undefined && id > 0 && (kind === "artist" || !hash);
  const imageKey =
    own !== undefined
      ? `playlist:${own}:${playlistImage}-${large}`
      : lookup
        ? `${kind}:${id}-${large}`
        : hash
          ? `${hash}-${large}`
          : url
            ? `url:${url}${full ? "-full" : ""}`
            : "";
  const image = loaded?.key === imageKey ? loaded.image : null;
  useEffect(() => {
    let current = true;
    if (imageKey !== "") {
      let read = images.get(imageKey);
      if (!read) {
        read = (
          own !== undefined
            ? window.wave.playlists.image(own, large)
            : lookup
              ? window.wave.library.cover(kind!, id!, large)
              : hash
                ? window.wave.library.artwork(hash, large)
                : full
                  ? largestCover(url!)
                  : window.wave.yt.artwork(url!)
        ).catch(() => null);
        images.set(imageKey, read);
        void read.then((value) => {
          if (value === null) images.delete(imageKey);
        });
      }
      if (images.size > 64) images.delete(images.keys().next().value!);
      void read.then((image) => {
        if (current) setLoaded({ key: imageKey, image });
      });
    }
    return () => {
      current = false;
    };
  }, [imageKey, own, hash, url, large, lookup, kind, id, full]);
  return (
    <span className={`artwork ${artist ? "artist-image" : ""}`}>
      {image ? <img src={image} alt="" /> : <Icon name={artist ? "artists" : "songs"} />}
    </span>
  );
}

export function VirtualTable({
  scope,
  revision,
  onOpen,
  onHero,
  onError,
  onMenu,
  onSort,
  onTotal,
  selection,
  onSelection,
  selectAll,
  preview,
  onPlace,
  onReorder,
}: TableSelectionProps & {
  readonly scope: BrowseScope;
  readonly revision: number;
  readonly onOpen: (row: BrowseRow, index: number) => void;
  readonly onHero?: (row: BrowseRow | undefined) => void;
  readonly onError: () => void;
  /** Opens [row]'s menu at [at] (right-click, Shift+F10 or the Menu key). */
  readonly onMenu?: (row: BrowseRow, at: { readonly x: number; readonly y: number }) => void;
  /** The order the table shows, each time it reads one: a playlist rearranges only in Custom. */
  readonly onSort?: (sort: BrowsePage["sort"]) => void;
  /** How many rows [scope] holds (those its Find finds), each time the table reads them. */
  readonly onTotal?: (listed: { readonly scope: BrowseScope; readonly total: number }) => void;
  readonly selectAll?: Parameters<typeof useTableSelection>[0]["selectAll"];
  /**
   * A playlist in its own order: its rows drag to a new place, and Alt+Up and Alt+Down move
   * the focused one. [target] goes before row ID [before], or to the end when it is null.
   */
  readonly onPlace?:
    ((target: SongTarget, before: number | null) => Promise<void> | void) | undefined;
  /** A bounded ranking uses these rows with the same table, focus and menus. */
  readonly preview?: {
    readonly id: string;
    readonly label: string;
    readonly page: BrowsePage;
    readonly trailing: (row: BrowseRow) => string;
    readonly trailingHeading: string;
    readonly ranked?: boolean;
  };
  /** Rows drag into place: [row] moves to place [to] (from 0). The Playlists list in Custom. */
  readonly onReorder?: ((row: BrowseRow, to: number) => void) | undefined;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<number, BrowsePage>());
  const [pages, setPages] = useState(new Map<number, BrowsePage>());
  const [total, setTotal] = useState(0);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [active, setActive] = useState(0);
  /** The focused row as of the last move, for keyboard moves that wait on the one before. */
  const focused = useRef(0);
  useLayoutEffect(() => {
    focused.current = active;
  }, [active]);
  /** Alt+arrow moves, one after another. */
  const keyMoves = useRef(Promise.resolve());
  const [ready, setReady] = useState(false);
  const [sort, setSort] = useState<SongSort | PlaylistSongSort>();
  const [changingSort, setChangingSort] = useState(false);
  /** An album's "Disc n" heads: each takes a row's height before its disc's first song. */
  const [discs, setDiscs] = useState<readonly DiscHead[]>([]);
  const [listSort, setListSort] = useState<BrowsePage["listSort"]>();
  const reorder = useRowReorder<BrowseRow>((row, to) => onReorder?.(row, to));
  const sortVersion = useRef(0);
  // A drag of this table's own rows to a new place: what it carries, where it started, and the
  // gap between rows it would land in.
  const [placing, setPlacing] = useState<{ readonly target: SongTarget; readonly from: number }>();
  const [dropAt, setDropAt] = useState<number>();
  /** The dragged row's page, kept while the drag scrolls far from it. */
  const heldPage = useRef<number>(undefined);
  const edge = useRef<{ speed: number; timer: number | undefined }>({ speed: 0, timer: undefined });
  /** Where row [index] sits, counting the heads before it. */
  const slotOf = (index: number) => index + discs.filter((head) => head.at <= index).length;
  const first = Math.floor(top / HEIGHT);
  // A row sits at most one slot per head below its index.
  const start = Math.max(0, first - 5 - discs.length);
  const end = Math.min(total, Math.max(0, first - 5) + Math.ceil(height / HEIGHT) + 10);
  const firstPage = Math.floor(start / SIZE);
  const lastPage = Math.floor(Math.max(start, end - 1) / SIZE);
  const songList = !["albums", "artists", "playlists", "genres"].includes(scope.kind);
  const columns = tableColumns(scope.kind);
  // A playlist's page offers that playlist's own sorts; the other tables share one per kind.
  const sorts: readonly (SongSort | PlaylistSongSort)[] = preview
    ? []
    : scope.kind === "playlist"
      ? PLAYLIST_SONG_SORTS
      : libraryTableSortsFor(scope.kind);
  const added = sorts.some(({ key }) => key === "added");
  const starred = sorts.some(({ key }) => key === "starred");
  const released = sorts.some(({ key }) => key === "releaseDate");
  // The leading "#": a playlist's own order, or an artist's Popular ranks.
  const ordered = sorts.find(({ key }) => key === "custom" || key === "popular")?.key;
  const spine =
    sort !== undefined &&
    scope.kind !== "playlist" &&
    sort.key !== "custom" &&
    sort.key !== "releaseDate" &&
    songSortHasSpine(sort as SongSort);
  const jumpByName =
    !preview &&
    !changingSort &&
    (spine || (scope.kind === "playlists" && (listSort === undefined || listSort === "name")));
  const emptyMessage =
    scope.find !== undefined
      ? (findNoMatchFor(scope.kind) ?? labels.noResults)
      : scope.kind in text.library.sectionEmpty
        ? text.library.sectionEmpty[scope.kind as keyof typeof text.library.sectionEmpty]
        : labels.noResults;
  const rowId = (index: number) => `${preview?.id ?? "library-row"}-${index}`;

  useEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    cache.current.clear();
  }, [scope, revision]);
  useEffect(() => {
    if (changingSort) return;
    let current = true;
    const read = async () => {
      try {
        const wanted = Array.from({ length: lastPage - firstPage + 1 }, (_, i) => firstPage + i);
        const results = await Promise.all(
          wanted.map(
            async (index) =>
              [
                index,
                preview?.page ??
                  cache.current.get(index) ??
                  (await window.wave.library.browse(scope, index * SIZE, SIZE)),
              ] as const,
          ),
        );
        if (!current) return;
        for (const [index, page] of results) cache.current.set(index, page);
        for (const index of cache.current.keys())
          if (Math.abs(index - firstPage) > 3 && index !== heldPage.current)
            cache.current.delete(index);
        setPages(new Map(cache.current));
        setTotal(results[0]![1].total);
        setDiscs(results[0]![1].discs ?? []);
        setReady(true);
        setSort(results[0]![1].sort);
        setListSort(results[0]![1].listSort);
        onSort?.(results[0]![1].sort);
        onTotal?.({ scope, total: results[0]![1].total });
        setActive((index) => Math.max(0, Math.min(index, results[0]![1].total - 1)));
        onHero?.(results[0]![1].hero);
        // Read both pages ahead so a quick scroll has time to fetch its next rows.
        const near = [firstPage - 1, lastPage + 1, lastPage + 2].filter(
          (index) => index >= 0 && index * SIZE < results[0]![1].total && !cache.current.has(index),
        );
        if (near.length === 0) return;
        const read = await Promise.all(
          near.map(
            async (index) =>
              [index, await window.wave.library.browse(scope, index * SIZE, SIZE)] as const,
          ),
        );
        if (!current) return;
        for (const [index, page] of read) cache.current.set(index, page);
        setPages(new Map(cache.current));
      } catch {
        if (current) onError();
      }
    };
    void read();
    return () => {
      current = false;
    };
  }, [
    scope,
    revision,
    firstPage,
    lastPage,
    onHero,
    onSort,
    onTotal,
    onError,
    preview,
    changingSort,
  ]);
  const get = (index: number) =>
    changingSort ? undefined : pages.get(Math.floor(index / SIZE))?.items[index % SIZE];
  // A new sort moves every row, so a Shift range starts over from the next click.
  const sortKey = sort?.key;
  const descending = sort?.descending;
  const order = useMemo(
    () => ({ list: preview ?? scope, sortKey, descending }),
    [preview, scope, sortKey, descending],
  );
  const rows = useTableSelection({
    selection,
    ...(onSelection ? { onSelection } : {}),
    ...(selectAll ? { selectAll } : {}),
    total,
    order,
    revision,
    onError,
    read: async (start, end, signal) => {
      if (preview) return preview.page.items.slice(start, end + 1).map((row) => row.id);
      const ids = new Set<number>();
      for (let at = start; at <= end && !signal.aborted;) {
        const page = get(at);
        if (page) {
          ids.add(page.id);
          at++;
          continue;
        }
        const limit = Math.min(end + 1 - at, MAX_ROW_IDS_PAGE);
        const { items: keys, total: readTotal } = await window.wave.library.rowIds(
          scope,
          at,
          limit,
        );
        if (readTotal !== total || keys.length !== limit)
          throw new Error("Table changed during selection");
        for (const id of keys) ids.add(id);
        at += limit;
      }
      return ids;
    },
  });
  const states = useSongStates(
    songList
      ? Array.from({ length: Math.max(0, end - start) }, (_, i) => get(start + i)?.id ?? 0)
      : [],
  );
  const move = (index: number) => {
    const next = Math.max(0, Math.min(total - 1, index));
    focused.current = next;
    setActive(next);
    const element = viewport.current!;
    const slot = slotOf(next);
    if (slot * HEIGHT < element.scrollTop) element.scrollTop = slot * HEIGHT;
    else if ((slot + 1) * HEIGHT > element.scrollTop + element.clientHeight)
      element.scrollTop = (slot + 1) * HEIGHT - element.clientHeight;
    setTop(element.scrollTop);
  };
  const stopEdgeScroll = () => {
    window.clearInterval(edge.current.timer);
    edge.current = { speed: 0, timer: undefined };
  };
  useEffect(() => stopEdgeScroll, []);
  /** Scrolls while a drag is held near the list's top or bottom, faster nearer the edge. */
  const edgeScroll = (y: number, span: number) => {
    const zone = HEIGHT * 1.5;
    const speed =
      y < zone
        ? -Math.ceil((zone - y) / 4)
        : y > span - zone
          ? Math.ceil((y - span + zone) / 4)
          : 0;
    edge.current.speed = speed;
    if (speed === 0) return stopEdgeScroll();
    if (edge.current.timer !== undefined) return;
    edge.current.timer = window.setInterval(() => {
      const element = viewport.current;
      if (element === null || edge.current.speed === 0) return stopEdgeScroll();
      element.scrollTop += edge.current.speed;
      setTop(element.scrollTop);
    }, 16);
  };
  const endPlacing = () => {
    heldPage.current = undefined;
    setPlacing(undefined);
    setDropAt(undefined);
    stopEdgeScroll();
  };
  /** Sends [target] before the row at [at] (the end past the last); false when it can't. */
  const placeAt = async (target: SongTarget, at: number): Promise<boolean> => {
    if (onPlace === undefined) return false;
    try {
      const before =
        at >= total
          ? null
          : (get(at)?.id ?? (await window.wave.library.rowIds(scope, at, 1)).items[0]);
      if (before === undefined) return false;
      void onPlace(target, before);
      return true;
    } catch {
      onError();
      return false;
    }
  };
  /** The gap between rows a drag at [event] is over, from 0 (above the first) to [total]. */
  const gapAt = (event: DragEvent) => {
    const element = viewport.current!;
    const y = event.clientY - element.getBoundingClientRect().top;
    return Math.max(0, Math.min(total, Math.round((y + element.scrollTop) / HEIGHT)));
  };
  const placeDrag = {
    onDragOver: (event: DragEvent) => {
      if (placing === undefined) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = viewport.current!.getBoundingClientRect();
      setDropAt(gapAt(event));
      edgeScroll(event.clientY - rect.top, rect.height);
    },
    onDragLeave: (event: DragEvent) => {
      const into = event.relatedTarget;
      if (into instanceof Node && event.currentTarget.contains(into)) return;
      setDropAt(undefined);
      stopEdgeScroll();
    },
    onDrop: (event: DragEvent) => {
      if (placing === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      const { target, from } = placing;
      const at = gapAt(event);
      endPlacing();
      // A row dropped next to itself stays where it is.
      const alone = "ids" in target && target.ids.length === 1;
      if (alone && (at === from || at === from + 1)) return;
      void placeAt(target, at);
    },
  };
  const jump = async (letter: string) => {
    const version = sortVersion.current;
    try {
      const position = await window.wave.library.letter(scope, letter);
      if (position === null || version !== sortVersion.current || !viewport.current) return;
      move(position);
      viewport.current.parentElement?.focus();
    } catch {
      onError();
    }
  };
  const sortBy = async (key: SongSortKey | PlaylistSongSort["key"]) => {
    const version = ++sortVersion.current;
    setChangingSort(true);
    try {
      await window.wave.library.sortBy(
        scope.kind,
        key,
        scope.kind === "playlist" ? scope.id : undefined,
      );
    } catch {
      onError();
    } finally {
      if (version === sortVersion.current && viewport.current) {
        cache.current.clear();
        setPages(new Map());
        setSort(undefined);
        viewport.current.scrollTop = 0;
        setTop(0);
        setActive(0);
        setChangingSort(false);
      }
    }
  };
  const heading = (
    key: SongSortKey | PlaylistSongSort["key"],
    label: string,
    className?: string,
    name?: string,
  ) => (
    <TableSortHeader
      label={label}
      name={name}
      className={className}
      direction={sort?.key === key ? (sort.descending ? "descending" : "ascending") : undefined}
      onSort={sorts.some((sort) => sort.key === key) ? () => void sortBy(key) : undefined}
    />
  );
  /** Opens the menu of row [index], at [at] or under the row. */
  const menu = (index: number, at?: { readonly x: number; readonly y: number }) => {
    const row = get(index);
    if (row === undefined || onMenu === undefined) return;
    const element = document.getElementById(rowId(index));
    const rect = element?.getBoundingClientRect();
    onMenu(row, at ?? { x: (rect?.left ?? 0) + 48, y: rect?.bottom ?? 0 });
  };
  const choose = (row: BrowseRow, index: number) => {
    if (selection?.checkboxes) rows.toggle(row.id);
    else onOpen(row, index);
  };
  const key = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (
      onPlace !== undefined &&
      event.altKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.metaKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      // Alt+Up and Alt+Down move the focused row, as in the Queue. Each waits for the move
      // before it and reads its rows from main: the pages shown may predate that move.
      event.preventDefault();
      const up = event.key === "ArrowUp";
      const step = async () => {
        const from = focused.current;
        if (up ? from === 0 : from >= total - 1) return;
        const at = up ? from - 1 : from + 2;
        const { items } = await window.wave.library.rowIds(scope, Math.min(from, at), 3);
        const id = items[up ? 1 : 0];
        const before = at >= total ? null : items[up ? 0 : 2];
        if (id === undefined || before === undefined) return;
        await onPlace({ scope, ids: [id] }, before);
        move(up ? from - 1 : from + 1);
      };
      keyMoves.current = keyMoves.current.then(step).catch(onError);
      return;
    }
    const page = Math.max(1, Math.floor(height / HEIGHT));
    const moves: Partial<Record<string, number>> = {
      rowDown: active + 1,
      rowUp: active - 1,
      firstRow: 0,
      lastRow: total - 1,
      pageDown: active + page,
      pageUp: active - page,
    };
    const command = desktopKey(pressOf(event), "list");
    if (command === undefined) return;
    if (rows.key(command, active, move)) {
      event.preventDefault();
      return;
    }
    const to = moves[command];
    if (to !== undefined) {
      event.preventDefault();
      move(to);
    } else if (command === "playRow") {
      event.preventDefault();
      const row = get(active);
      if (row) choose(row, active);
    } else if (command === "jump" && jumpByName) {
      event.preventDefault();
      void jump(event.key);
    } else if (command === "songMenu") {
      event.preventDefault();
      menu(active);
    }
  };
  /** A row's drag: onto a playlist or the Queue, and to a new place in a playlist's own order. */
  const rowDragProps = (row: BrowseRow, index: number) => {
    const drag = songDragProps(() => rowDrag({ selection }, scope, row));
    if (onPlace === undefined) return drag;
    return {
      ...drag,
      onDragStart: (event: DragEvent) => {
        drag.onDragStart(event);
        if (event.defaultPrevented) return;
        const what = rowDrag({ selection }, scope, row);
        if (what.kind !== "songs") return;
        event.dataTransfer.effectAllowed = "copyMove";
        heldPage.current = Math.floor(index / SIZE);
        setPlacing({ target: what.target, from: index });
      },
      onDragEnd: () => {
        drag.onDragEnd();
        endPlacing();
      },
    };
  };
  const contextMenu = (event: MouseEvent) => {
    event.preventDefault();
    const row = (event.target as Element).closest<HTMLElement>("[data-row]");
    if (row === null) return;
    const index = Number(row.dataset["row"]);
    const song = get(index);
    if (song) rows.point(song.id);
    setActive(index);
    viewport.current!.parentElement!.focus();
    menu(index, { x: event.clientX, y: event.clientY });
  };
  return (
    <div
      className={`table-area ${songList ? "song-table" : "group-table"} ${columns.third === null ? "no-third" : ""} ${columns.star ? "" : "no-star"} ${added ? "with-added" : ""} ${starred ? "with-starred" : ""} ${released ? "with-released" : ""} ${ordered ? "with-order" : ""}`}
      role="grid"
      aria-label={
        preview?.label ??
        (typeof labels[scope.kind as keyof typeof labels] === "string"
          ? (labels[scope.kind as keyof typeof labels] as string)
          : labels.songs)
      }
      aria-rowcount={total + discs.length + 1}
      aria-multiselectable={onSelection !== undefined ? true : undefined}
      aria-colcount={
        3 +
        (columns.third === null ? 0 : 1) +
        Number(columns.star) +
        Number(added) +
        Number(starred) +
        Number(released) +
        Number(ordered !== undefined)
      }
      tabIndex={0}
      aria-activedescendant={
        total && active >= start && active < end && get(active) ? rowId(active) : undefined
      }
      onKeyDown={key}
      onContextMenu={contextMenu}
    >
      <div className="table-head table-columns" role="row" aria-rowindex={1}>
        {ordered &&
          heading(
            ordered,
            text.desktopLibrary.orderColumn,
            "order-column",
            ordered === "custom" ? text.playlists.sorts.custom : text.library.songSorts.popular,
          )}
        {heading("title", text.desktopLibrary.titleColumn)}
        {columns.second === "artist" ? (
          heading("artist", text.desktopLibrary.artistColumn)
        ) : (
          <span role="columnheader">{labels.songs}</span>
        )}
        {columns.third === "album" &&
          heading("album", text.desktopLibrary.albumColumn, "album-column")}
        {columns.third === "artist" &&
          heading("artist", text.desktopLibrary.artistColumn, "album-column")}
        {added && heading("added", text.library.songSorts.added)}
        {starred && heading("starred", text.library.songSorts.starred)}
        {released && heading("releaseDate", text.desktopLibrary.releaseDateColumn)}
        {columns.star && (
          <span role="columnheader" className="star-column" aria-label={labels.favorite}>
            <Icon name="favorites" size={14} />
          </span>
        )}
        <span role="columnheader">{preview?.trailingHeading ?? labels.time}</span>
      </div>
      <div
        ref={viewport}
        className="table-viewport"
        role="rowgroup"
        onScroll={(event) => setTop(event.currentTarget.scrollTop)}
        {...(onPlace ? placeDrag : {})}
      >
        <div className="table-space" style={{ height: (total + discs.length) * HEIGHT }}>
          {discs.map(
            (head, index) =>
              head.at >= start &&
              head.at < end && (
                <div
                  key={`disc-${head.disc}-${head.at}`}
                  role="row"
                  className="disc-heading"
                  aria-rowindex={head.at + index + 2}
                  style={{ top: (head.at + index) * HEIGHT }}
                >
                  <span role="rowheader">{text.library.disc(head.disc)}</span>
                </div>
              ),
          )}
          {placing && dropAt !== undefined && (
            <div
              className="table-drop-line"
              aria-hidden="true"
              style={{ top: slotOf(dropAt) * HEIGHT }}
            />
          )}
          {[
            ...Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i),
            // The dragged row stays while the list scrolls away from it, or its drag would end.
            ...(placing && (placing.from < start || placing.from >= end) ? [placing.from] : []),
          ].map((index) => {
            const row = get(index);
            const mark = row && songList ? rowMark(row, states) : undefined;
            return (
              row && (
                <div
                  key={index}
                  id={rowId(index)}
                  role="row"
                  aria-rowindex={slotOf(index) + 2}
                  data-row={index}
                  aria-selected={
                    selection === undefined
                      ? rows.ordinary === row.id
                      : checkedTableRow(selection, row.id)
                  }
                  aria-disabled={row.unavailable}
                  className={`table-row table-columns ${active === index ? "active-row" : ""} ${mark ? markClass(mark) : ""} ${placing?.from === index ? "dragging" : ""} ${onReorder && reorder.dragging?.id === row.id ? "dragging" : ""} ${onReorder && reorder.over === index && reorder.dragging?.id !== row.id ? "drop-over" : ""}`}
                  style={{ top: slotOf(index) * HEIGHT }}
                  // A song row drags onto a playlist or the Queue; a ranking's rows only with selection.
                  {...(songList && (preview === undefined || onSelection !== undefined)
                    ? rowDragProps(row, index)
                    : {})}
                  {...(onReorder ? reorder.props(row, index) : {})}
                  onMouseDown={(event) => {
                    if (onSelection && event.shiftKey) event.preventDefault();
                  }}
                  onClick={(event) => {
                    setActive(index);
                    viewport.current!.parentElement!.focus();
                    rows.click(index, row.id, event);
                    if (preview?.ranked && selection === undefined) onOpen(row, index);
                  }}
                  onDoubleClick={(event) => {
                    if (
                      !selection?.checkboxes &&
                      !preview?.ranked &&
                      !event.shiftKey &&
                      !event.ctrlKey &&
                      !event.metaKey
                    )
                      onOpen(row, index);
                  }}
                >
                  {ordered && (
                    <div role="gridcell" className="order-column secondary">
                      {row.order}
                    </div>
                  )}
                  <div role="gridcell" className="title-cell">
                    {preview?.ranked && <span className="stats-rank secondary">{index + 1}</span>}
                    {selection?.checkboxes && (
                      <span
                        className="row-check"
                        role="checkbox"
                        aria-checked={checkedTableRow(selection, row.id)}
                        aria-label={text.desktopLibrary.checkSong(row.title)}
                      />
                    )}
                    <span className="row-picture">
                      {columns.picture === "trackNumber" ? (
                        <span className="track-number">{row.trackNumber ?? index + 1}</span>
                      ) : (
                        <Artwork
                          hash={row.artworkHash}
                          url={row.artworkUrl}
                          kind={
                            scope.kind === "artists"
                              ? "artist"
                              : scope.kind === "albums"
                                ? "album"
                                : songList
                                  ? "song"
                                  : undefined
                          }
                          id={row.id}
                          artist={scope.kind === "artists"}
                          {...(scope.kind === "playlists"
                            ? { playlist: row.id, image: row.imageKey ?? null }
                            : {})}
                        />
                      )}
                      <SongMark
                        mark={mark ?? { kind: row.unavailable ? "unavailable" : "play" }}
                        title={row.title}
                      />
                    </span>
                    <span className="truncate">{tagTitle(row.title, scope.kind)}</span>
                  </div>
                  <div role="gridcell" className="truncate secondary">
                    {songList
                      ? artistName(row.artist)
                      : preview?.ranked && row.id === 0
                        ? null
                        : row.collaborative
                          ? text.collaborativePage.libraryDetail(labels.songCount(row.count))
                          : labels.songCount(row.count)}
                  </div>
                  {columns.third !== null && (
                    <div role="gridcell" className="album-column truncate secondary">
                      {columns.third === "album" ? albumName(row.album) : artistName(row.artist)}
                    </div>
                  )}
                  {added && (
                    <div role="gridcell" className="table-date secondary">
                      {rowDate(row.addedAt)}
                    </div>
                  )}
                  {starred && (
                    <div role="gridcell" className="table-date secondary">
                      {rowDate(row.starredAt)}
                    </div>
                  )}
                  {released && (
                    <div role="gridcell" className="table-date truncate secondary">
                      {row.released && formatReleaseDate(row.released, language)}
                    </div>
                  )}
                  {columns.star && (
                    <div role="gridcell" className="star-column">
                      {row.favorite && <Icon name="favorites" size={14} />}
                    </div>
                  )}
                  <div role="gridcell" className="time-column secondary">
                    {preview ? preview.trailing(row) : time(row.durationMs)}
                  </div>
                </div>
              )
            );
          })}
        </div>
        {total === 0 && (
          <p className="empty" role="status">
            {ready ? emptyMessage : labels.loading}
          </p>
        )}
      </div>
      {sorts.length !== 0 && (
        <span className="sr-only" aria-live="polite">
          {sort &&
            (scope.kind === "playlist"
              ? playlistSongSortLabelFor(language)(sort as PlaylistSongSort)
              : songList
                ? songSortLabelFor(language)(sort as SongSort)
                : text.library.sortLabel(
                    text.desktopLibrary.titleColumn,
                    text.library.sortDirections[sort.descending ? "zToA" : "aToZ"],
                  ))}
        </span>
      )}
      {jumpByName && (
        <nav className="letter-spine" aria-label={labels.jump}>
          {Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ").map((letter) => (
            <button
              key={letter}
              tabIndex={-1}
              onClick={() => void jump(letter)}
              aria-label={`${labels.jump} ${letter}`}
            >
              {letter}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
