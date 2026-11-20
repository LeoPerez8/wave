import { libraryLookupProgress, tagLookupsToast } from "@wave/core";
import { useCallback, useEffect, useState } from "react";
import type {
  LyricsAndTagsSettings as Settings,
  LyricsAndTagsView,
} from "../../shared/lyricsAndTags.ts";
import { ConfirmDialog } from "./SongActions.tsx";
import { text } from "./text.ts";

/** How often the page reads the whole-Library run's progress. */
const RUN_EVERY_MS = 1000;

/**
 * Settings › Lyrics and tags: Fix songs online with Fix songs in the whole Library, and Download
 * artist photos with Clear artist photos, and Genius insights. The switches are account-wide.
 */
export function LyricsAndTagsSettings({
  onError,
  notify,
  onGeniusChanged,
}: {
  readonly onError: () => void;
  /** Shows the window's toast: how a whole-Library run went. */
  readonly notify: (message: string) => void;
  readonly onGeniusChanged: (enabled: boolean) => void;
}) {
  const [view, setView] = useState<LyricsAndTagsView>();
  const [clearing, setClearing] = useState(false);
  const read = useCallback(
    () => window.wave.lyricsAndTags.view().then(setView).catch(onError),
    [onError],
  );
  useEffect(() => {
    void read();
  }, [read]);
  const running = view !== undefined && view.fixRun !== null;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void read(), RUN_EVERY_MS);
    return () => clearInterval(timer);
  }, [running, read]);
  if (view === undefined) return null;

  const change = (next: Partial<Settings>) => {
    setView({ ...view, ...next });
    void window.wave.lyricsAndTags
      .set(next)
      .then((saved) => {
        setView(saved);
        if (next.geniusInsights !== undefined) onGeniusChanged(saved.geniusInsights);
      })
      .catch(() => {
        onError();
        void read();
      });
  };
  const fixLibrary = () => {
    // The answer comes when the run ends, even after this page was left.
    void window.wave.lyricsAndTags
      .fixLibrary()
      .then((result) => notify(tagLookupsToast(result.results, result.stop, result.skipped, text)))
      .catch(onError)
      .finally(() => void read());
    setView({ ...view, fixRun: { done: 0, total: 0 } });
  };
  const clearPhotos = () => {
    void window.wave.lyricsAndTags
      .clearArtistPhotos()
      .then(setView)
      .catch(() => notify(text.settings.couldntClearArtistPhotos));
  };

  return (
    <div className="mt-8 max-w-3xl" data-testid="lyrics-and-tags-settings">
      <h2 className="text-lg font-semibold">{text.settings.lyricsAndGenre}</h2>
      <section className="mt-4 border-y border-separator py-3">
        <label className="flex items-center justify-between gap-4">
          <span>{text.settings.fixSongsOnline}</span>
          <input
            type="checkbox"
            role="switch"
            className="size-4 accent-accent"
            checked={view.fixSongsOnline}
            onChange={(event) => change({ fixSongsOnline: event.target.checked })}
          />
        </label>
      </section>
      <p className="mt-2 text-sm text-secondary">{text.settings.fixSongInTheMenuOfA}</p>
      {view.fixRun !== null ? (
        <div className="mt-4 flex items-center gap-4">
          <p className="min-w-0 flex-1 text-sm text-secondary" role="status">
            {libraryLookupProgress(view.fixRun.done, view.fixRun.total, text).line}
          </p>
          <button onClick={() => void window.wave.lyricsAndTags.cancelFix().catch(onError)}>
            {text.settings.cancel}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <button disabled={!view.fixSongsOnline} onClick={fixLibrary}>
            {text.settings.fixSongsInTheWholeLibrary}
          </button>
        </div>
      )}

      <h2 className="mt-10 text-lg font-semibold">{text.settings.artistPhotos}</h2>
      <section className="mt-4 border-y border-separator py-3">
        <label className="flex items-center justify-between gap-4">
          <span>{text.settings.downloadArtistPhotos}</span>
          <input
            type="checkbox"
            role="switch"
            className="size-4 accent-accent"
            checked={view.downloadArtistPhotos}
            onChange={(event) => change({ downloadArtistPhotos: event.target.checked })}
          />
        </label>
      </section>
      <p className="mt-2 text-sm text-secondary">{text.settings.waveLooksUpAPhotoOfEach}</p>
      <div className="mt-4">
        <button
          className="destructive"
          disabled={view.artistPhotos === 0}
          onClick={() => setClearing(true)}
        >
          {text.settings.clearArtistPhotosText}
        </button>
      </div>
      <section className="mt-10 border-y border-separator py-3">
        <label className="flex items-center justify-between gap-4">
          <span>{text.settings.geniusInsights}</span>
          <input
            type="checkbox"
            role="switch"
            className="size-4 accent-accent"
            checked={view.geniusInsights}
            onChange={(event) => change({ geniusInsights: event.target.checked })}
          />
        </label>
      </section>
      <p className="mt-2 text-sm text-secondary">{text.settings.openingLyricsOnASongWithLyrics}</p>
      {clearing && (
        <ConfirmDialog
          spec={{
            title: text.settings.clearArtistPhotos,
            message: text.settings.clearPhotos(view.artistPhotos),
            action: { label: text.settings.clear, destructive: true },
          }}
          onChoose={(yes) => {
            setClearing(false);
            if (yes) clearPhotos();
          }}
        />
      )}
    </div>
  );
}
