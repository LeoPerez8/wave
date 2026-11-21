/**
 * Recognize (docs/spec.md › Recognize): Search's microphone button opens this card, already
 * listening. Main runs the session; the card shows it, captures only the session main names
 * and runs the result's buttons through `window.wave.recognize`.
 */
import {
  recognizeCardActionLabels,
  type RecognizeCardAction,
  type RecognizeSource,
} from "@wave/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type {
  RecognizeRunAction,
  RecognizeRunResult,
  RecognizeView,
} from "../../shared/recognize.ts";
import { Icon } from "./Icon.tsx";
import { CaptureError, startCapture } from "./recognizeCapture.ts";
import { Toast, trapTab } from "./SongActions.tsx";
import { songActionToast } from "./songActionToast.ts";
import { text } from "./text.ts";
import "./recognize.css";

/** The result card's entries, in Core's order; the rest are the card's own buttons. */
const ENTRIES: ReadonlySet<RecognizeCardAction> = new Set<RecognizeCardAction>([
  "play",
  "playNext",
  "addToShazam",
  "addToPlaylist",
  "goToAlbum",
  "download",
  "retryDownload",
  "cancelDownload",
]);

const RUN: ReadonlySet<string> = new Set<RecognizeRunAction>([
  "play",
  "playNext",
  "addToShazam",
  "addToPlaylist",
  "download",
  "cancelDownload",
  "retryDownload",
  "openSettings",
]);

/** What a failed button says. */
const failure = (action: RecognizeRunAction): string => {
  switch (action) {
    case "addToShazam":
      return text.playbackText.couldntAddToShazam;
    case "play":
      return text.playbackText.couldntPlayTheSong;
    case "playNext":
      return text.playbackText.couldntQueueTheSong;
    default:
      return text.desktopLibrary.actionFailed;
  }
};

/** The toast a button's result shows, if any. */
const toastOf = (result: RecognizeRunResult): string | null => {
  switch (result.kind) {
    case "shazam":
      return result.message;
    case "queued":
    case "playlist":
      return songActionToast(result, true, "menu", result.kind === "queued" ? result.count : 1);
    case "done":
      return null;
  }
};

/** Keeps the session main names captured, until main stops naming it. */
function useCapture(capture: RecognizeView["capture"]) {
  const session = capture?.session;
  const via = capture?.via;
  useEffect(() => {
    if (session === undefined || via === undefined) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const ended = (why: "denied" | "failed") =>
      void window.wave.recognize.captureEnded(session, why).catch(() => undefined);
    startCapture(
      via,
      (pcm) => void window.wave.recognize.audio(session, pcm).catch(() => undefined),
      () => ended("failed"),
    ).then(
      (started) => {
        if (cancelled) started();
        else stop = started;
      },
      (error: unknown) => {
        if (!cancelled) ended(error instanceof CaptureError ? error.why : "failed");
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [session, via]);
}

export function Recognize({
  onClose,
  onAlbum,
  onChanged,
}: {
  readonly onClose: () => void;
  /** Go to Album: the card closes and the album opens. */
  readonly onAlbum: (id: number) => void;
  /** A button changed the queue or a playlist. */
  readonly onChanged: () => void;
}) {
  const [view, setView] = useState<RecognizeView>();
  const [toast, setToast] = useState<string>();
  const [playlists, setPlaylists] = useState<readonly BrowseRow[]>();
  const [busy, setBusy] = useState(false);
  const hideToast = useCallback(() => setToast(undefined), []);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const card = useRef<HTMLDivElement>(null);

  // Opens listening through the microphone, then follows main's card.
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const follow = (next: RecognizeView) => {
      if (!current) return;
      setView(next);
      if (!next.open) return closeRef.current();
      timer = setTimeout(poll, next.card.listening || next.capture !== null ? 250 : 1000);
    };
    const poll = () =>
      void window.wave.recognize.view().then(follow, () => {
        if (current) timer = setTimeout(poll, 1000);
      });
    void window.wave.recognize.start("microphone").then(follow, () => closeRef.current());
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, []);
  useCapture(view?.capture ?? null);
  useEffect(() => card.current?.focus(), []);

  const close = () => {
    void window.wave.recognize.close().catch(() => undefined);
    onClose();
  };
  const listen = (source: RecognizeSource) => {
    setPlaylists(undefined);
    void window.wave.recognize.start(source).then(setView, () => undefined);
  };
  const run = (action: RecognizeRunAction, playlistId?: number) => {
    setBusy(true);
    void window.wave.recognize
      .run(action, playlistId)
      .then((result) => {
        onChanged();
        const line = toastOf(result);
        if (line !== null) setToast(line);
        if (action === "play") close();
      })
      .catch(() => setToast(failure(action)))
      .finally(() => setBusy(false));
  };
  const press = (action: RecognizeCardAction) => {
    switch (action) {
      case "cancel":
      case "done":
      case "close":
        return close();
      case "listenAgain":
      case "tryAgain":
        return listen(view?.source ?? "microphone");
      case "useMicrophone":
        return listen("microphone");
      case "goToAlbum":
        if (view?.album != null) {
          close();
          onAlbum(view.album);
        }
        return;
      case "addToPlaylist":
        if (playlists !== undefined) return setPlaylists(undefined);
        void window.wave.library.browse({ kind: "playlists" }, 0, 200).then(
          (page) => setPlaylists(page.items),
          () => setToast(text.desktopLibrary.actionFailed),
        );
        return;
      default:
        if (RUN.has(action)) run(action as RecognizeRunAction);
    }
  };

  const labels = recognizeCardActionLabels(text);
  const shown = view?.card;
  const resolved = shown !== undefined && shown.actions.includes("listenAgain") && shown.cover;
  const entries = shown?.actions.filter((action) => ENTRIES.has(action)) ?? [];
  const buttons = shown?.actions.filter((action) => !ENTRIES.has(action)) ?? ["cancel"];
  return (
    <>
      <div className="dialog-backdrop" onClick={close}>
        <div
          ref={card}
          tabIndex={-1}
          className="dialog recognize-card"
          role="dialog"
          aria-modal="true"
          aria-label={text.playbackText.recognizeSong}
          data-testid="recognize-card"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            } else trapTab(event);
          }}
        >
          <h2>{text.playbackText.recognizeSong}</h2>
          <div className="recognize-sources" role="radiogroup">
            {(
              [
                ["microphone", text.playbackText.aroundMe],
                ["playback", text.playbackText.thisPhone],
              ] as const
            ).map(([source, label]) => (
              <button
                key={source}
                role="radio"
                aria-checked={view?.source === source}
                title={text.playbackText.startsListeningAgainFromThisSource}
                onClick={() => view?.source !== source && listen(source)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="recognize-song">
            {shown?.cover &&
              (view?.cover ? (
                <img className="recognize-cover" src={view.cover} alt="" />
              ) : (
                <span className="recognize-cover" aria-hidden="true">
                  <Icon name="songs" size={28} />
                </span>
              ))}
            <div className="recognize-lines">
              <p className="recognize-title" aria-live="polite">
                {shown?.title ?? text.playbackText.listening}
              </p>
              {shown?.lines.map((line) => (
                <p key={line} className="secondary">
                  {line}
                </p>
              ))}
            </div>
          </div>
          {(shown?.listening ?? true) && (
            <div className="recognize-wave" aria-hidden="true">
              {Array.from({ length: 24 }, (_, index) => (
                <span key={index} style={{ animationDelay: `${(index % 8) * -0.12}s` }} />
              ))}
            </div>
          )}
          {resolved && entries.length > 0 && (
            <div className="recognize-entries" role="group">
              {entries.map((action) => (
                <button
                  key={action}
                  disabled={busy}
                  aria-expanded={action === "addToPlaylist" ? playlists !== undefined : undefined}
                  onClick={() => press(action)}
                >
                  {labels[action]}
                </button>
              ))}
            </div>
          )}
          {playlists !== undefined && (
            <div className="recognize-playlists" role="group" aria-label={labels.addToPlaylist}>
              {playlists.length === 0 ? (
                <p className="secondary">{text.desktopLibrary.noPlaylists}</p>
              ) : (
                playlists.map((row) => (
                  <button
                    key={row.id}
                    disabled={busy}
                    onClick={() => {
                      setPlaylists(undefined);
                      run("addToPlaylist", row.id);
                    }}
                  >
                    {row.title}
                  </button>
                ))
              )}
            </div>
          )}
          <div className="dialog-buttons">
            {buttons.map((action) => (
              <button
                key={action}
                className={action === "tryAgain" || action === "listenAgain" ? "accent" : undefined}
                onClick={() => press(action)}
              >
                {labels[action]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {toast && <Toast message={toast} onDone={hideToast} />}
    </>
  );
}
