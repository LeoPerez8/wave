import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { Page } from "../../shared/bridge.ts";
import type {
  DownloadGroupRow,
  DownloadMove,
  DownloadRow,
  DownloadsView,
  WaitingRow,
} from "../../shared/downloads.ts";
import { Icon } from "./Icon.tsx";
import { labels, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";

const ROW = 52;
const SIZE = 100;
/** Rows drawn past each edge of the view. */
const OVERSCAN = 6;

/** What is being dragged: a waiting song (its job id) or a group (its key). */
interface Dragged {
  readonly kind: "song" | "group";
  readonly from: string;
  readonly groupKey: string;
}

/** The rows read so far, for one state of the journal and of Show Songs. */
interface Loaded {
  readonly stamp: string;
  readonly total: number;
  readonly pages: ReadonlyMap<number, Page<DownloadRow>>;
}

/** A run's or a group's bar. */
function RunBar({ fraction }: { readonly fraction: number }) {
  return (
    <span className="run-bar" aria-hidden="true">
      <span style={{ width: `${Math.round(Math.min(1, fraction) * 1000) / 10}%` }} />
    </span>
  );
}

/**
 * The Downloads page, as the phone's (docs/spec.md › Downloads): the line counting the songs
 * downloading and waiting, the run's panel, then one virtual list of the songs downloading now,
 * each group's header over its waiting songs, and the failed section, folded until shown. A
 * group's header drags among the groups and a waiting song among its group's, by the mouse or
 * with Move Up and Move Down; the queue then downloads in the order shown. Rows load a page at
 * a time, so a queue of thousands stays quick.
 */
export function DownloadsPage({
  view,
  onError,
}: {
  readonly view: DownloadsView | undefined;
  readonly onError: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Loaded>({ stamp: "", total: 0, pages: new Map() });
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [failedShown, setFailedShown] = useState(false);
  /** Bumped after each action, so its result shows before the next read of the view. */
  const [acted, setActed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragged, setDragged] = useState<Dragged>();
  const [over, setOver] = useState<string>();

  const stamp = view === undefined ? "" : `${view.revision}:${failedShown}:${acted}`;
  const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const last = Math.min(loaded.total, Math.ceil((top + height) / ROW) + OVERSCAN);
  const firstPage = Math.floor(first / SIZE);
  const lastPage = Math.floor(Math.max(first, last - 1) / SIZE);

  useEffect(() => {
    const element = list.current!;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The rows on screen are read again when the journal changes; until they arrive the ones
  // already drawn stay, so a download's every step doesn't blank the list.
  useEffect(() => {
    if (stamp === "") return;
    let current = true;
    const known = loaded.stamp === stamp ? loaded.pages : new Map<number, Page<DownloadRow>>();
    const wanted: number[] = [];
    for (let page = firstPage; page <= lastPage; page++) if (!known.has(page)) wanted.push(page);
    if (wanted.length === 0) return;
    void Promise.all(
      wanted.map(
        async (page) =>
          [page, await window.wave.downloads.rows(page * SIZE, SIZE, failedShown)] as const,
      ),
    )
      .then((read) => {
        if (!current) return;
        const pages = new Map(known);
        for (const [page, rows] of read) pages.set(page, rows);
        setLoaded({ stamp, total: read[0]?.[1].total ?? loaded.total, pages });
      })
      .catch(() => current && onError());
    return () => {
      current = false;
    };
  }, [stamp, firstPage, lastPage, loaded, failedShown, onError]);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
    } catch {
      onError();
    } finally {
      setBusy(false);
      setActed((count) => count + 1);
    }
  };
  const move = (next: DownloadMove) => void act(() => window.wave.downloads.move(next));

  /** Whether the dragged song or group may drop on [row]: a song of its group, or another group. */
  const takes = (row: DownloadRow): row is WaitingRow | DownloadGroupRow => {
    if (dragged === undefined) return false;
    if (dragged.kind === "song")
      return row.kind === "waiting" && row.groupKey === dragged.groupKey && row.id !== dragged.from;
    return (row.kind === "waiting" || row.kind === "header") && row.groupKey !== dragged.from;
  };
  const dragProps = (row: WaitingRow | DownloadGroupRow) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      setDragged(
        row.kind === "waiting"
          ? { kind: "song", from: row.id, groupKey: row.groupKey }
          : { kind: "group", from: row.groupKey, groupKey: row.groupKey },
      );
    },
    onDragEnd: () => {
      setDragged(undefined);
      setOver(undefined);
    },
  });
  const dropProps = (row: DownloadRow) => ({
    onDragOver: (event: DragEvent) => {
      if (!takes(row)) return;
      event.preventDefault();
      setOver(row.key);
    },
    onDrop: (event: DragEvent) => {
      if (dragged === undefined || !takes(row)) return;
      event.preventDefault();
      move({
        kind: dragged.kind,
        from: dragged.from,
        to: dragged.kind === "song" && row.kind === "waiting" ? row.id : row.groupKey,
      });
      setDragged(undefined);
      setOver(undefined);
    },
  });
  /** Move Up and Move Down, for the keyboard and for screen readers. */
  const moveButtons = (
    kind: "song" | "group",
    from: string,
    row: WaitingRow | DownloadGroupRow,
  ) => (
    <span className="download-move">
      {([-1, 1] as const).map((step) => {
        const label = step === -1 ? text.settings.moveUp : text.settings.moveDown;
        const name = row.kind === "waiting" ? row.title : row.name;
        return (
          <button
            key={step}
            className="icon-button"
            aria-label={`${label}, ${name}`}
            title={label}
            disabled={busy || (step === -1 ? row.index === 0 : row.index === row.count - 1)}
            onClick={() => move({ kind, from, step })}
          >
            <Icon name={step === -1 ? "up" : "down"} size={14} />
          </button>
        );
      })}
    </span>
  );

  const drawn: ReactNode[] = [];
  for (let at = first; at < last; at++) {
    const row = loaded.pages.get(Math.floor(at / SIZE))?.items[at % SIZE];
    if (row === undefined) continue;
    const style = { top: at * ROW };
    const lifted =
      dragged !== undefined &&
      (dragged.kind === "song"
        ? row.kind === "waiting" && row.id === dragged.from
        : (row.kind === "waiting" || row.kind === "header") && row.groupKey === dragged.from);
    const state = `${lifted ? "dragging" : ""} ${over === row.key ? "drop-over" : ""}`;
    if ("name" in row) {
      const moves = row.kind === "header";
      drawn.push(
        <li
          key={row.key}
          className={`download-row download-group ${moves ? "movable" : ""} ${state}`}
          style={style}
          data-testid="download-group"
          data-group={row.groupKey}
          {...(moves ? dragProps(row) : {})}
          {...dropProps(row)}
        >
          <h3 className="truncate">{row.name}</h3>
          <span className="secondary tabular-nums">{row.line}</span>
          {moves && moveButtons("group", row.groupKey, row)}
          {row.fraction !== null && <RunBar fraction={row.fraction} />}
        </li>,
      );
      continue;
    }
    if (row.kind === "failedHeader") {
      drawn.push(
        <li
          key={row.key}
          className="download-row download-group failed-header"
          style={style}
          data-testid="failed-header"
        >
          <h3 className="truncate">{row.line}</h3>
          <button disabled={busy} onClick={() => void act(() => window.wave.downloads.retry())}>
            {text.settings.retryAll}
          </button>
          <button disabled={busy} onClick={() => void act(window.wave.downloads.clearFailed)}>
            {text.settings.clearAll}
          </button>
          <button
            aria-expanded={row.expanded}
            aria-label={
              row.expanded ? text.settings.hideFailedSongs : text.settings.showFailedSongs
            }
            onClick={() => setFailedShown(!row.expanded)}
          >
            {row.expanded ? text.settings.hideSongs : text.settings.showSongs}
          </button>
        </li>,
      );
      continue;
    }
    if (row.kind === "failedGroup") {
      const reason = (action: "retry" | "remove") =>
        void act(() => window.wave.downloads.failedReason(row.reason, action));
      drawn.push(
        <li
          key={row.key}
          className="download-row download-group"
          style={style}
          data-testid="failed-reason"
        >
          <h3 className="truncate tabular-nums">{row.line}</h3>
          <button
            aria-label={text.settings.retryLine(row.line)}
            disabled={busy}
            onClick={() => reason("retry")}
          >
            {text.settings.retry}
          </button>
          <button
            aria-label={text.settings.removeFailure(row.line)}
            disabled={busy}
            onClick={() => reason("remove")}
          >
            {text.settings.remove}
          </button>
        </li>,
      );
      continue;
    }
    const failed = row.kind === "failedSong";
    const waiting = row.kind === "waiting";
    const detail = failed && row.detail !== null ? row.detail : undefined;
    const cancel = row.cancel;
    drawn.push(
      <li
        key={row.key}
        className={`download-row ${waiting ? "movable" : ""} ${state}`}
        style={style}
        data-testid="download-row"
        data-kind={row.kind}
        {...(waiting ? dragProps(row) : {})}
        {...dropProps(row)}
      >
        <span className="row-picture">
          <Artwork url={row.artworkUrl} />
        </span>
        <span className="download-song">
          <span className="truncate">{row.title}</span>
          <span className="truncate secondary" title={detail}>
            {[row.artist, row.line, detail].filter(Boolean).join(" · ")}
          </span>
        </span>
        {waiting && moveButtons("song", row.id, row)}
        {failed && (
          <button
            aria-label={text.settings.retryLine(row.title)}
            disabled={busy}
            onClick={() => void act(() => window.wave.downloads.retry([row.id]))}
          >
            {text.settings.retry}
          </button>
        )}
        {cancel !== null && (
          <button
            aria-label={
              failed
                ? text.settings.removeFailure(row.title)
                : `${text.itemActions.labels.cancelDownload}, ${row.title}`
            }
            disabled={busy}
            onClick={() => void act(() => window.wave.downloads.cancel(cancel))}
          >
            {failed ? text.settings.remove : text.settings.cancel}
          </button>
        )}
      </li>,
    );
  }

  const missing = view?.missing;
  const panel = view?.panel ?? null;
  return (
    <div className="downloads-page" data-testid="downloads-page">
      {view?.online === false && (
        <p className="secondary downloads-note" role="status" data-testid="downloads-offline">
          {labels.downloadsOffline}
        </p>
      )}
      {missing?.line != null && (
        <div className="downloads-bar" data-testid="missing-songs">
          <span className="secondary">{missing.line}</span>
          {missing.actions.map((action) => (
            <button
              key={action}
              disabled={busy}
              onClick={() => void act(() => window.wave.downloads.missingAction(action))}
            >
              {text.settings.missingSongs[action]}
            </button>
          ))}
        </div>
      )}
      {missing?.notFound != null && <p className="secondary downloads-note">{missing.notFound}</p>}
      {(view?.summary != null || panel !== null || view?.pauseNotice != null) && (
        <section className="downloads-run" data-testid="downloads-run">
          <h2>{text.settings.downloading}</h2>
          {panel !== null && view?.run != null && (
            <div
              className="run-panel"
              role="progressbar"
              aria-label={text.settings.downloadedLine(panel.count, panel.line)}
              aria-valuemin={0}
              aria-valuemax={view.run.total}
              aria-valuenow={view.run.total - view.run.left}
            >
              <strong className="tabular-nums">{panel.count}</strong>
              <RunBar fraction={panel.fraction} />
              <span className="secondary tabular-nums">{panel.line}</span>
            </div>
          )}
          {view?.summary != null && (
            <p className="secondary tabular-nums" data-testid="downloads-summary">
              {view.summary}
            </p>
          )}
          {view?.pauseNotice != null && (
            <p className="tabular-nums" role="status" data-testid="downloads-paused">
              {view.pauseNotice}
            </p>
          )}
        </section>
      )}
      <div
        ref={list}
        className="downloads-scroll"
        onScroll={(event) => setTop(event.currentTarget.scrollTop)}
      >
        <ul
          className="downloads-list"
          aria-label={labels.downloads}
          style={{ height: loaded.total * ROW }}
        >
          {drawn}
        </ul>
        {loaded.stamp !== "" && loaded.total === 0 && (
          <p className="empty">{labels.nothingDownloading}</p>
        )}
      </div>
    </div>
  );
}
