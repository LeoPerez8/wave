import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { BrowsePage, BrowseRow, BrowseScope } from "../../shared/browse.ts";
import { Icon } from "./Icon.tsx";
import { labels, text } from "./text.ts";

const SIZE = 100;
const HEIGHT = 40;
export const time = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const images = new Map<string, Promise<string | null>>();
export function Artwork({
  hash,
  artist = false,
  large = false,
}: {
  readonly hash?: string | null;
  readonly artist?: boolean;
  readonly large?: boolean;
}) {
  const [loaded, setLoaded] = useState<{ key: string; image: string | null }>();
  const imageKey = `${hash}-${large}`;
  const image = loaded?.key === imageKey ? loaded.image : null;
  useEffect(() => {
    let current = true;
    if (hash) {
      const key = `${hash}-${large}`;
      let read = images.get(key);
      if (!read) {
        read = window.wave.library.artwork(hash, large).catch(() => null);
        images.set(key, read);
      }
      if (images.size > 64) images.delete(images.keys().next().value!);
      void read.then((image) => {
        if (current) setLoaded({ key: `${hash}-${large}`, image });
      });
    }
    return () => {
      current = false;
    };
  }, [hash, large]);
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
}: {
  readonly scope: BrowseScope;
  readonly revision: number;
  readonly onOpen: (row: BrowseRow) => void;
  readonly onHero?: (row: BrowseRow | undefined) => void;
  readonly onError: () => void;
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
      } catch {
        if (current) onError();
      }
    };
    void read();
    return () => {
      current = false;
    };
  }, [scope, revision, firstPage, lastPage, onHero, onError]);
  const get = (index: number) => pages.get(Math.floor(index / SIZE))?.items[index % SIZE];
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
      move(await window.wave.library.letter(scope, letter));
      viewport.current?.parentElement?.focus();
    } catch {
      onError();
    }
  };
  const key = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: total - 1,
      PageDown: active + Math.max(1, Math.floor(height / HEIGHT)),
      PageUp: active - Math.max(1, Math.floor(height / HEIGHT)),
    };
    if (event.key in moves) {
      event.preventDefault();
      move(moves[event.key]!);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = get(active);
      if (row) onOpen(row);
    } else if (/^[a-z0-9]$/i.test(event.key) && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      void jump(event.key);
    }
  };
  return (
    <div
      className={`table-area ${songList ? "song-table" : "group-table"}`}
      role="grid"
      aria-label={
        typeof labels[scope.kind as keyof typeof labels] === "string"
          ? (labels[scope.kind as keyof typeof labels] as string)
          : labels.songs
      }
      aria-rowcount={total + 1}
      aria-colcount={5}
      tabIndex={0}
      aria-activedescendant={
        total && active >= start && active < end && get(active)
          ? `library-row-${active}`
          : undefined
      }
      onKeyDown={key}
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
        <span role="columnheader">{labels.time}</span>
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
            return (
              row && (
                <div
                  key={index}
                  id={`library-row-${index}`}
                  role="row"
                  aria-rowindex={index + 2}
                  aria-selected={selected === index}
                  aria-disabled={songList && (row.unavailable || row.path === null)}
                  className={`table-row table-columns ${active === index ? "active-row" : ""}`}
                  style={{ top: index * HEIGHT }}
                  onClick={() => {
                    setSelected(index);
                    setActive(index);
                    viewport.current!.parentElement!.focus();
                  }}
                  onDoubleClick={() => onOpen(row)}
                >
                  <div role="gridcell" className="title-cell">
                    <span className="row-picture">
                      {scope.kind === "album" ? (
                        <span className="track-number">{row.trackNumber ?? index + 1}</span>
                      ) : (
                        <Artwork hash={row.artworkHash} artist={scope.kind === "artists"} />
                      )}
                      <span className="row-play">
                        <Icon
                          name={
                            row.unavailable
                              ? "folder"
                              : songList && row.path === null
                                ? "missing"
                                : "play"
                          }
                          size={16}
                        />
                      </span>
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
                    {time(row.durationMs)}
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
