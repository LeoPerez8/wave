/**
 * The side panel (docs/spec-desktop.md, Window and layout): Lyrics and Queue as two tabs on the
 * right of the window, toggled from the player bar. It takes a grid column, so it pushes the
 * content instead of covering it.
 */
import { useState, type KeyboardEvent } from "react";

import type { PlaybackCommand, PlayerView } from "../../shared/playerView.ts";
import { LyricsView } from "./LyricsView.tsx";
import { QueuePanel } from "./QueuePanel.tsx";
import { labels } from "./text.ts";
import "./panel.css";

export type PanelTab = "lyrics" | "queue";

const TABS: readonly PanelTab[] = ["lyrics", "queue"];

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
  tab,
  onTab,
  view,
  run,
  onError,
  hidden,
}: {
  readonly tab: PanelTab;
  readonly onTab: (tab: PanelTab) => void;
  readonly view: PlayerView | undefined;
  readonly run: (action: Promise<unknown>) => void;
  readonly onError: () => void;
  /** Now Playing covers it: out of reach until that closes. */
  readonly hidden: boolean;
}) {
  const command = (next: PlaybackCommand) => run(window.wave.playback.command(next));
  const key = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]!;
    onTab(next);
    document.getElementById(`panel-tab-${next}`)?.focus();
  };
  return (
    <aside className="side-panel" aria-label={labels.sidePanel} inert={hidden}>
      <div className="panel-tabs" role="tablist" onKeyDown={key}>
        {TABS.map((name) => (
          <button
            key={name}
            id={`panel-tab-${name}`}
            role="tab"
            aria-selected={tab === name}
            aria-controls="panel-body"
            tabIndex={tab === name ? 0 : -1}
            onClick={() => onTab(name)}
          >
            {labels[name]}
          </button>
        ))}
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
          />
        ) : view === undefined ? null : (
          <QueuePanel view={view} command={command} onError={onError} />
        )}
      </div>
    </aside>
  );
}
