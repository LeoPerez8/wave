import { useState, type MouseEvent, type ReactNode } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { YtStatus } from "../../shared/yt.ts";
import { Icon } from "./Icon.tsx";
import { labels } from "./text.ts";
import { Artwork, time } from "./VirtualTable.tsx";

/**
 * The lists YouTube Music's pages share: the quiet line a page becomes offline or after a
 * failure, a list of song rows and a shelf of tiles.
 */

/** Offline or after a failure, one quiet line; nothing for YT Music off or a read that went well. */
export function YtQuiet({
  status,
  children,
}: {
  readonly status: YtStatus;
  readonly children?: ReactNode;
}) {
  if (status === "ok" || status === "disabled") return null;
  return (
    <p className="yt-quiet secondary" role="status" data-testid="yt-status">
      {status === "offline" ? labels.ytOffline : labels.ytFailed}
      {children}
    </p>
  );
}

/** Song rows: a click selects, a double click or Enter plays; [accessory] sits on the right. */
export function YtSongList({
  songs,
  label,
  onPlay,
  onMenu,
  accessory,
}: {
  readonly songs: readonly BrowseRow[];
  readonly label: string;
  readonly onPlay: (index: number) => void;
  readonly onMenu?: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
  readonly accessory?: (row: BrowseRow) => ReactNode;
}) {
  const [selected, setSelected] = useState<number>();
  return (
    <div role="list" aria-label={label} className="yt-list">
      {songs.map((row, index) => (
        <div key={`${row.videoId ?? row.id}-${index}`} className="yt-list-item">
          <button
            role="listitem"
            className="table-row table-columns yt-row"
            aria-selected={selected === index}
            aria-label={[row.title, row.artist].filter(Boolean).join(", ")}
            onClick={() => setSelected(index)}
            onDoubleClick={() => onPlay(index)}
            onContextMenu={
              onMenu &&
              ((event) => {
                event.preventDefault();
                setSelected(index);
                onMenu(row, event);
              })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onPlay(index);
              }
            }}
          >
            <span className="title-cell">
              <span className="row-picture">
                <Artwork hash={row.artworkHash} url={row.artworkUrl} />
                <span className="row-play">
                  <Icon name="play" size={16} />
                </span>
              </span>
              <span className="truncate">{row.title}</span>
            </span>
            <span className="truncate secondary">{row.artist}</span>
            <span className="album-column truncate secondary">{row.album}</span>
            <span className="star-column" />
            <span className="time-column secondary">
              {row.durationMs > 0 ? time(row.durationMs) : ""}
            </span>
          </button>
          {accessory?.(row)}
        </div>
      ))}
    </div>
  );
}

export interface TileItem {
  readonly key: string;
  readonly title: string;
  readonly caption?: string | null;
  readonly artworkUrl?: string | null;
  readonly artworkHash?: string | null;
  /** What a screen reader says, when the title alone doesn't say what a click does. */
  readonly label?: string;
}

/** A row of tiles that scrolls sideways; artists' tiles are round. */
export function Shelf({
  title,
  items,
  artists = false,
  onOpen,
}: {
  readonly title: string;
  readonly items: readonly TileItem[];
  readonly artists?: boolean;
  readonly onOpen: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="shelf" aria-label={title}>
      <h2>{title}</h2>
      <div className="shelf-row" role="list">
        {items.map((item, index) => (
          <button
            key={item.key}
            role="listitem"
            className="tile"
            aria-label={item.label ?? item.title}
            title={item.title}
            onClick={() => onOpen(index)}
          >
            <Artwork hash={item.artworkHash} url={item.artworkUrl} artist={artists} large />
            <span className="tile-title truncate">{item.title}</span>
            {item.caption && <span className="tile-caption truncate secondary">{item.caption}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
