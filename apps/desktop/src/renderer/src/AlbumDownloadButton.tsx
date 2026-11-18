import type { MissingSongsDownloadAction } from "@wave/core";
import { useEffect, useState } from "react";
import type { MissingSongsView } from "../../shared/downloads.ts";
import { Icon } from "./Icon.tsx";
import { text } from "./text.ts";

const LABELS: Record<MissingSongsDownloadAction, string> = {
  downloadAll: text.itemActions.labels.downloadMissingSongs,
  retryFailed: text.itemActions.labels.retryFailed,
  cancel: text.downloads.albumActions.cancelAlbumDownload,
};

/**
 * An album page's Download Missing Songs, beside Play and Shuffle while the album has songs this
 * computer has no file for; Retry Failed or Cancel while they're on their way or failed.
 */
export function AlbumDownloadButton({
  albumId,
  revision,
  onError,
}: {
  readonly albumId: number;
  /** Changes when the album's songs or their downloads may have. */
  readonly revision: string;
  readonly onError: () => void;
}) {
  const [view, setView] = useState<{ id: number; missing: MissingSongsView | null }>();
  useEffect(() => {
    let live = true;
    void window.wave.downloads
      .album(albumId)
      .then((missing) => {
        if (live) setView({ id: albumId, missing });
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [albumId, revision, onError]);
  const missing = view?.id === albumId ? view.missing : null;
  const action = missing?.actions[0];
  if (missing === null || action === undefined) return null;
  return (
    <>
      <button
        data-testid="album-download"
        onClick={() =>
          void window.wave.downloads
            .missingAction(action, albumId)
            .then(() => window.wave.downloads.album(albumId))
            .then((next) => setView({ id: albumId, missing: next }))
            .catch(onError)
        }
      >
        <Icon name="download" size={16} />
        {LABELS[action]}
      </button>
      {missing.line !== null && action !== "downloadAll" && (
        <span className="secondary hero-download-line">{missing.line}</span>
      )}
    </>
  );
}
