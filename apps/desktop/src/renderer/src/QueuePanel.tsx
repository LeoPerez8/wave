/**
 * The Queue tab: History, the playing song and Up Next, as on the phone. It is one tab stop with
 * roving focus; Enter or a double-click plays a row, Delete removes it, Alt+↑/↓ or a drag moves
 * an Up Next row. Rows load a page at a time, so a queue of a whole Library stays quick.
 */
import { desktopKey } from "@wave/core";
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
import { queueRowAt } from "./queueRows.ts";
import { rovingTarget } from "./rovingList.ts";
import { labels, text } from "./text.ts";
import { Artwork, time } from "./VirtualTable.tsx";

const ROW = 48;
const SIZE = 100;
/** Rows drawn past each edge of the view. */
const OVERSCAN = 6;

type Slot =
  | { readonly kind: "heading"; readonly label: string }
  | { readonly kind: "note"; readonly label: string }
  | { readonly kind: "row"; readonly at: number };

/** The list as drawn: History, Now Playing and Up Next, each under its heading. */
const slotsOf = (index: number, length: number): Slot[] => {
  if (length === 0) return [];
  const words = text.playbackText;
  const slots: Slot[] = [];
  if (index > 0) {
    slots.push({ kind: "heading", label: words.history });
    for (let at = 0; at < index; at++) slots.push({ kind: "row", at });
  }
  slots.push({ kind: "heading", label: words.nowPlaying }, { kind: "row", at: index });
  slots.push({ kind: "heading", label: words.upNext });
  if (index === length - 1) slots.push({ kind: "note", label: words.nothingUpNext });
  for (let at = index + 1; at < length; at++) slots.push({ kind: "row", at });
  return slots;
};

/** Where queue row [at] sits among the slots. */
const slotOf = (at: number, index: number) =>
  at + (index > 0 ? 1 : 0) + (at >= index ? 1 : 0) + (at > index ? 1 : 0);

export function QueuePanel({
  view,
  command,
  onError,
  onMenu,
}: {
  readonly view: PlayerView;
  readonly command: (next: PlaybackCommand) => void;
  readonly onError: () => void;
  /** Opens a row's song menu (a right-click). */
  readonly onMenu?: ((row: QueueRow, event: MouseEvent<HTMLElement>) => void) | undefined;
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
  const { index, length, revision } = view;
  const slots = slotsOf(index, length);
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
  useEffect(() => {
    const element = list.current;
    if (element === null || empty) return;
    setActive(index);
    element.scrollTop = Math.max(0, (slotOf(index, index) - 2) * ROW);
    setTop(element.scrollTop);
  }, [index, empty]);
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
    if (item.kind !== "row") {
      drawn.push(
        <div
          key={`slot-${slot}`}
          role="presentation"
          className={item.kind === "heading" ? "queue-heading" : "queue-note"}
          style={style}
        >
          {item.label}
        </div>,
      );
      continue;
    }
    const { at } = item;
    const row = rowAt(at);
    drawn.push(
      <div
        key={`row-${at}`}
        id={`queue-row-${at}`}
        role="option"
        aria-selected={active === at}
        aria-current={at === index ? "true" : undefined}
        aria-label={row && `${row.title}, ${row.artist}`}
        className={`queue-row ${at < index ? "history" : ""} ${at === index ? "playing" : ""} ${
          active === at ? "active-row" : ""
        } ${dragging === at ? "dragging" : ""}`}
        style={style}
        draggable={row !== undefined && upNext(at)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          setDragging(at);
        }}
        onDragEnd={() => setDragging(undefined)}
        onDragOver={(event) => {
          if (dragging !== undefined && upNext(at)) event.preventDefault();
        }}
        onDrop={drop(at)}
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
              <span className="truncate secondary">{row.artist}</span>
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
    <div
      ref={list}
      className="queue-list"
      role="listbox"
      aria-label={labels.queue}
      tabIndex={0}
      aria-activedescendant={length > 0 && rowAt(active) ? `queue-row-${active}` : undefined}
      onKeyDown={key}
      onScroll={(event) => setTop(event.currentTarget.scrollTop)}
    >
      <div className="queue-space" style={{ height: slots.length * ROW }}>
        {drawn}
      </div>
      {length === 0 && <p className="queue-note static">{text.playbackText.nothingUpNext}</p>}
    </div>
  );
}
