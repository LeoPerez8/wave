/**
 * A playlist's Graveyard: the songs removed from it by hand, newest first. A double-click or
 * Enter plays one (without restoring it) and its menu is the song's own, with Restore and Remove
 * from Graveyard. Restore puts one back, Remove from Graveyard forgets one, and Empty Graveyard
 * forgets them all after a question.
 */
import { desktopKey, formatDate } from "@wave/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Page } from "../../shared/bridge.ts";
import type { GraveyardRow } from "../../shared/playlists.ts";
import { pressOf } from "./keys.ts";
import { itemMenuEvents, type MenuItem, type MenuPoint } from "./Menu.tsx";
import { ConfirmDialog } from "./SongActions.tsx";
import { artistName, language, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";

const SIZE = 100;

export function Graveyard({
  playlistId,
  revision,
  changed,
  failed,
  onPlay,
  onMenu,
}: {
  readonly playlistId: number;
  /** Changes whenever the playlist may have. */
  readonly revision: number;
  readonly changed: () => void;
  readonly failed: (message?: string) => void;
  /** Plays the Graveyard from [row]'s song. */
  readonly onPlay: (row: GraveyardRow) => void;
  /** Opens [row]'s song menu at [at], with [extra] (Restore, Remove from Graveyard) after it. */
  readonly onMenu: (row: GraveyardRow, at: MenuPoint, extra: readonly MenuItem[]) => void;
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
  const restore = (row: GraveyardRow) =>
    act(window.wave.playlists.restore(playlistId, row.itemId), strings.couldntRestore);
  const forget = (row: GraveyardRow) =>
    act(window.wave.playlists.forget(playlistId, row.itemId), strings.couldntForget);
  const menuOf = (row: GraveyardRow) =>
    itemMenuEvents((at) =>
      onMenu(row, at, [
        { key: "restoreGraveyard", label: strings.restore, run: () => restore(row) },
        {
          key: "forgetGraveyard",
          label: strings.removeFromGraveyard,
          destructive: true,
          run: () => forget(row),
        },
      ]),
    );
  /** Enter plays the row, the menu keys open its menu, and ↑/↓ move between rows. */
  const rowKey = (row: GraveyardRow, event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target !== event.currentTarget) return;
    const command = desktopKey(pressOf(event), "list");
    if (command === "playRow") {
      event.preventDefault();
      onPlay(row);
    } else if (command === "rowDown" || command === "rowUp") {
      event.preventDefault();
      const next =
        command === "rowDown"
          ? event.currentTarget.nextElementSibling
          : event.currentTarget.previousElementSibling;
      if (next instanceof HTMLElement) next.focus();
    } else menuOf(row).onKeyDown(event);
  };
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
          const menu = menuOf(row);
          return (
            <li
              key={row.itemId}
              className="graveyard-row"
              tabIndex={0}
              aria-label={[row.title, artistName(row.artist), removed].filter(Boolean).join(", ")}
              onDoubleClick={(event) => {
                // A double-click on Restore or Remove is two clicks on it, not a play.
                if ((event.target as Element).closest("button") === null) onPlay(row);
              }}
              onKeyDown={(event) => rowKey(row, event)}
              onContextMenu={menu.onContextMenu}
            >
              <Artwork hash={row.artworkHash} />
              <span className="graveyard-copy">
                <span className="truncate">{row.title}</span>
                <span className="secondary truncate">
                  {[artistName(row.artist), removed].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button onClick={() => restore(row)}>{strings.restore}</button>
              <button className="destructive" onClick={() => forget(row)}>
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
