import { useState } from "react";
import type { YtListDownloadView, YtSongsList } from "../../shared/downloads.ts";
import { Icon } from "./Icon.tsx";
import { useEverySecond } from "./useEverySecond.ts";

/**
 * A YT Music list page's download button, beside Play and Shuffle, and the head's line while its
 * songs are on their way (Core's `ytAlbumDownloadButton`): Download, Cancel, Retry Failed, or
 * Downloaded once the Library has every song, which a click only says. Read again each second,
 * so the count follows the songs as they're saved.
 */
export function YtListDownloadButton({
  list,
  onError,
}: {
  readonly list: YtSongsList;
  /** Shows that the click didn't work. */
  readonly onError: (cause: unknown) => void;
}) {
  const key = `${list.kind}:${list.id}`;
  const [view, setView] = useState<{ key: string; view: YtListDownloadView | null }>();
  useEverySecond(
    () => window.wave.downloads.ytList(list),
    (next) =>
      setView((previous) =>
        previous?.key === key && JSON.stringify(previous.view) === JSON.stringify(next)
          ? previous
          : { key, view: next },
      ),
    key,
  );
  const shown = view?.key === key ? view.view : null;
  const button = shown?.button ?? null;
  if (shown === null || button === null) return null;
  const { action } = button;
  return (
    <>
      <button
        data-testid="yt-list-download"
        className={action === "downloaded" ? "downloaded" : undefined}
        aria-disabled={action === "downloaded" || undefined}
        onClick={() => {
          if (action === "downloaded") return;
          void window.wave.downloads
            .ytListAction(action, list)
            .then(() => window.wave.downloads.ytList(list))
            .then((next) => setView({ key, view: next }))
            .catch(onError);
        }}
      >
        <Icon name="download" size={16} />
        {button.label}
      </button>
      {shown.line !== null && (
        <span className="secondary hero-download-line" data-testid="yt-list-download-line">
          {shown.line}
        </span>
      )}
    </>
  );
}
