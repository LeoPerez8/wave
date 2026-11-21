/**
 * The Queue tab: History, the playing song and Up Next, as on the phone. It is one tab stop with
 * roving focus; Enter or a double-click plays a row, Delete removes it, Alt+↑/↓ or a drag moves
 * an Up Next row. Songs dragged from a list drop into Up Next where they land. Rows load a page
 * at a time, so a queue of a whole Library stays quick.
 *
 * Above the list sit the shuffle and repeat toggles, the player bar's twins. Up Next's heading
 * counts its songs and, over a Magic Queue, names its seed; placeholder rows stand under it while
 * a batch loads, or a line says the batch came back empty. Scrolled away from the playing song,
 * a button brings it back.
 */
import { desktopKey, type UpNextPlace } from "@wave/core";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { Page } from "../../shared/bridge.ts";
import type { PlaybackCommand, PlayerView, QueueRow } from "../../shared/playerView.ts";
import { Icon } from "./Icon.tsx";
import { pressOf } from "./keys.ts";
import { nextRepeat, repeatLabel } from "./PlayerBar.tsx";
import { queueRowAt } from "./queueRows.ts";
import {
  playingOffView,
  queueSlots,
  slotOf,
  type MagicBatch,
  type QueueSlot,
} from "./queueSlots.ts";
import type { shuffleMenuEvents } from "./ShuffleKinds.tsx";
import { rovingTarget } from "./rovingList.ts";
import { useSongDrop, type DraggedSongs } from "./songDrag.ts";
import { labels, text, artistName } from "./text.ts";
import { Artwork, time } from "./VirtualTable.tsx";

const ROW = 48;
const SIZE = 100;
/** Rows drawn past each edge of the view. */
const OVERSCAN = 6;

/** How often the panel reads the Magic Queue again while its batch loads. */
const LOADING_POLL_MS = 1000;
const NO_BATCH: MagicBatch = { seed: null, status: "idle" };

/** What a slot other than a row says, [seed] naming the Magic Queue. */
const slotLabel = (
  slot: Exclude<QueueSlot, { kind: "row" | "placeholder" }>,
  seed: string | null,
): string => {
  const words = text.playbackText;
  if (slot.kind === "historyHead") return words.history;
  if (slot.kind === "nowPlayingHead") return words.nowPlaying;
  if (slot.kind === "upNext")
    return slot.seed === null ? words.upNext : words.magicQueueFrom(slot.seed);
  if (slot.note === "nothingUpNext") return words.nothingUpNext;
  return slot.note === "couldntLoad"
    ? words.couldntLoadRecommendations
    : words.noSongsFoundLikeValue(seed ?? "");
};

/** The Magic Queue's seed and how its next batch goes, read again as the queue changes. */
function useMagicBatch(revision: number): MagicBatch {
  const [batch, setBatch] = useState<MagicBatch>(NO_BATCH);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let current = true;
    window.wave.magicQueue
      .view()
      .then((view) => {
        if (current) setBatch({ seed: view.title, status: view.status });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [revision, tick]);
  const loading = batch.seed !== null && batch.status === "loading";
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setTick((n) => n + 1), LOADING_POLL_MS);
    return () => clearTimeout(timer);
  }, [loading, tick]);
  return batch;
}

export function QueuePanel({
  view,
  command,
  onError,
  onMenu,
  onSongDrop,
  shuffleMenu,
}: {
  readonly view: PlayerView;
  readonly command: (next: PlaybackCommand) => void;
  readonly onError: () => void;
  /** Opens a row's song menu (a right-click). */
  readonly onMenu?: ((row: QueueRow, event: MouseEvent<HTMLElement>) => void) | undefined;
  /** Songs dragged from a list, dropped in Up Next [at] (none: an empty queue takes them). */
  readonly onSongDrop?: ((songs: DraggedSongs, at: UpNextPlace | undefined) => void) | undefined;
  /** What opens the kinds of shuffle from the shuffle toggle (`shuffleMenuEvents`). */
  readonly shuffleMenu?: ReturnType<typeof shuffleMenuEvents> | undefined;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<{
    readonly revision: number;
    readonly pages: ReadonlyMap<number, Page<QueueRow>>;
  }>({ revision: -1, pages: new Map() });
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [active, setActive] = useState(view.index);
  const [dragging, setDragging] = useState<number>();
  const songDrop = useSongDrop<number | "top" | "end">();
  const { index, length, revision } = view;
  const batch = useMagicBatch(revision);
  const slots = queueSlots(index, length, batch);
  const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const last = Math.min(slots.length, Math.ceil((top + height) / ROW) + OVERSCAN);
  const firstPage = Math.floor(Math.max(0, first - 3) / SIZE);
  const lastPage = Math.floor(Math.max(0, Math.min(length - 1, last)) / SIZE);

  useEffect(() => {
    const element = list.current!;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The playing song is where the list opens, and where it goes when the song changes.
  const empty = length === 0;
  /** Scrolls [element] to the playing row, two rows under the top. */
  const showPlaying = (element: HTMLDivElement) => {
    element.scrollTop = Math.max(0, (slotOf(index, index) - 2) * ROW);
    setTop(element.scrollTop);
  };
  useEffect(() => {
    const element = list.current;
    if (element === null || empty) return;
    setActive(index);
    element.scrollTop = Math.max(0, (slotOf(index, index) - 2) * ROW);
    setTop(element.scrollTop);
  }, [index, empty]);
  const away = empty ? null : playingOffView(slotOf(index, index) * ROW, ROW, top, height);
  useEffect(() => {
    let current = true;
    const known = pages.revision === revision ? pages.pages : new Map<number, Page<QueueRow>>();
    const wanted: number[] = [];
    for (let page = firstPage; page <= lastPage; page++) if (!known.has(page)) wanted.push(page);
    if (wanted.length === 0 && pages.revision === revision) return;
    void Promise.all(
      wanted.map(
        async (page) => [page, await window.wave.playback.queue(page * SIZE, SIZE)] as const,
      ),
    )
      .then((loaded) => {
        if (!current) return;
        const next = new Map(known);
        for (const [page, rows] of loaded) next.set(page, rows);
        setPages({ revision, pages: next });
      })
      .catch(() => current && onError());
    return () => {
      current = false;
    };
  }, [revision, firstPage, lastPage, pages, onError]);

  const rowAt = (at: number): QueueRow | undefined => {
    if (pages.revision !== revision) return undefined;
    return queueRowAt(pages.pages, SIZE, at);
  };
  const keyAt = (at: number) => rowAt(at)?.key ?? null;
  const upNext = (at: number) => at > index && at < length;
  /** Moves Up Next row [from] to where row [to] is. */
  const move = (from: number, to: number) => {
    const key = keyAt(from);
    if (key === null || !upNext(from) || !upNext(to) || from === to) return;
    command(
      to > from
        ? { type: "move", key, after: keyAt(to), before: null }
        : { type: "move", key, after: to - 1 > index ? keyAt(to - 1) : null, before: keyAt(to) },
    );
    setActive(to);
  };
  const remove = (at: number) => {
    const key = keyAt(at);
    if (key === null || at === index) return;
    command({ type: "remove", key });
    setActive(Math.max(0, Math.min(at, length - 2)));
  };
  const play = (at: number) => {
    const key = keyAt(at);
    if (key !== null && at !== index) command({ type: "jumpTo", key });
  };
  const show = (at: number) => {
    const element = list.current!;
    const y = slotOf(at, index) * ROW;
    if (y < element.scrollTop + ROW) element.scrollTop = Math.max(0, y - ROW);
    else if (y + ROW > element.scrollTop + element.clientHeight)
      element.scrollTop = y + ROW - element.clientHeight;
    setTop(element.scrollTop);
  };
  const key = (event: KeyboardEvent) => {
    let handled = true;
    if (event.altKey && !event.ctrlKey && !event.shiftKey && event.key === "ArrowUp")
      move(active, active - 1);
    else if (event.altKey && !event.ctrlKey && !event.shiftKey && event.key === "ArrowDown")
      move(active, active + 1);
    else if (event.key === "Delete" || event.key === "Backspace") remove(active);
    else {
      const press = desktopKey(pressOf(event), "list");
      const to = rovingTarget(press, active, length, Math.floor(height / ROW) - 1);
      if (to !== undefined) {
        setActive(to);
        show(to);
      } else if (press === "playRow") play(active);
      else handled = false;
    }
    if (handled) event.preventDefault();
  };
  /** Where songs dropped on [on] go: before an Up Next row, at the top, or at the end. */
  const placeOf = (on: number | "top" | "end"): UpNextPlace | undefined => {
    if (length === 0) return undefined;
    if (on === "top") return { after: null, before: null };
    if (on === "end") return { after: length - 1 > index ? keyAt(length - 1) : null, before: null };
    return { after: on - 1 > index ? keyAt(on - 1) : null, before: keyAt(on) };
  };
  /** The drop events of [on], for songs dragged from a list. */
  const songDropProps = (on: number | "top" | "end", takes = true) => {
    const props = songDrop.props(
      on,
      (songs) => onSongDrop?.(songs, placeOf(on)),
      takes && onSongDrop !== undefined,
    );
    return {
      ...props,
      onDragOver: (event: DragEvent) => {
        props.onDragOver(event);
        // The row takes it, not the list around it.
        if (event.defaultPrevented) event.stopPropagation();
      },
    };
  };
  const drop = (at: number) => (event: DragEvent) => {
    event.preventDefault();
    if (dragging !== undefined) move(dragging, at);
    setDragging(undefined);
  };

  const drawn: ReactNode[] = [];
  for (let slot = first; slot < last; slot++) {
    const item = slots[slot];
    if (item === undefined) continue;
    const style = { top: slot * ROW };
    if (item.kind === "placeholder") {
      drawn.push(
        <div
          key={`slot-${slot}`}
          role="presentation"
          className="queue-placeholder"
          style={style}
          data-testid="queue-placeholder"
        >
          <span />
          <span>
            <span />
            <span />
          </span>
        </div>,
      );
      continue;
    }
    if (item.kind !== "row") {
      // History's heading leads the list when there is one.
      const history = index > 0 && slot === 0;
      drawn.push(
        <div
          key={`slot-${slot}`}
          role="presentation"
          className={item.kind === "note" ? "queue-note" : "queue-heading"}
          style={style}
          {...songDropProps("top", !history)}
        >
          <span className="truncate">{slotLabel(item, batch.seed)}</span>
          {item.kind === "upNext" && item.count > 0 && (
            <span className="queue-count secondary">{text.playbackText.songCount(item.count)}</span>
          )}
        </div>,
      );
      continue;
    }
    const { at } = item;
    const row = rowAt(at);
    const songTarget = songDropProps(at === index ? "top" : at, at >= index);
    const songOver = songDrop.over === (at === index ? "top" : at);
    drawn.push(
      <div
        key={`row-${at}`}
        id={`queue-row-${at}`}
        role="option"
        aria-selected={active === at}
        aria-current={at === index ? "true" : undefined}
        aria-label={row && `${row.title}, ${artistName(row.artist)}`}
        className={`queue-row ${at < index ? "history" : ""} ${at === index ? "playing" : ""} ${
          active === at ? "active-row" : ""
        } ${dragging === at ? "dragging" : ""} ${songOver ? "drop-over" : ""}`}
        style={style}
        draggable={row !== undefined && upNext(at)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          setDragging(at);
        }}
        onDragEnd={() => setDragging(undefined)}
        onDragOver={(event) => {
          if (dragging !== undefined && upNext(at)) event.preventDefault();
          else songTarget.onDragOver(event);
        }}
        onDragLeave={songTarget.onDragLeave}
        onDrop={(event) => {
          if (dragging !== undefined) drop(at)(event);
          else songTarget.onDrop(event);
        }}
        onClick={() => {
          setActive(at);
          list.current?.focus();
        }}
        onDoubleClick={() => play(at)}
        onContextMenu={(event) => {
          if (row === undefined || onMenu === undefined) return;
          event.preventDefault();
          setActive(at);
          onMenu(row, event);
        }}
      >
        {row && (
          <>
            <Artwork kind="song" id={row.id} hash={row.artworkHash} url={row.artworkUrl} />
            <span className="queue-text">
              <span className="truncate">{row.title}</span>
              <span className="truncate secondary">{artistName(row.artist)}</span>
            </span>
            <span className="queue-time secondary">{time(row.durationMs)}</span>
            {at !== index && (
              <button
                className="icon-button queue-remove"
                tabIndex={-1}
                aria-label={labels.removeFromQueue(row.title)}
                title={labels.removeFromQueue(row.title)}
                onClick={(event) => {
                  event.stopPropagation();
                  remove(at);
                }}
              >
                <Icon name="missing" size={14} />
              </button>
            )}
          </>
        )}
      </div>,
    );
  }

  return (
    <div className="queue-pane">
      <div className="queue-toggles">
        <button
          {...shuffleMenu}
          className="icon-button"
          aria-label={labels.shuffle}
          title={labels.shuffle}
          aria-pressed={view.shuffle}
          disabled={empty}
          onClick={() => command({ type: "setShuffle", on: !view.shuffle })}
        >
          <Icon name="shuffle" size={16} />
        </button>
        <button
          className="icon-button"
          aria-label={repeatLabel(view)}
          title={repeatLabel(view)}
          aria-pressed={view.repeat !== "off"}
          disabled={empty}
          onClick={() => command({ type: "setRepeat", mode: nextRepeat[view.repeat] })}
        >
          <Icon name="repeat" size={16} />
          {view.repeat === "one" && (
            <span className="icon-badge" aria-hidden="true">
              1
            </span>
          )}
        </button>
      </div>
      <div
        ref={list}
        className={`queue-list ${songDrop.over === "end" ? "drop-over" : ""}`}
        role="listbox"
        aria-label={labels.queue}
        aria-busy={slots.some((slot) => slot.kind === "placeholder") || undefined}
        tabIndex={0}
        aria-activedescendant={length > 0 && rowAt(active) ? `queue-row-${active}` : undefined}
        onKeyDown={key}
        onScroll={(event) => setTop(event.currentTarget.scrollTop)}
        {...songDropProps("end")}
      >
        <div className="queue-space" style={{ height: slots.length * ROW }}>
          {drawn}
        </div>
        {length === 0 && <p className="queue-note static">{text.playbackText.nothingUpNext}</p>}
      </div>
      {away !== null && (
        <button
          className="queue-back"
          aria-label={text.playbackText.backToCurrentSong}
          onClick={() => {
            showPlaying(list.current!);
            setActive(index);
          }}
        >
          <Icon name={away} size={14} />
          {text.playbackText.currentSong}
        </button>
      )}
    </div>
  );
}
