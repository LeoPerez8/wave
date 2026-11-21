import { useState, type MouseEvent, type ReactNode } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { YtStatus } from "../../shared/yt.ts";
import { songRowMark } from "../../shared/songState.ts";
import { Icon } from "./Icon.tsx";
import { itemMenuEvents } from "./Menu.tsx";
import { listRowDrag, songDragProps } from "./songDrag.ts";
import { markClass, SongMark, useSongStates } from "./SongMark.tsx";
import { labels, albumName, artistName, text } from "./text.ts";
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
  ranked = 0,
  numbered = false,
}: {
  readonly songs: readonly BrowseRow[];
  readonly label: string;
  readonly onPlay: (index: number) => void;
  readonly onMenu?: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
  readonly accessory?: (row: BrowseRow) => ReactNode;
  /** How many of the first songs lead with their rank (1, 2, 3…) in place of the cover. */
  readonly ranked?: number;
  /** Each song leads with its track number in place of the cover (an album's tracklist). */
  readonly numbered?: boolean;
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
            aria-label={[row.title, artistName(row.artist)].filter(Boolean).join(", ")}
            {...songDragProps(() => listRowDrag(row))}
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
                {numbered ? (
                  <span className="track-number">{row.trackNumber}</span>
                ) : index < ranked ? (
                  <span className="row-rank secondary">{index + 1}</span>
                ) : (
                  <Artwork hash={row.artworkHash} url={row.artworkUrl} />
                )}
                <span className="row-play">
                  <Icon name="play" size={16} />
                </span>
              </span>
              <span className="truncate">{row.title}</span>
            </span>
            <span className="truncate secondary">{artistName(row.artist)}</span>
            <span className="album-column truncate secondary">{albumName(row.album)}</span>
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
  readonly artworkKind?: "song" | "album" | "artist" | undefined;
  readonly artworkId?: number | undefined;
  /** What a screen reader says, when the title alone doesn't say what a click does. */
  readonly label?: string;
  /** A song's tile names its song: it then shows the song's state, as its row does. */
  readonly song?: Pick<BrowseRow, "id" | "path" | "unavailable" | "videoId">;
}

/** A row of tiles that scrolls sideways; artists' tiles are round. */
export function Shelf({
  title,
  items,
  artists = false,
  nested = false,
  onOpen,
  onMenu,
  onSeeAll,
  onPlay,
}: {
  readonly title: string;
  readonly items: readonly TileItem[];
  readonly artists?: boolean;
  /** Its title is a level lower: a row of a section with its own title (Home's Discover). */
  readonly nested?: boolean;
  readonly onOpen: (index: number) => void;
  readonly onMenu?: (index: number, at: { readonly x: number; readonly y: number }) => void;
  /** Its heading's See all, opening the whole list (Home's shelves). */
  readonly onSeeAll?: () => void;
  /** A tile that opens a page gets a play glyph on its cover, which plays it without opening. */
  readonly onPlay?: (index: number) => void;
}) {
  const states = useSongStates(items.flatMap((item) => (item.song ? [item.song.id] : [])));
  if (items.length === 0) return null;
  const Heading = nested ? "h3" : "h2";
  const marks = items.map((item) =>
    item.song ? songRowMark(item.song, states.get(item.song.id)) : undefined,
  );
  return (
    <section className="shelf" aria-label={title}>
      {onSeeAll ? (
        <div className="stats-section-heading">
          <Heading>{title}</Heading>
          <button onClick={onSeeAll}>{text.home.seeAll}</button>
        </div>
      ) : (
        <Heading>{title}</Heading>
      )}
      <div className="shelf-row" role="list">
        {items.map((item, index) => (
          <div key={item.key} role="listitem" className={onPlay ? "tile-playable" : undefined}>
            <button
              className={`tile ${marks[index] ? markClass(marks[index]) : ""}`.trimEnd()}
              aria-label={item.label ?? item.title}
              title={item.title}
              onClick={() => onOpen(index)}
              {...(onMenu && itemMenuEvents((at) => onMenu(index, at)))}
            >
              <Artwork
                kind={item.artworkKind}
                id={item.artworkId}
                hash={item.artworkHash}
                url={item.artworkUrl}
                artist={artists}
                large
              />
              {marks[index] && marks[index].kind !== "play" && (
                <span className="tile-mark" data-testid="tile-mark">
                  <SongMark mark={marks[index]} title={item.title} />
                </span>
              )}
              <span className="tile-title truncate">{item.title}</span>
              {item.caption && (
                <span className="tile-caption truncate secondary">{item.caption}</span>
              )}
            </button>
            {onPlay && (
              <span className="tile-play-area">
                <button
                  className="tile-play"
                  aria-label={text.playbackText.playValue(item.title)}
                  title={text.playbackText.playValue(item.title)}
                  onClick={() => onPlay(index)}
                >
                  <Icon name="play" size={16} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
