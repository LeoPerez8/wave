import { useCallback, useEffect, useState, type MouseEvent } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { YtArtistCandidate, YtRelatedView } from "../../shared/ytPages.ts";
import { Icon } from "./Icon.tsx";
import { labels, text } from "./text.ts";
import { Shelf, YtSongList } from "./YtLists.tsx";

type Run = (action: Promise<unknown>) => void;

const failedRead: YtRelatedView = {
  status: "failed",
  songs: { items: [], offset: 0, total: 0 },
  artists: [],
};

/**
 * Related in the side panel (story 44a): songs like the one playing ("You might also like")
 * and similar artists. A click plays a song now, its + lines it up as Add to Queue does.
 * Offline, after a failure or with no match, one line with Try Again. The side panel (#1152)
 * hosts it next to Lyrics and the Queue; [song] is the playing song's key, so the panel reads
 * again when it changes.
 */
export function RelatedPanel({
  song,
  run,
  onArtist,
  onSongMenu,
}: {
  readonly song: string | null;
  readonly run: Run;
  readonly onArtist: (artist: YtArtistCandidate) => void;
  readonly onSongMenu?: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
}) {
  const [read, setRead] = useState<{ song: string | null; view: YtRelatedView }>();
  const load = useCallback(() => {
    let current = true;
    void window.wave.yt
      .related()
      .catch(() => failedRead)
      .then((view) => {
        if (current) setRead({ song, view });
      });
    return () => {
      current = false;
    };
  }, [song]);
  useEffect(load, [load]);
  const view = read?.song === song ? read.view : undefined;
  const songs = view?.songs.items ?? [];
  return (
    <section className="related-panel" aria-label={text.playbackText.related}>
      <h2>{text.playbackText.related}</h2>
      {view === undefined ? (
        <p className="yt-quiet secondary" role="status">
          {labels.loading}
        </p>
      ) : view.status === "disabled" ? null : view.status !== "ok" || songs.length === 0 ? (
        <p className="yt-quiet secondary" role="status">
          {text.playbackText.couldntLoadTheRelatedSongs}{" "}
          {view.status !== "ok" && (
            <button className="text-button" onClick={load}>
              {text.playbackText.tryAgain}
            </button>
          )}
        </p>
      ) : (
        <>
          <h3>{labels.youMightAlsoLike}</h3>
          <YtSongList
            songs={songs}
            label={labels.youMightAlsoLike}
            onPlay={(index) => {
              const videoId = songs[index]?.videoId;
              if (videoId !== undefined) run(window.wave.yt.queue("playNow", videoId));
            }}
            onMenu={onSongMenu}
            accessory={(row) =>
              row.videoId === undefined ? null : (
                <button
                  className="icon-button related-add"
                  aria-label={text.playbackText.addValueToQueue(row.title)}
                  title={text.playbackText.addValueToQueue(row.title)}
                  onClick={() => run(window.wave.yt.queue("addToQueue", row.videoId!))}
                >
                  <Icon name="add" />
                </button>
              )
            }
          />
        </>
      )}
      {view !== undefined && (
        <Shelf
          title={labels.similarArtists}
          artists
          items={view.artists.map((artist) => ({
            key: artist.browseId,
            title: artist.name,
            artworkUrl: artist.artworkUrl ?? null,
            label: text.library.artistLabel(artist.name),
          }))}
          onOpen={(index) => onArtist(view.artists[index]!)}
        />
      )}
    </section>
  );
}
