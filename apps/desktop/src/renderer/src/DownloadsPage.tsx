import { ytDownloadLine } from "@wave/core";
import { useEffect, useState } from "react";
import type { Page } from "../../shared/bridge.ts";
import type { DownloadRow, DownloadsView } from "../../shared/downloads.ts";
import { labels, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";

const PAGE_SIZE = 100;

/**
 * The Downloads page: the songs on their way and the ones that failed, the missing songs'
 * Download All, and a note while downloads pause offline.
 */
export function DownloadsPage({
  view,
  onError,
}: {
  readonly view: DownloadsView | undefined;
  readonly onError: () => void;
}) {
  const [rows, setRows] = useState<Page<DownloadRow>>();
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void window.wave.downloads
      .rows(offset, PAGE_SIZE)
      .then((page) => {
        if (live) setRows(page);
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [view, offset, onError]);
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
    } catch {
      onError();
    } finally {
      setBusy(false);
    }
  };
  const missing = view?.missing;
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
      {(view?.failed ?? 0) > 0 && (
        <div className="downloads-bar">
          <span className="secondary">{text.downloadStatus.failedSongs(view!.failed)}</span>
          <button disabled={busy} onClick={() => void act(() => window.wave.downloads.retry())}>
            {text.settings.retryAll}
          </button>
          <button disabled={busy} onClick={() => void act(window.wave.downloads.clearFailed)}>
            {text.settings.clearAll}
          </button>
        </div>
      )}
      {rows !== undefined && rows.total === 0 ? (
        <p className="empty">{labels.nothingDownloading}</p>
      ) : (
        <ul className="downloads-list" aria-label={labels.downloads}>
          {rows?.items.map((row) => {
            const failed = row.status.kind === "failed";
            return (
              <li key={row.id} className="download-row" data-testid="download-row">
                <span className="row-picture">
                  <Artwork url={row.artworkUrl} />
                </span>
                <span className="download-song">
                  <span className="truncate">{row.title}</span>
                  <span className="truncate secondary">
                    {[row.artist, ytDownloadLine(row.status, text)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {failed && (
                  <button
                    aria-label={text.settings.retryLine(row.title)}
                    disabled={busy}
                    onClick={() => void act(() => window.wave.downloads.retry([row.id]))}
                  >
                    {text.settings.retry}
                  </button>
                )}
                <button
                  aria-label={
                    failed
                      ? text.settings.removeFailure(row.title)
                      : `${text.itemActions.labels.cancelDownload}, ${row.title}`
                  }
                  disabled={busy}
                  onClick={() => void act(() => window.wave.downloads.cancel([row.id]))}
                >
                  {failed ? text.settings.remove : text.settings.cancel}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows !== undefined && rows.total > PAGE_SIZE && (
        <div className="downloads-bar">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            {text.desktopLibrary.previous}
          </button>
          <span className="secondary tabular-nums">
            {text.desktopLibrary.page(offset + 1, offset + rows.items.length, rows.total)}
          </span>
          <button
            disabled={offset + rows.items.length >= rows.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            {text.desktopLibrary.next}
          </button>
        </div>
      )}
    </div>
  );
}
