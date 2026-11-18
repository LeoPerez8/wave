import { useEffect, useState } from "react";
import { labels, text } from "./text.ts";

/**
 * Settings › Downloads: the folder downloads go to, which is one of the Library's folders, and
 * Download in best quality (Soulseek).
 */
export function DownloadSettings({ onError }: { readonly onError: () => void }) {
  const [folder, setFolder] = useState<string>();
  const [bestQuality, setBestQuality] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  useEffect(() => {
    let live = true;
    void Promise.all([window.wave.downloads.folder(), window.wave.downloads.bestQuality()])
      .then(([path, on]) => {
        if (live) {
          setFolder(path);
          setBestQuality(on);
        }
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [onError]);
  return (
    <div className="mt-8 max-w-3xl" data-testid="download-settings">
      <h2 className="text-lg font-semibold">{labels.downloads}</h2>
      <div className="mt-4 flex items-center justify-between gap-4 border-y border-separator py-3">
        <div className="min-w-0">
          <p>{labels.downloadsFolder}</p>
          <p className="break-all text-sm text-secondary" data-testid="downloads-folder">
            {folder}
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void window.wave.downloads
              .pickFolder()
              .then((path) => {
                if (path !== null) setFolder(path);
              })
              .catch(onError)
              .finally(() => setBusy(false));
          }}
        >
          {labels.changeFolder}
        </button>
      </div>
      {bestQuality !== undefined && (
        <>
          <label className="setting-switch">
            <input
              type="checkbox"
              checked={bestQuality}
              disabled={busy}
              onChange={(event) => {
                const on = event.target.checked;
                setBusy(true);
                setFailure(undefined);
                setBestQuality(on);
                void window.wave.downloads
                  .setBestQuality(on)
                  .then(setBestQuality)
                  .catch(() => {
                    setBestQuality(!on);
                    setFailure(
                      on
                        ? text.settings.couldntConnectToSoulseekTryAgainWhen
                        : text.settings.couldntTurnItOffTryAgain,
                    );
                  })
                  .finally(() => setBusy(false));
              }}
            />
            <span>{text.settings.downloadInBestQuality}</span>
          </label>
          <p className="secondary setting-hint">{text.settings.bestQualityIsMP3320KbpsFrom}</p>
          {failure && (
            <p className="error mt-2" role="alert">
              {failure}
            </p>
          )}
        </>
      )}
    </div>
  );
}
