import {
  UNKNOWN_SONG_TITLE,
  desktopKey,
  formatTime,
  hasFindQuery,
  listeningHistoryReads,
  type ListeningHistoryReads,
} from "@wave/core";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { HistoryPage, HistoryRoute, HistoryRow } from "../../shared/history.ts";
import { HISTORY_ROW_HEIGHT, historyItems, historyWindow } from "./historyRows.ts";
import { Icon } from "./Icon.tsx";
import { pressOf } from "./keys.ts";
import type { MenuItem, MenuPoint } from "./Menu.tsx";
import { SongMark } from "./SongMark.tsx";
import { artistName, labels, language, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";
import "./history.css";

const EMPTY: HistoryPage = { rows: [], next: null, newer: null };
/** How long the play Go to This Moment opens at stays tinted. */
const MOMENT_TINT_MS = 3000;
/** How near an end of the rows read the view gets before the next page is asked for. */
const READ_AHEAD = 800;
/** How often the newest page is read again, for a play that just counted. */
const HEAD_EVERY_MS = 5000;
const FIND_DELAY_MS = 200;

/** A view's rows and where it was scrolled, kept while another view shows. */
interface Kept {
  readonly page: HistoryPage;
  readonly top: number;
}

function HistoryTable({
  query,
  around,
  kept,
  revision,
  keep,
  onPlay,
  onMenu,
}: {
  readonly query: string;
  /** The play the view opens centred on, tinted. */
  readonly around: number | undefined;
  readonly kept: Kept | undefined;
  readonly revision: number;
  readonly keep: (kept: Kept) => void;
  readonly onPlay: (play: HistoryRow) => void;
  readonly onMenu: (play: HistoryRow, at: MenuPoint) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const reads = useRef<ListeningHistoryReads>(undefined);
  // The rows with the time they were read at, which the day headers are told from.
  const [{ page, now }, setShown] = useState(() => ({
    page: kept?.page ?? EMPTY,
    now: Date.now(),
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [active, setActive] = useState<number>();
  const [tinted, setTinted] = useState(kept === undefined ? around : undefined);
  const shownIn = language;
  const { items, height: total } = useMemo(
    () => historyItems(page.rows, now, shownIn),
    [page, now, shownIn],
  );
  const { start, end } = historyWindow(items, top, height);
  const searching = hasFindQuery(query);

  useEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The view's own reads: one at a time, the newest page joined to the rows shown.
  const initial = useRef(page);
  useEffect(() => {
    const own = listeningHistoryReads<HistoryRow>({
      initial: initial.current,
      around,
      readPage: (from) => window.wave.history.page(from, query),
      onPage: (page) => setShown({ page, now: Date.now() }),
      onLoading: setLoading,
      onError: setError,
    });
    reads.current = own;
    own.request("refresh");
    const timer = setInterval(() => {
      if (!document.hidden) own.schedule("head", 0);
    }, HEAD_EVERY_MS);
    return () => {
      clearInterval(timer);
      own.stop();
    };
  }, [query, around]);
  // A scan, a removal or another play changed what the rows shown replay.
  const seen = useRef(revision);
  useEffect(() => {
    if (seen.current === revision) return;
    seen.current = revision;
    reads.current?.schedule("refresh", 1500);
  }, [revision]);

  // Rows that join above the ones in view (a new play, a moment's newer page) don't move them.
  const anchor = useRef<{ readonly id: number; readonly offset: number }>(undefined);
  const placed = useRef(false);
  const state = useRef({ page, top });
  const opening = useRef({ kept, around });
  useLayoutEffect(() => {
    const element = viewport.current!;
    const previous = state.current.page;
    const playLine = (id: number | undefined) =>
      items.find((item) => item.kind === "play" && item.play.id === id);
    if (!placed.current) {
      if (items.length === 0) return;
      placed.current = true;
      const moment = playLine(opening.current.around);
      if (opening.current.kept !== undefined) element.scrollTop = opening.current.kept.top;
      else if (moment !== undefined)
        element.scrollTop = moment.top - (element.clientHeight - HISTORY_ROW_HEIGHT) / 2;
    } else if (anchor.current !== undefined && (previous.newer !== null || element.scrollTop > 0)) {
      const line = playLine(anchor.current.id);
      if (line !== undefined) element.scrollTop = line.top - anchor.current.offset;
    }
    setTop(element.scrollTop);
  }, [items]);
  useLayoutEffect(() => {
    state.current = { page, top };
    const first = items.slice(start, end).find((item) => item.kind === "play" && item.top >= top);
    anchor.current =
      first?.kind === "play" ? { id: first.play.id, offset: first.top - top } : undefined;
  });
  useEffect(() => () => keep(state.current), [keep]);

  useEffect(() => {
    if (!placed.current) return;
    if (page.next !== null && total - (top + height) < READ_AHEAD) reads.current?.request("more");
    if (page.newer !== null && top < READ_AHEAD) reads.current?.request("newer");
  }, [page, total, top, height]);

  const momentShown = tinted !== undefined && page.rows.some(({ id }) => id === tinted);
  useEffect(() => {
    if (!momentShown) return;
    const timer = setTimeout(() => setTinted(undefined), MOMENT_TINT_MS);
    return () => clearTimeout(timer);
  }, [momentShown]);

  const rowId = (id: number) => `history-play-${id}`;
  const activeLine =
    active === undefined ? -1 : items.findIndex((item) => item.key === `play:${active}`);
  /** Makes the play at line [to] the active one, stepping over a day header towards [step]. */
  const move = (to: number, step: 1 | -1) => {
    let index = Math.max(0, Math.min(items.length - 1, to));
    while (items[index]?.kind === "day") index += step;
    const line = items[index] ?? items.findLast((item) => item.kind === "play");
    if (line?.kind !== "play") return;
    setActive(line.play.id);
    const element = viewport.current!;
    // A day's first play keeps its header in view.
    const header = items[items.indexOf(line) - 1];
    const above = header?.kind === "day" ? header.top : line.top;
    if (above < element.scrollTop) element.scrollTop = above;
    else if (line.top + HISTORY_ROW_HEIGHT > element.scrollTop + element.clientHeight)
      element.scrollTop = line.top + HISTORY_ROW_HEIGHT - element.clientHeight;
  };
  const key = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    const command = desktopKey(pressOf(event), "list");
    if (command === undefined) return;
    const rows = Math.max(1, Math.floor(height / HISTORY_ROW_HEIGHT));
    const moves: Partial<Record<string, readonly [number, 1 | -1]>> = {
      rowDown: [activeLine + 1, 1],
      rowUp: [activeLine - 1, -1],
      firstRow: [0, 1],
      lastRow: [items.length - 1, -1],
      pageDown: [activeLine + rows, 1],
      pageUp: [activeLine - rows, -1],
    };
    const to = moves[command];
    const line = items[activeLine];
    const play = line?.kind === "play" ? line.play : undefined;
    if (to !== undefined) {
      event.preventDefault();
      // Above the first play there is only its day header.
      move(Math.max(1, to[0]), to[1]);
    } else if (command === "playRow" && play !== undefined) {
      event.preventDefault();
      onPlay(play);
    } else if (command === "songMenu" && play !== undefined) {
      event.preventDefault();
      const rect = document.getElementById(rowId(play.id))?.getBoundingClientRect();
      onMenu(play, { x: (rect?.left ?? 0) + 48, y: rect?.bottom ?? 0 });
    }
  };
  const contextMenu = (event: MouseEvent) => {
    event.preventDefault();
    const row = (event.target as Element).closest<HTMLElement>("[data-play]");
    const play = page.rows.find(({ id }) => id === Number(row?.dataset["play"]));
    if (play === undefined) return;
    setActive(play.id);
    viewport.current!.parentElement!.focus();
    onMenu(play, { x: event.clientX, y: event.clientY });
  };

  return (
    <div
      className="table-area history-table"
      role="grid"
      aria-label={text.settings.pages.history}
      aria-colcount={3}
      aria-busy={loading}
      tabIndex={0}
      aria-activedescendant={
        activeLine >= start && activeLine < end && active !== undefined ? rowId(active) : undefined
      }
      onKeyDown={key}
      onContextMenu={contextMenu}
    >
      <div className="table-head table-columns" role="row">
        <span role="columnheader">{text.desktopLibrary.titleColumn}</span>
        <span role="columnheader">{text.desktopLibrary.artistColumn}</span>
        <span role="columnheader">{text.listeningHistory.timeColumn}</span>
      </div>
      <div
        ref={viewport}
        className="table-viewport"
        role="rowgroup"
        onScroll={(event) => setTop(event.currentTarget.scrollTop)}
      >
        <div className="table-space" style={{ height: total }}>
          {items.slice(start, end).map((item) => {
            if (item.kind === "day")
              return (
                <div key={item.key} className="history-day" role="row" style={{ top: item.top }}>
                  <h2 role="rowheader" aria-colspan={3}>
                    {item.title}
                  </h2>
                </div>
              );
            const { play } = item;
            const { song } = play;
            const title =
              song.title === UNKNOWN_SONG_TITLE ? text.listeningHistory.unknownSong : song.title;
            return (
              <div
                key={item.key}
                id={rowId(play.id)}
                role="row"
                data-play={play.id}
                aria-selected={active === play.id}
                aria-disabled={song.unavailable}
                className={`table-row table-columns ${active === play.id ? "active-row" : ""} ${tinted === play.id ? "history-moment" : ""}`}
                style={{ top: item.top }}
                onClick={() => {
                  setActive(play.id);
                  viewport.current!.parentElement!.focus();
                }}
                onDoubleClick={() => onPlay(play)}
              >
                <div role="gridcell" className="title-cell">
                  <span className="row-picture">
                    <Artwork
                      hash={song.artworkHash}
                      url={song.artworkUrl}
                      kind={song.id > 0 ? "song" : undefined}
                      id={song.id}
                    />
                    {play.replays !== null && (
                      <SongMark
                        mark={{
                          kind: song.unavailable
                            ? "unavailable"
                            : song.path === null && song.videoId === undefined
                              ? "missing"
                              : "play",
                        }}
                        title={title}
                      />
                    )}
                  </span>
                  <span className="truncate">{title}</span>
                </div>
                <div role="gridcell" className="truncate secondary">
                  {song.artist === "" ? "" : artistName(song.artist)}
                </div>
                <div role="gridcell" className="time-column secondary">
                  {formatTime(language, play.startedAt)}
                </div>
              </div>
            );
          })}
        </div>
        {error ? (
          <div className="home-retry" role="alert">
            <p>{text.listeningHistory.failed}</p>
            <button onClick={() => reads.current?.request("refresh")}>
              {text.listeningHistory.tryAgain}
            </button>
          </div>
        ) : (
          page.rows.length === 0 && (
            <p className="empty" role="status">
              {loading
                ? labels.loading
                : searching
                  ? text.library.noMatch.history
                  : text.listeningHistory.empty}
            </p>
          )
        )}
      </div>
    </div>
  );
}

/**
 * Listening History: every counted play, newest first under day headers, read in pages as the
 * table scrolls. The field searches the whole history; a result's menu has Go to This Moment,
 * which opens the history around that play (`route.at`) with its row tinted.
 */
export function ListeningHistory({
  route,
  revision,
  ytMusic,
  go,
  run,
  onMenu,
}: {
  readonly route: HistoryRoute;
  readonly revision: number;
  readonly ytMusic: boolean;
  readonly go: (route: HistoryRoute) => void;
  readonly run: (action: Promise<unknown>) => void;
  /** Opens the song's usual menu with [extra] entries, or [extra] alone for a song with none. */
  readonly onMenu: (row: BrowseRow, at: MenuPoint, extra: readonly MenuItem[]) => void;
}) {
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), typed === "" ? 0 : FIND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  const moment = route.at;
  const searching = moment === undefined && hasFindQuery(query);
  const view = moment !== undefined ? `at:${moment}` : searching ? `find:${query}` : "all";
  // The full history and the last search keep their rows and scroll while another view shows.
  const [kept] = useState(() => new Map<string, Kept>());
  const keep = useMemo(
    () => (state: Kept) => {
      if (view.startsWith("find:"))
        for (const other of kept.keys()) if (other.startsWith("find:")) kept.delete(other);
      kept.set(view, state);
    },
    [kept, view],
  );
  return (
    <div className="history-page">
      {moment === undefined && (
        <label className="history-find">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={typed}
            placeholder={text.library.find.history}
            aria-label={text.library.find.history}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && typed !== "") {
                event.stopPropagation();
                setTyped("");
              }
            }}
          />
        </label>
      )}
      <HistoryTable
        key={`${view}:${ytMusic}`}
        query={searching ? query : ""}
        around={moment}
        kept={kept.get(view)}
        revision={revision}
        keep={keep}
        onPlay={(play) => {
          if (play.replays !== null) run(window.wave.history.play(play.id));
        }}
        onMenu={(play, at) =>
          onMenu(
            play.song,
            at,
            searching
              ? [
                  {
                    key: "goToMoment",
                    label: text.listeningHistory.goToMoment,
                    run: () => go({ kind: "history", at: play.id }),
                  },
                ]
              : [],
          )
        }
      />
    </div>
  );
}
