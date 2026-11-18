import { toastDuration } from "@wave/core";
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import type { PlaybackCommand, PlayerView } from "../../shared/playerView.ts";
import { Icon } from "./Icon.tsx";
import { labels, text } from "./text.ts";
import { Artwork, time } from "./VirtualTable.tsx";

/** How often the window reads the player: often enough for the scrubber while playing. */
const PLAYING_POLL_MS = 100;
const IDLE_POLL_MS = 1000;
const VOLUME_STEP = 0.05;

/** The player's state, read from main, and `run` for a bridge call that changes it. */
export function usePlayback(failed: () => void) {
  const [view, setView] = useState<PlayerView>();
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      clearTimeout(timer);
      let next: PlayerView | undefined;
      try {
        next = await window.wave.playback.view();
        if (active) setView(next);
      } catch {
        if (active) failed();
      }
      if (!active) return;
      const delay = next?.status.state === "playing" ? PLAYING_POLL_MS : IDLE_POLL_MS;
      timer = setTimeout(() => void poll(), delay);
    };
    wake.current = () => void poll();
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [failed]);
  const run = useCallback(
    (action: Promise<unknown>) => {
      action.then(() => wake.current()).catch(failed);
    },
    [failed],
  );
  return { view, run };
}

const repeatLabel = (view: PlayerView | undefined) =>
  view?.repeat === "one"
    ? labels.repeatOne
    : view?.repeat === "all"
      ? labels.repeatAll
      : labels.repeatOff;
const nextRepeat = { off: "all", all: "one", one: "off" } as const;

/** Where Space belongs to the focused control: a button, a link, a switch or a field. */
const OWNS_SPACE = "button, a[href], [role=button], [role=link], [role=switch], [role=checkbox]";
const FIELD = "input, textarea, select, [contenteditable=true]";
/** Where ↑ and ↓ move through a list instead of changing the volume. */
const LIST = "[role=grid], [role=listbox], [role=list], [role=tree], [role=menu], button";

/** The keys that work anywhere in the window (docs/spec-desktop.md, Keyboard). */
function usePlayerKeys(view: PlayerView | undefined, run: (action: Promise<unknown>) => void) {
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  }, [view]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : document.body;
      const now = latest.current;
      if (event.defaultPrevented || now === undefined || target.closest(FIELD)) return;
      const act = (action: Promise<unknown>) => {
        event.preventDefault();
        run(action);
      };
      const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
      const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
      const playback = window.wave.playback;
      if (event.code === "Space" && plain && !target.closest(OWNS_SPACE)) {
        if (now.current !== null)
          act(now.status.state === "playing" ? playback.pause() : playback.play());
      } else if (ctrl && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        if (now.current !== null)
          act(playback.command({ type: event.key === "ArrowLeft" ? "previous" : "next" }));
      } else if (ctrl && event.key.toLowerCase() === "l") {
        if (now.current !== null) act(playback.favorite());
      } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && plain) {
        if (target.closest(LIST)) return;
        const step = event.key === "ArrowUp" ? VOLUME_STEP : -VOLUME_STEP;
        act(playback.volume(Math.max(0, Math.min(1, now.volume + step)), false));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);
}

/** "New queue playing" with Undo, for as long as Core's toast lasts. */
function UndoToast({
  offer,
  run,
}: {
  readonly offer: number | null;
  readonly run: (action: Promise<unknown>) => void;
}) {
  const [closed, setClosed] = useState<number | null>(null);
  useEffect(() => {
    if (offer === null) return;
    const timer = setTimeout(
      () => {
        setClosed(offer);
        run(window.wave.playback.dismissUndo());
      },
      toastDuration(text.playbackText.newQueuePlaying, { withAction: true }),
    );
    return () => clearTimeout(timer);
  }, [offer, run]);
  if (offer === null || closed === offer) return null;
  return (
    <div className="playback-toast" role="status">
      <span>{text.playbackText.newQueuePlaying}</span>
      <button
        onClick={() => {
          setClosed(offer);
          run(window.wave.playback.undo());
        }}
      >
        {text.playbackText.undo}
      </button>
    </div>
  );
}

export function PlayerBar({ playback }: { readonly playback: ReturnType<typeof usePlayback> }) {
  const { view, run } = playback;
  const [drag, setDrag] = useState<number>();
  usePlayerKeys(view, run);
  const song = view?.current ?? null;
  const playing = view?.status.state === "playing";
  const duration = view?.status.durationMs ?? song?.durationMs ?? 0;
  const position = Math.min(drag ?? view?.status.positionMs ?? 0, Math.max(duration, 0));
  const command = (next: PlaybackCommand) => run(window.wave.playback.command(next));
  const seekTo = (positionMs: number) => {
    setDrag(undefined);
    run(window.wave.playback.seek(positionMs));
  };
  const button = (
    icon: string,
    label: string,
    action: () => void,
    pressed?: boolean,
    disabled = song === null,
    badge?: string,
  ) => (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={action}
    >
      <Icon name={icon} />
      {badge !== undefined && (
        <span className="icon-badge" aria-hidden="true">
          {badge}
        </span>
      )}
    </button>
  );
  const progress = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  return (
    <>
      <UndoToast offer={view?.undoOffer ?? null} run={run} />
      <footer className="player-bar" aria-label={labels.player}>
        <div className="player-song">
          <Artwork hash={song?.artworkHash} />
          <div className="player-metadata">
            <div className="truncate player-title">{song?.title ?? labels.nothingPlaying}</div>
            {song && (
              <>
                <div className="truncate secondary">{song.artist}</div>
                <div className="truncate tertiary">{song.album}</div>
              </>
            )}
          </div>
          {button(
            "favorites",
            labels.favorite,
            () => run(window.wave.playback.favorite()),
            song?.favorite,
          )}
        </div>
        <div className="player-center">
          <div className="transport">
            {button(
              "shuffle",
              labels.shuffle,
              () => command({ type: "setShuffle", on: !view?.shuffle }),
              view?.shuffle,
            )}
            {button("previous", labels.previous, () => command({ type: "previous" }))}
            {button(playing ? "pause" : "play", playing ? labels.pause : labels.play, () =>
              run(playing ? window.wave.playback.pause() : window.wave.playback.play()),
            )}
            {button("next", labels.next, () => command({ type: "next" }))}
            {button(
              "repeat",
              repeatLabel(view),
              () => command({ type: "setRepeat", mode: nextRepeat[view?.repeat ?? "off"] }),
              view !== undefined && view.repeat !== "off",
              song === null,
              view?.repeat === "one" ? "1" : undefined,
            )}
          </div>
          <div className="scrubber">
            <span>{time(position)}</span>
            <div
              className="wave-scrubber"
              style={{ "--progress": `${progress}%` } as CSSProperties}
            >
              <div className="wave-track" aria-hidden="true" />
              <input
                type="range"
                aria-label={labels.seek}
                aria-valuetext={`${time(position)} / ${time(duration)}`}
                min={0}
                max={Math.max(1, duration)}
                step={1000}
                value={position}
                disabled={song === null}
                onChange={(event) => setDrag(Number(event.target.value))}
                onPointerUp={(event) => seekTo(Number(event.currentTarget.value))}
                onKeyUp={(event) => {
                  if (drag !== undefined) seekTo(Number(event.currentTarget.value));
                }}
              />
            </div>
            <span>{`-${time(Math.max(0, duration - position))}`}</span>
          </div>
        </div>
        <div className="player-tools">
          {(["sleep", "lyrics", "queue", "menu"] as const).map((key) => (
            // Their tickets come after this one; the bar keeps its layout meanwhile.
            <Fragment key={key}>{button(key, labels[key], () => {}, undefined, true)}</Fragment>
          ))}
          {button(
            view?.muted ? "mute" : "volume",
            view?.muted ? labels.unmute : labels.mute,
            () => run(window.wave.playback.volume(view?.volume ?? 1, !view?.muted)),
            view?.muted,
            view === undefined,
          )}
          <input
            type="range"
            aria-label={labels.volume}
            min={0}
            max={1}
            step={0.01}
            value={view?.muted ? 0 : (view?.volume ?? 1)}
            onChange={(event) =>
              run(window.wave.playback.volume(Number(event.target.value), false))
            }
          />
        </div>
      </footer>
    </>
  );
}
