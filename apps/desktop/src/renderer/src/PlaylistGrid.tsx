/**
 * The Playlists page as a grid of covers (the phone's Grid layout), in the list's order. A click
 * opens a playlist; right-click, Shift+F10 or the Menu key opens its menu; in Custom a cover drags
 * to another's place.
 */
import { useEffect, useState } from "react";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import { findNoMatchFor } from "./FindField.tsx";
import { itemMenuEvents, type MenuPoint } from "./Menu.tsx";
import { useRowReorder } from "./rowReorder.ts";
import { labels, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";

const PAGE = 200;

export function PlaylistGrid({
  revision,
  scope,
  onTotal,
  onOpen,
  onMenu,
  onReorder,
  onError,
}: {
  readonly revision: number;
  /** The Playlists list, with the page's Find when it has one. */
  readonly scope: BrowseScope;
  readonly onTotal?: (listed: { readonly scope: BrowseScope; readonly total: number }) => void;
  readonly onOpen: (row: BrowseRow) => void;
  readonly onMenu: (row: BrowseRow, at: MenuPoint) => void;
  /** In Custom: moves [row] to place [to] (from 0). */
  readonly onReorder?: ((row: BrowseRow, to: number) => void) | undefined;
  readonly onError: () => void;
}) {
  const [rows, setRows] = useState<readonly BrowseRow[]>();
  const reorder = useRowReorder<BrowseRow>((row, to) => onReorder?.(row, to));
  useEffect(() => {
    let current = true;
    const read = async () => {
      const read: BrowseRow[] = [];
      for (let total = 1; read.length < total;) {
        const page = await window.wave.library.browse(scope, read.length, PAGE);
        total = page.total;
        read.push(...page.items);
        if (page.items.length === 0) break;
      }
      if (!current) return;
      setRows(read);
      onTotal?.({ scope, total: read.length });
    };
    read().catch(() => {
      if (current) onError();
    });
    return () => {
      current = false;
    };
  }, [revision, scope, onTotal, onError]);
  if (rows === undefined) return <p className="empty secondary">{labels.loading}</p>;
  if (rows.length === 0)
    return (
      <p className="empty" role="status">
        {(scope.find !== undefined && findNoMatchFor("playlists")) ||
          text.library.sectionEmpty.playlists}
      </p>
    );
  return (
    <div className="playlist-grid" role="list" aria-label={labels.playlists}>
      {rows.map((row, index) => (
        <div key={row.id} role="listitem">
          <button
            className={`tile ${reorder.dragging?.id === row.id ? "dragging" : ""} ${
              reorder.over === index && reorder.dragging?.id !== row.id ? "drop-over" : ""
            }`}
            aria-label={row.title}
            title={row.title}
            onClick={() => onOpen(row)}
            {...itemMenuEvents((at) => onMenu(row, at))}
            {...(onReorder ? reorder.props(row, index) : {})}
          >
            <Artwork large hash={row.artworkHash} playlist={row.id} image={row.imageKey ?? null} />
            <span className="tile-title truncate">{row.title}</span>
            <span className="tile-caption truncate secondary">{labels.songCount(row.count)}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
