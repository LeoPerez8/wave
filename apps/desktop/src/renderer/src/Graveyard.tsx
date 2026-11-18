/**
 * A playlist's Graveyard: the songs removed from it by hand, newest first. Restore puts one back,
 * Remove from Graveyard forgets one, and Empty Graveyard forgets them all after a question.
 */
import { formatDate } from "@wave/core";
import { useEffect, useRef, useState } from "react";
import type { Page } from "../../shared/bridge.ts";
import type { GraveyardRow } from "../../shared/playlists.ts";
import { ConfirmDialog } from "./SongActions.tsx";
import { language, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";

const SIZE = 100;

export function Graveyard({
  playlistId,
  revision,
  changed,
  failed,
}: {
  readonly playlistId: number;
  /** Changes whenever the playlist may have. */
  readonly revision: number;
  readonly changed: () => void;
  readonly failed: (message?: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page<GraveyardRow>>();
  const [asking, setAsking] = useState(false);
  const report = useRef(failed);
  useEffect(() => {
    report.current = failed;
  });
  useEffect(() => {
    let current = true;
    void window.wave.playlists
      .graveyard(playlistId, offset, SIZE)
      .then((next) => {
        if (!current) return;
        // A page emptied by Restore or Remove goes back one.
        if (next.items.length === 0 && offset > 0) setOffset(Math.max(0, offset - SIZE));
        else setPage(next);
      })
      .catch(() => report.current());
    return () => {
      current = false;
    };
  }, [playlistId, offset, revision]);
  const strings = text.playlists;
  const act = (run: Promise<void>, problem?: string) =>
    void run.then(changed).catch(() => failed(problem));
  const rows = page?.items ?? [];
  return (
    <div className="graveyard">
      {rows.length > 0 && (
        <div className="graveyard-actions">
          <button className="destructive" onClick={() => setAsking(true)}>
            {strings.emptyGraveyard}
          </button>
        </div>
      )}
      <ul className="graveyard-list" aria-label={strings.graveyard}>
        {rows.map((row) => {
          const removed = strings.removedOn(
            formatDate(language, row.removedAt, { day: "numeric", month: "short" }),
          );
          return (
            <li key={row.itemId} className="graveyard-row">
              <Artwork hash={row.artworkHash} />
              <span className="graveyard-copy">
                <span className="truncate">{row.title}</span>
                <span className="secondary truncate">
                  {[row.artist, removed].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button
                onClick={() =>
                  act(window.wave.playlists.restore(playlistId, row.itemId), strings.couldntRestore)
                }
              >
                {strings.restore}
              </button>
              <button
                className="destructive"
                onClick={() =>
                  act(window.wave.playlists.forget(playlistId, row.itemId), strings.couldntForget)
                }
              >
                {strings.removeFromGraveyard}
              </button>
            </li>
          );
        })}
      </ul>
      {(page?.total ?? 0) > SIZE && (
        <div className="playlist-pager">
          <button disabled={offset === 0} onClick={() => setOffset((n) => n - SIZE)}>
            {text.desktopLibrary.previous}
          </button>
          <button
            disabled={offset + SIZE >= (page?.total ?? 0)}
            onClick={() => setOffset((n) => n + SIZE)}
          >
            {text.desktopLibrary.next}
          </button>
        </div>
      )}
      {asking && (
        <ConfirmDialog
          spec={{
            title: strings.emptyGraveyardQuestion,
            message: strings.emptyGraveyardMessage,
            action: { label: strings.emptyGraveyard, destructive: true },
          }}
          onChoose={(yes) => {
            setAsking(false);
            if (yes) act(window.wave.playlists.forget(playlistId), strings.couldntForget);
          }}
        />
      )}
    </div>
  );
}
