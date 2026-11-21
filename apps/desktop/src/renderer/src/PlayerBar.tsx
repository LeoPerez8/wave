import { toastDuration } from "@wave/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEvent,
} from "react";

import type { PlaybackCommand, PlayerView } from "../../shared/playerView.ts";
import { Icon } from "./Icon.tsx";
import type { shuffleMenuEvents } from "./ShuffleKinds.tsx";
import type { PanelTab } from "./SidePanel.tsx";
import { SleepTimer } from "./SleepTimer.tsx";
import { useSongDrop, type DraggedSongs } from "./songDrag.ts";
import { useDesktopKeys } from "./keys.ts";
import { albumName, artistName, labels, text } from "./text.ts";
import { Artwork, time } from "./VirtualTable.tsx";
import { AlbumCredit, ArtistCredit, type YtCreditLinks } from "./YtCredit.tsx";

/** How often the window reads the player: often enough for the scrubber while playing. */
const PLAYING_POLL_MS = 100;
const IDLE_POLL_MS = 1000;
const VOLUME_STEP = 0.05;
/** What ← and → seek on the focused scrubber (docs/spec-desktop.md, Keyboard). */
const SEEK_STEP_MS = 5000;

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
  /** Reads the player again now, after something else changed it. */
  const refresh = useCallback(() => wake.current(), []);
  return { view, run, refresh };
}

export const repeatLabel = (view: PlayerView | undefined) =>
  view?.repeat === "one"
    ? labels.repeatOne
    : view?.repeat === "all"
      ? labels.repeatAll
      : labels.repeatOff;
export const nextRepeat = { off: "all", all: "one", one: "off" } as const;

/** The player's keys (docs/spec-desktop.md, Keyboard); Core's `desktopKey` scopes them. */
function usePlayerKeys(view: PlayerView | undefined, run: (action: Promise<unknown>) => void) {
  const playback = window.wave.playback;
  const playing = view !== undefined && view.current !== null;
  const volume = (step: number) => () => {
    if (view === undefined) return false;
    run(playback.volume(Math.max(0, Math.min(1, view.volume + step)), false));
  };
  useDesktopKeys({
    playPause: () => {
      if (!playing) return false;
      run(view.status.state === "playing" ? playback.pause() : playback.play());
    },
    next: () => {
      if (!playing) return false;
      run(playback.command({ type: "next" }));
    },
    previous: () => {
      if (!playing) return false;
      run(playback.command({ type: "previous" }));
    },
    favorite: () => {
      if (!playing) return false;
      run(playback.favorite());
    },
    volumeUp: volume(VOLUME_STEP),
    volumeDown: volume(-VOLUME_STEP),
  });
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

export function PlayerBar({
  playback,
  panel,
  onPanel,
  onNowPlaying,
  onMenu,
  shuffleMenu,
  links,
  onSongDrop,
}: {
  readonly playback: ReturnType<typeof usePlayback>;
  /** The side panel's open tab, or null while it is closed. */
  readonly panel: PanelTab | null;
  readonly onPanel: (tab: PanelTab) => void;
  readonly onNowPlaying: () => void;
  /** Opens the song playing's menu under [element]. */
  readonly onMenu: (element: HTMLElement) => void;
  /** What opens the kinds of shuffle from the shuffle button (`shuffleMenuEvents`). */
  readonly shuffleMenu: ReturnType<typeof shuffleMenuEvents>;
  /** Where a streamed song's artist and album names lead. */
  readonly links: YtCreditLinks;
  /** Songs dragged from a list onto the Queue button, for the end of the queue. */
  readonly onSongDrop?: (songs: DraggedSongs) => void;
}) {
  const { view, run } = playback;
  const queueDrop = useSongDrop<"queue">();
  const [drag, setDrag] = useState<number>();
  usePlayerKeys(view, run);
  const song = view?.current ?? null;
  const playing = view?.status.state === "playing";
  const duration = view?.status.durationMs ?? song?.durationMs ?? 0;
  const reported = view?.status.positionMs;
  // A seek shows where it went until playback reports a new position, so the next arrow
  // press moves on from there rather than from where the song was.
  const [seek, setSeek] = useState<{ readonly to: number; readonly from: number | undefined }>();
  if (seek !== undefined && seek.from !== reported) setSeek(undefined);
  const held = seek !== undefined && seek.from === reported ? seek.to : undefined;
  const position = Math.min(drag ?? held ?? reported ?? 0, Math.max(duration, 0));
  const command = (next: PlaybackCommand) => run(window.wave.playback.command(next));
  const seekTo = (positionMs: number) => {
    setDrag(undefined);
    setSeek({ to: positionMs, from: reported });
    run(window.wave.playback.seek(positionMs));
  };
  const button = (
    icon: string,
    label: string,
    action: (event: MouseEvent<HTMLElement>) => void,
    pressed?: boolean,
    disabled = song === null,
    badge?: string,
    /** More of the button's props: the shuffle button's menu, the Queue button's drop. */
    extra?: { readonly className?: string } & HTMLAttributes<HTMLButtonElement>,
  ) => (
    <button
      {...extra}
      className={`icon-button ${extra?.className ?? ""}`}
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
          {/* The artwork and title open Now Playing; a streamed song's names, over the button, open
              their pages. The button holds the names' twins so both stack the same. */}
          <div className="player-now-area">
            <button
              className="player-now"
              title={text.playbackText.opensNowPlaying}
              aria-haspopup="dialog"
              disabled={song === null}
              onClick={onNowPlaying}
            >
              <Artwork kind="song" id={song?.id} hash={song?.artworkHash} url={song?.artworkUrl} />
              <div className="player-metadata">
                <div className="truncate player-title">{song?.title ?? labels.nothingPlaying}</div>
                {song && (
                  <div className="player-credit-twin" aria-hidden="true">
                    <div className="truncate secondary">{artistName(song.artist)}</div>
                    <div className="truncate tertiary">{albumName(song.album)}</div>
                  </div>
                )}
              </div>
            </button>
            {song && (
              <div className="player-metadata player-credits">
                <div className="truncate player-title player-credit-twin" aria-hidden="true">
                  {song.title}
                </div>
                <ArtistCredit row={song} links={links} className="truncate secondary" />
                <AlbumCredit row={song} links={links} className="truncate tertiary" />
              </div>
            )}
          </div>
          {button(
            "favorites",
            labels.favorite,
            () => run(window.wave.playback.favorite()),
            song?.favorite,
            song === null || song.outside,
          )}
        </div>
        <div className="player-center">
          <div className="transport">
            {button(
              "shuffle",
              labels.shuffle,
              () => command({ type: "setShuffle", on: !view?.shuffle }),
              view?.shuffle,
              undefined,
              undefined,
              shuffleMenu,
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
                onKeyDown={(event) => {
                  // The arrows move 5 seconds, not the slider's own step; a held key adds up.
                  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
                  const back = event.key === "ArrowLeft" || event.key === "ArrowDown";
                  if (!back && event.key !== "ArrowRight" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  const moved = position + (back ? -SEEK_STEP_MS : SEEK_STEP_MS);
                  setDrag(Math.max(0, Math.min(duration, moved)));
                }}
                onKeyUp={() => {
                  if (drag !== undefined) seekTo(drag);
                }}
              />
            </div>
            <span>{`-${time(Math.max(0, duration - position))}`}</span>
          </div>
        </div>
        <div className="player-tools">
          <SleepTimer timer={view?.sleepTimer ?? null} disabled={song === null} run={run} />
          {button("lyrics", labels.lyrics, () => onPanel("lyrics"), panel === "lyrics", !view)}
          {button(
            "queue",
            labels.queue,
            () => onPanel("queue"),
            panel === "queue",
            !view,
            undefined,
            onSongDrop && {
              ...queueDrop.props("queue", (songs) => onSongDrop(songs)),
              className: queueDrop.over === "queue" ? "drop-over" : "",
            },
          )}
          {button(
            "menu",
            labels.menu,
            (event) => onMenu(event.currentTarget),
            undefined,
            song === null,
          )}
          {button(
            "miniPlayer",
            text.desktopWindow.miniPlayer,
            () => run(window.wave.miniPlayer.open()),
            undefined,
            false,
          )}
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
