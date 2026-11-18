import { desktopKey } from "@wave/core";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { BrowsePage, BrowseRow, BrowseScope } from "../../shared/browse.ts";
import { Icon } from "./Icon.tsx";
import { pressOf } from "./keys.ts";
import { isChecked, toggled, type Selection } from "./SongActions.tsx";
import { markClass, rowMark, SongMark, useSongStates } from "./SongMark.tsx";
import { labels, text } from "./text.ts";

const SIZE = 100;
const HEIGHT = 40;
export const time = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const images = new Map<string, Promise<string | null>>();
/**
 * A Library cover by its hash, a YouTube Music cover by its address (`url`), or a playlist's own
 * image ([playlist] with its [image] key, which changes whenever the image does).
 */
export function Artwork({
  hash,
  url,
  playlist,
  image: playlistImage,
  artist = false,
  large = false,
}: {
  readonly hash?: string | null;
  readonly url?: string | null;
  readonly playlist?: number;
  readonly image?: string | null;
  readonly artist?: boolean;
  readonly large?: boolean;
}) {
  const [loaded, setLoaded] = useState<{ key: string; image: string | null }>();
  const own = playlist !== undefined && playlistImage ? playlist : undefined;
  const imageKey =
    own !== undefined
      ? `playlist:${own}:${playlistImage}-${large}`
      : hash
        ? `${hash}-${large}`
        : url
          ? `url:${url}`
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
            : hash
              ? window.wave.library.artwork(hash, large)
              : window.wave.yt.artwork(url!)
        ).catch(() => null);
        images.set(imageKey, read);
      }
      if (images.size > 64) images.delete(images.keys().next().value!);
      void read.then((image) => {
        if (current) setLoaded({ key: imageKey, image });
      });
    }
    return () => {
      current = false;
    };
  }, [imageKey, own, hash, url, large]);
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
  selection,
  onSelection,
  preview,
}: {
  readonly scope: BrowseScope;
  readonly revision: number;
  readonly onOpen: (row: BrowseRow, index: number) => void;
  readonly onHero?: (row: BrowseRow | undefined) => void;
  readonly onError: () => void;
  /** Opens [row]'s menu at [at] (right-click, Shift+F10 or the Menu key). */
  readonly onMenu?: (row: BrowseRow, at: { readonly x: number; readonly y: number }) => void;
  /** Selection mode's checked songs, while it is on. */
  readonly selection?: Selection | undefined;
  readonly onSelection?: (selection: Selection) => void;
  /** A bounded Home preview uses these rows with the same table, focus and menus. */
  readonly preview?: {
    readonly id: string;
    readonly label: string;
    readonly page: BrowsePage;
    readonly trailing: (row: BrowseRow) => string;
    readonly trailingHeading: string;
  };
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<number, BrowsePage>());
  const [pages, setPages] = useState(new Map<number, BrowsePage>());
  const [total, setTotal] = useState(0);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<number>();
  const [ready, setReady] = useState(false);
  const start = Math.max(0, Math.floor(top / HEIGHT) - 5);
  const end = Math.min(total, start + Math.ceil(height / HEIGHT) + 10);
  const firstPage = Math.floor(start / SIZE);
  const lastPage = Math.floor(Math.max(start, end - 1) / SIZE);
  const songList = !["albums", "artists", "playlists", "genres"].includes(scope.kind);
  const emptyMessage =
    scope.kind in text.library.sectionEmpty
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
          if (Math.abs(index - firstPage) > 3) cache.current.delete(index);
        setPages(new Map(cache.current));
        setTotal(results[0]![1].total);
        setReady(true);
        setActive((index) => Math.max(0, Math.min(index, results[0]![1].total - 1)));
        onHero?.(results[0]![1].hero);
        // Read the pages on either side too, so a scroll that crosses into one finds its rows
        // already here rather than drawing a gap while the read is on its way.
        const near = [firstPage - 1, lastPage + 1].filter(
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
  }, [scope, revision, firstPage, lastPage, onHero, onError, preview]);
  const get = (index: number) => pages.get(Math.floor(index / SIZE))?.items[index % SIZE];
  const states = useSongStates(
    songList
      ? Array.from({ length: Math.max(0, end - start) }, (_, i) => get(start + i)?.id ?? 0)
      : [],
  );
  const move = (index: number) => {
    const next = Math.max(0, Math.min(total - 1, index));
    setActive(next);
    const element = viewport.current!;
    if (next * HEIGHT < element.scrollTop) element.scrollTop = next * HEIGHT;
    else if ((next + 1) * HEIGHT > element.scrollTop + element.clientHeight)
      element.scrollTop = (next + 1) * HEIGHT - element.clientHeight;
    setTop(element.scrollTop);
  };
  const jump = async (letter: string) => {
    try {
      move(
        preview
          ? Math.max(
              0,
              preview.page.items.findIndex((row) =>
                row.title.toLocaleLowerCase().startsWith(letter.toLocaleLowerCase()),
              ),
            )
          : await window.wave.library.letter(scope, letter),
      );
      viewport.current?.parentElement?.focus();
    } catch {
      onError();
    }
  };
  /** Opens the menu of row [index], at [at] or under the row. */
  const menu = (index: number, at?: { readonly x: number; readonly y: number }) => {
    const row = get(index);
    if (row === undefined || onMenu === undefined || !songList) return;
    const element = document.getElementById(rowId(index));
    const rect = element?.getBoundingClientRect();
    onMenu(row, at ?? { x: (rect?.left ?? 0) + 48, y: rect?.bottom ?? 0 });
  };
  const choose = (row: BrowseRow, index: number) => {
    if (selection !== undefined && onSelection !== undefined)
      onSelection(toggled(selection, row.id));
    else onOpen(row, index);
  };
  const key = (event: KeyboardEvent) => {
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
    const to = moves[command];
    if (to !== undefined) {
      event.preventDefault();
      move(to);
    } else if (command === "playRow") {
      event.preventDefault();
      const row = get(active);
      if (row) choose(row, active);
    } else if (command === "jump") {
      event.preventDefault();
      void jump(event.key);
    } else if (command === "songMenu") {
      event.preventDefault();
      menu(active);
    }
  };
  const contextMenu = (event: MouseEvent) => {
    event.preventDefault();
    const row = (event.target as Element).closest<HTMLElement>("[data-row]");
    if (row === null) return;
    const index = Number(row.dataset["row"]);
    setSelected(index);
    setActive(index);
    viewport.current!.parentElement!.focus();
    menu(index, { x: event.clientX, y: event.clientY });
  };
  return (
    <div
      className={`table-area ${songList ? "song-table" : "group-table"}`}
      role="grid"
      aria-label={
        preview?.label ??
        (typeof labels[scope.kind as keyof typeof labels] === "string"
          ? (labels[scope.kind as keyof typeof labels] as string)
          : labels.songs)
      }
      aria-rowcount={total + 1}
      aria-colcount={5}
      tabIndex={0}
      aria-activedescendant={
        total && active >= start && active < end && get(active) ? rowId(active) : undefined
      }
      onKeyDown={key}
      onContextMenu={contextMenu}
    >
      <div className="table-head table-columns" role="row" aria-rowindex={1}>
        <span role="columnheader">{text.desktopLibrary.titleColumn}</span>
        <span role="columnheader">
          {songList ? text.desktopLibrary.artistColumn : labels.songs}
        </span>
        <span role="columnheader" className="album-column">
          {songList ? text.desktopLibrary.albumColumn : text.desktopLibrary.artistColumn}
        </span>
        <span role="columnheader" className="star-column" aria-label={labels.favorite}>
          <Icon name="favorites" size={14} />
        </span>
        <span role="columnheader">{preview?.trailingHeading ?? labels.time}</span>
      </div>
      <div
        ref={viewport}
        className="table-viewport"
        role="rowgroup"
        onScroll={(event) => setTop(event.currentTarget.scrollTop)}
      >
        <div className="table-space" style={{ height: total * HEIGHT }}>
          {Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i).map((index) => {
            const row = get(index);
            const mark = row && songList ? rowMark(row, states) : undefined;
            return (
              row && (
                <div
                  key={index}
                  id={rowId(index)}
                  role="row"
                  aria-rowindex={index + 2}
                  data-row={index}
                  aria-selected={
                    selection === undefined ? selected === index : isChecked(selection, row.id)
                  }
                  aria-disabled={songList && row.unavailable}
                  className={`table-row table-columns ${active === index ? "active-row" : ""} ${mark ? markClass(mark) : ""}`}
                  style={{ top: index * HEIGHT }}
                  onClick={() => {
                    setSelected(index);
                    setActive(index);
                    viewport.current!.parentElement!.focus();
                    if (selection !== undefined) choose(row, index);
                  }}
                  onDoubleClick={() => selection === undefined && onOpen(row, index)}
                >
                  <div role="gridcell" className="title-cell">
                    {selection !== undefined && (
                      <span
                        className="row-check"
                        role="checkbox"
                        aria-checked={isChecked(selection, row.id)}
                        aria-label={text.desktopLibrary.checkSong(row.title)}
                      />
                    )}
                    <span className="row-picture">
                      {scope.kind === "album" ? (
                        <span className="track-number">{row.trackNumber ?? index + 1}</span>
                      ) : (
                        <Artwork
                          hash={row.artworkHash}
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
                    <span className="truncate">{row.title}</span>
                  </div>
                  <div role="gridcell" className="truncate secondary">
                    {songList ? row.artist : labels.songCount(row.count)}
                  </div>
                  <div role="gridcell" className="album-column truncate secondary">
                    {row.album || (!songList ? row.artist : "")}
                  </div>
                  <div role="gridcell" className="star-column">
                    {row.favorite && <Icon name="favorites" size={14} />}
                  </div>
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
      {scope.kind === "songs" && (
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
