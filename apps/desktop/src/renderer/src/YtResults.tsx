import { useEffect, useState } from "react";
import type { YtSearchPage } from "../../shared/yt.ts";
import { Icon } from "./Icon.tsx";
import { labels, text } from "./text.ts";
import { Artwork, time } from "./VirtualTable.tsx";

/** How long typing pauses before YouTube Music is asked. */
const DEBOUNCE_MS = 350;

/**
 * Search's YouTube Music songs, under the Library's. Hidden while YT Music is off; offline, one
 * quiet line says they come back online.
 */
export function YtResults({
  query,
  onPlay,
  onDownload,
}: {
  readonly query: string;
  readonly onPlay: (videoIds: readonly string[], index: number) => void;
  /** Downloads a song into the Library; it shows on the Downloads page. */
  readonly onDownload: (videoId: string) => void;
}) {
  const [found, setFound] = useState<{ query: string; page: YtSearchPage }>();
  const [selected, setSelected] = useState<number>();
  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed === "") return;
    let current = true;
    const timer = setTimeout(() => {
      void window.wave.yt
        .search(trimmed)
        .catch((): YtSearchPage => ({
          status: "failed",
          songs: { items: [], offset: 0, total: 0 },
        }))
        .then((page) => {
          if (current) {
            setFound({ query: trimmed, page });
            setSelected(undefined);
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [trimmed]);
  const page = trimmed !== "" && found?.query === trimmed ? found.page : undefined;
  if (page === undefined || page.status === "disabled") return null;
  if (page.status !== "ok")
    return (
      <p className="yt-quiet secondary" role="status" data-testid="yt-status">
        {page.status === "offline" ? labels.ytOffline : labels.ytFailed}
      </p>
    );
  const songs = page.songs.items;
  if (songs.length === 0) return null;
  const ids = songs.flatMap((row) => (row.videoId === undefined ? [] : [row.videoId]));
  return (
    <section className="yt-results" aria-labelledby="yt-results-heading" data-testid="yt-results">
      <h2 id="yt-results-heading">{labels.youTubeMusic}</h2>
      <div role="list">
        {songs.map((row, index) => (
          <div key={row.videoId ?? index} role="listitem" className="yt-item">
            <button
              className="table-row table-columns yt-row"
              aria-selected={selected === index}
              aria-label={[row.title, row.artist].filter(Boolean).join(", ")}
              onClick={() => setSelected(index)}
              onDoubleClick={() => onPlay(ids, index)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onPlay(ids, index);
                }
              }}
            >
              <span className="title-cell">
                <span className="row-picture">
                  <Artwork url={row.artworkUrl} />
                  <span className="row-play">
                    <Icon name="play" size={16} />
                  </span>
                </span>
                <span className="truncate">{row.title}</span>
              </span>
              <span className="truncate secondary">{row.artist}</span>
              <span className="album-column truncate secondary">{row.album}</span>
              <span className="star-column" />
              <span className="time-column secondary">
                {row.durationMs > 0 ? time(row.durationMs) : ""}
              </span>
            </button>
            {row.videoId !== undefined && (
              <button
                className="icon-button yt-download"
                aria-label={`${text.itemActions.labels.download}, ${row.title}`}
                title={text.itemActions.labels.download}
                onClick={() => onDownload(row.videoId!)}
              >
                <Icon name="download" size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
