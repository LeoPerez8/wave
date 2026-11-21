/**
 * The side panel (docs/spec-desktop.md, Window and layout): Lyrics and Queue as tabs on the
 * right of the window, toggled from the player bar, and Related beside them with YouTube Music on. It takes a grid column, so it pushes the
 * content instead of covering it.
 */
import { useState, type KeyboardEvent, type MouseEvent } from "react";

import type { BrowseRow } from "../../shared/browse.ts";
import type { UpNextPlace } from "@wave/core";
import type { PlaybackCommand, PlayerView } from "../../shared/playerView.ts";
import type { YtArtistCandidate } from "../../shared/ytPages.ts";
import { Icon } from "./Icon.tsx";
import { LyricsView, trackIdOf } from "./LyricsView.tsx";
import { panelTabs, shownPanelTab, stepPanelTab, type PanelTab } from "../../shared/panelTabs.ts";
import { QueuePanel } from "./QueuePanel.tsx";
import { RelatedPanel } from "./RelatedPanel.tsx";
import type { shuffleMenuEvents } from "./ShuffleKinds.tsx";
import { draggedSongs, type DraggedSongs } from "./songDrag.ts";
import { labels, text } from "./text.ts";
import type { GeniusAccess } from "./useSongGenius.ts";
import "./panel.css";

export type { PanelTab };

/** Which tab the panel shows, or null while it is closed; the bar's buttons toggle it. */
export function useSidePanel() {
  const [tab, setTab] = useState<PanelTab | null>(null);
  return {
    tab,
    show: setTab,
    /** The bar's Lyrics or Queue button: opens the panel on [next], or closes it there. */
    toggle: (next: PanelTab) => setTab((shown) => (shown === next ? null : next)),
  };
}

export function SidePanel({
  tab: asked,
  onTab,
  ytMusic,
  onArtist,
  onSongMenu,
  view,
  run,
  onError,
  hidden,
  onClose,
  geniusAccess,
  onGeniusSignIn,
  onSongDrop,
  shuffleMenu,
  notify,
}: {
  readonly tab: PanelTab;
  readonly onTab: (tab: PanelTab) => void;
  /** YouTube Music is on: the panel has its Related tab. */
  readonly ytMusic: boolean;
  /** Opens one of Related's similar artists. */
  readonly onArtist: (artist: YtArtistCandidate) => void;
  /** Opens the menu of one of Related's songs, or of a Queue row. */
  readonly onSongMenu: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
  readonly view: PlayerView | undefined;
  readonly run: (action: Promise<unknown>) => void;
  readonly onError: () => void;
  /** Now Playing covers it: out of reach until that closes. */
  readonly hidden: boolean;
  /** The panel's own close control, on every tab. */
  readonly onClose: () => void;
  readonly geniusAccess: GeniusAccess;
  readonly onGeniusSignIn: () => void;
  /** Songs dragged from a list and dropped in the Queue's Up Next [at]. */
  readonly onSongDrop?: (songs: DraggedSongs, at: UpNextPlace | undefined) => void;
  /** What opens the kinds of shuffle from the Queue's shuffle toggle. */
  readonly shuffleMenu?: ReturnType<typeof shuffleMenuEvents>;
  /** Shows a toast: the lyrics card's Save Image and Copy Image answers. */
  readonly notify: (message: string) => void;
}) {
  const tab = shownPanelTab(asked, ytMusic);
  const command = (next: PlaybackCommand) => run(window.wave.playback.command(next));
  const key = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = stepPanelTab(tab, step, ytMusic);
    onTab(next);
    document.getElementById(`panel-tab-${next}`)?.focus();
  };
  return (
    <aside className="side-panel" aria-label={labels.sidePanel} inert={hidden}>
      <div className="panel-head">
        <div className="panel-tabs" role="tablist" onKeyDown={key}>
          {panelTabs(ytMusic).map((name) => (
            <button
              key={name}
              id={`panel-tab-${name}`}
              role="tab"
              aria-selected={tab === name}
              aria-controls="panel-body"
              tabIndex={tab === name ? 0 : -1}
              onClick={() => onTab(name)}
              // Songs dragged over the Queue tab open it, to be dropped in Up Next.
              onDragOver={(event) => {
                if (name === "queue" && tab !== name && draggedSongs(event)) onTab(name);
              }}
            >
              {name === "related" ? text.playbackText.related : labels[name]}
            </button>
          ))}
        </div>
        <button
          className="icon-button panel-close"
          aria-label={labels.closeSidePanel}
          title={labels.closeSidePanel}
          onClick={onClose}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div
        id="panel-body"
        className="panel-body"
        role="tabpanel"
        aria-labelledby={`panel-tab-${tab}`}
      >
        {tab === "lyrics" ? (
          <LyricsView
            song={view?.current ?? null}
            positionMs={view?.status.positionMs ?? 0}
            onSeek={(positionMs) => run(window.wave.playback.seek(positionMs))}
            geniusAccess={geniusAccess}
            onGeniusSignIn={onGeniusSignIn}
            notify={notify}
            foreground={!hidden}
          />
        ) : tab === "related" ? (
          <RelatedPanel
            song={view?.current ? trackIdOf(view.current) : null}
            run={run}
            onArtist={onArtist}
            onSongMenu={onSongMenu}
          />
        ) : view === undefined ? null : (
          <QueuePanel
            view={view}
            command={command}
            onError={onError}
            onMenu={onSongMenu}
            onSongDrop={onSongDrop}
            shuffleMenu={shuffleMenu}
          />
        )}
      </div>
    </aside>
  );
}
