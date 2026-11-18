import type { MissingSongsDownloadAction } from "@wave/core";
import { useEffect, useState } from "react";
import type { MissingSongsList, MissingSongsView } from "../../shared/downloads.ts";
import { Icon } from "./Icon.tsx";
import { text } from "./text.ts";

const LABELS: Record<MissingSongsDownloadAction, string> = {
  downloadAll: text.itemActions.labels.downloadMissingSongs,
  retryFailed: text.itemActions.labels.retryFailed,
  cancel: text.downloads.albumActions.cancelAlbumDownload,
};

/**
 * An album, artist, genre or playlist page's Download Missing Songs, beside Play and Shuffle
 * while the page has songs this computer has no file for, with how many; Retry Failed or Cancel
 * while they're on their way or failed.
 */
export function ListDownloadButton({
  list,
  revision,
  onError,
}: {
  readonly list: MissingSongsList;
  /** Changes when the album's songs or their downloads may have. */
  readonly revision: string;
  readonly onError: () => void;
}) {
  const key = `${list.kind}:${list.id}`;
  const [view, setView] = useState<{ key: string; missing: MissingSongsView | null }>();
  useEffect(() => {
    let live = true;
    void window.wave.downloads
      .list({ kind: list.kind, id: list.id })
      .then((missing) => {
        if (live) setView({ key, missing });
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [key, list.kind, list.id, revision, onError]);
  const missing = view?.key === key ? view.missing : null;
  const action = missing?.actions[0];
  if (missing === null || action === undefined) return null;
  return (
    <>
      <button
        data-testid="list-download"
        onClick={() =>
          void window.wave.downloads
            .missingAction(action, list)
            .then(() => window.wave.downloads.list(list))
            .then((next) => setView({ key, missing: next }))
            .catch(onError)
        }
      >
        <Icon name="download" size={16} />
        {action === "cancel" && list.kind !== "album"
          ? text.settings.missingSongs.cancel
          : LABELS[action]}
      </button>
      {missing.line !== null && (
        <span className="secondary hero-download-line">{missing.line}</span>
      )}
    </>
  );
}
