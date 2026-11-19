import { useEffect, useState, type MouseEvent } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { QueueRow } from "../../shared/playerView.ts";
import type { MagicQueueView } from "../../shared/ytPages.ts";
import { MagicQueueRow, useMagicQueuePicks } from "./Discover.tsx";
import { labels, text } from "./text.ts";
import { useOnline } from "./useOnline.ts";
import { YtQuiet, YtSongList } from "./YtLists.tsx";

type Run = (action: Promise<unknown>) => void;

/** How often the page reads the session again while a batch loads. */
const LOADING_POLL_MS = 1000;
/** Up Next as the page lists it. */
const UP_NEXT = 200;

/**
 * The Magic Queue (story 29a): what it grows from, Up Next with its recommendations, and how
 * the next batch goes: loading, a failure or an empty pick with Try Again, or, offline, the
 * quiet line. With no Magic Queue playing, the Magic Queue row offers songs to start one from.
 */
export function MagicQueuePage({
  run,
  revision,
  onSongMenu,
}: {
  readonly run: Run;
  /** The player's revision: the queue changed. */
  readonly revision: number;
  readonly onSongMenu: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
}) {
  const online = useOnline();
  const picks = useMagicQueuePicks();
  const [view, setView] = useState<MagicQueueView>();
  const [upNext, setUpNext] = useState<readonly QueueRow[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let current = true;
    void Promise.all([window.wave.magicQueue.view(), window.wave.playback.queue(0, UP_NEXT)])
      .then(([next, queue]) => {
        if (!current) return;
        setView(next);
        setUpNext(queue.items.filter((row) => !row.history && !row.current));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [revision, tick]);
  const loading = view?.status === "loading";
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setTick((n) => n + 1), LOADING_POLL_MS);
    return () => clearTimeout(timer);
  }, [loading, tick]);
  const retry = () => run(window.wave.magicQueue.retry().then(() => setTick((n) => n + 1)));
  const title = view?.title ?? null;
  return (
    <div className="yt-page" data-testid="magic-queue">
      <p className="secondary yt-lead">
        {title === null ? labels.magicQueueIdle : text.playbackText.magicQueueFrom(title)}
      </p>
      {!online || view?.status === "offline" ? (
        <YtQuiet status="offline" />
      ) : view?.status === "failed" || view?.status === "empty" ? (
        <p className="yt-quiet secondary" role="status">
          {view.status === "empty" && title !== null
            ? text.playbackText.noSongsFoundLikeValue(title)
            : text.playbackText.couldntLoadRecommendations}{" "}
          <button className="text-button" onClick={retry}>
            {text.playbackText.tryAgain}
          </button>
        </p>
      ) : null}
      {title === null ? (
        <MagicQueueRow picks={picks} run={run} />
      ) : (
        <>
          <h2>{text.playbackText.upNext}</h2>
          <YtSongList
            songs={upNext}
            label={text.playbackText.upNext}
            onPlay={(index) =>
              run(window.wave.playback.command({ type: "jumpTo", key: upNext[index]!.key }))
            }
            onMenu={onSongMenu}
          />
          {loading && (
            <p className="yt-quiet secondary" role="status">
              {labels.loading}
            </p>
          )}
        </>
      )}
    </div>
  );
}
