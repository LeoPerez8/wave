import { listDuration } from "@wave/core";
import type { MouseEvent } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import { mixTitle, playMix, useMixes } from "./Discover.tsx";
import { Icon } from "./Icon.tsx";
import { labels, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";
import { YtQuiet, YtSongList } from "./YtLists.tsx";
import { YtListDownloadButton } from "./YtListDownloadButton.tsx";
import "./discover.css";

type Run = (action: Promise<unknown>) => void;

/**
 * One of today's Discover mixes (docs/spec.md, Discover; the phone's mix page): its cover, its
 * name and artists, Play, Shuffle and Download (every song it streams, the progress in the head),
 * then its songs as main places them, its Library songs among the new ones (Core's
 * `placeDiscoverMixSongs`). A mix Home rebuilt away says it's gone, and nothing plays.
 */
export function DiscoverMixPage({
  id,
  run,
  onSongMenu,
  onError,
}: {
  readonly id: string;
  readonly run: Run;
  readonly onSongMenu: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
  /** Shows that the mix's download didn't start or stop. */
  readonly onError: (message: string) => void;
}) {
  const mixes = useMixes();
  if (mixes === undefined)
    return (
      <p className="yt-quiet secondary" role="status">
        {labels.loading}
      </p>
    );
  const mix = mixes.mixes.find((found) => found.id === id);
  if (mix === undefined)
    return mixes.status === "ok" || mixes.status === "disabled" ? (
      <div className="yt-page discover-mix-gone" data-testid="discover-mix" role="status">
        <h1>{text.discover.goneTitle}</h1>
        <p className="secondary">{text.discover.goneMessage}</p>
      </div>
    ) : (
      <div className="yt-page" data-testid="discover-mix">
        <YtQuiet status={mixes.status} />
      </div>
    );
  const title = mixTitle(mix);
  const songs = mix.songs.items;
  const first = songs[0];
  const length = listDuration(
    songs.reduce((sum, row) => sum + row.durationMs, 0),
    text.library,
  );
  return (
    <div className="yt-page" data-testid="discover-mix">
      <div className="hero">
        <Artwork
          url={mix.artworkUrl ?? first?.artworkUrl ?? null}
          hash={mix.artworkUrl === null ? (first?.artworkHash ?? null) : null}
          large
        />
        <div className="hero-copy">
          <h1>{title}</h1>
          {mix.artists && <p className="hero-artist">{mix.artists}</p>}
          <p className="hero-meta">
            {[labels.songCount(songs.length), length].filter(Boolean).join(" · ")}
          </p>
          {songs.length > 0 && (
            <div className="hero-actions">
              <button onClick={() => playMix(run, mix.id, 0)}>
                <Icon name="play" size={16} />
                {labels.play}
              </button>
              <button onClick={() => playMix(run, mix.id, 0, true)}>
                <Icon name="shuffle" size={16} />
                {labels.shuffle}
              </button>
              <YtListDownloadButton
                list={{ kind: "discoverMix", id: mix.id }}
                onError={() => onError(text.desktopLibrary.actionFailed)}
              />
            </div>
          )}
        </div>
      </div>
      <YtSongList
        songs={songs}
        label={title}
        onPlay={(index) => playMix(run, mix.id, index)}
        onMenu={onSongMenu}
      />
    </div>
  );
}
