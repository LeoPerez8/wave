import { readThemeChoice, themeFor } from "@wave/core";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Appearance } from "../../../shared/bridge.ts";
import { Icon } from "../Icon.tsx";
import { usePlayback } from "../PlayerBar.tsx";
import { useDesktopKeys } from "../keys.ts";
import { applyLanguage, artistName, labels, text, useLanguage } from "../text.ts";
import { Artwork } from "../VirtualTable.tsx";

/** How often the mini player reads the theme and language the main window may have changed. */
const LOOK_POLL_MS = 3000;

/** The account's theme, the appearance and the language, read again while the window is open. */
function useLook() {
  const [look, setLook] = useState<{ appearance: Appearance; theme: string | null }>();
  useLanguage();
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const [appearance, account, language] = await Promise.all([
          window.wave.settings.appearance(),
          window.wave.account.view(),
          window.wave.settings.language(),
        ]);
        if (!active) return;
        applyLanguage(language);
        setLook((old) =>
          old?.appearance === appearance && old.theme === account.theme
            ? old
            : { appearance, theme: account.theme },
        );
      } catch {
        // The look it has stays until main answers again.
      }
    };
    void read();
    const timer = setInterval(() => void read(), LOOK_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return look;
}

/** The floating mini player: the song playing and its controls, in a window of its own. */
export function MiniPlayer() {
  const shell = useRef<HTMLDivElement>(null);
  const failed = useCallback(() => {}, []);
  const { view, run } = usePlayback(failed);
  const look = useLook();
  const appearance = look?.appearance ?? "system";
  const theme = look?.theme ?? null;
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const scheme = appearance === "system" ? (media.matches ? "dark" : "light") : appearance;
      const colours = themeFor(readThemeChoice(theme))[scheme];
      for (const [key, value] of Object.entries(colours))
        shell.current?.style.setProperty(`--color-${key}`, value);
      if (shell.current) shell.current.style.colorScheme = scheme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance, theme]);

  const playback = window.wave.playback;
  const song = view?.current ?? null;
  const playing = view?.status.state === "playing";
  const toggle = () => run(playing ? playback.pause() : playback.play());
  const previous = () => run(playback.command({ type: "previous" }));
  const next = () => run(playback.command({ type: "next" }));
  const favorite = () => run(playback.favorite());
  const withSong = (action: () => void) => () => {
    if (song === null) return false;
    action();
  };
  useDesktopKeys({
    playPause: withSong(toggle),
    next: withSong(next),
    previous: withSong(previous),
    favorite: withSong(favorite),
  });

  const duration = view?.status.durationMs ?? song?.durationMs ?? 0;
  const position = Math.min(view?.status.positionMs ?? 0, Math.max(duration, 0));
  const progress = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const button = (
    icon: string,
    label: string,
    action: () => void,
    disabled = song === null,
    pressed?: boolean,
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
    </button>
  );
  return (
    <div ref={shell} className="mini-player" data-appearance={appearance}>
      <Artwork kind="song" id={song?.id} hash={song?.artworkHash} url={song?.artworkUrl} />
      <div className="mini-song">
        <div className="truncate player-title">{song?.title ?? labels.nothingPlaying}</div>
        {song && <div className="truncate secondary">{artistName(song.artist)}</div>}
      </div>
      <div className="mini-window-buttons">
        {button(
          "showMain",
          text.desktopWindow.show,
          () => void window.wave.miniPlayer.showMain().catch(failed),
          false,
        )}
        {button(
          "close",
          text.desktopWindow.closeMiniPlayer,
          () => void window.wave.miniPlayer.close().catch(failed),
          false,
        )}
      </div>
      <div className="mini-controls">
        {button("previous", labels.previous, previous)}
        {button(playing ? "pause" : "play", playing ? labels.pause : labels.play, toggle)}
        {button("next", labels.next, next)}
        {button("favorites", labels.favorite, favorite, song === null, song?.favorite)}
      </div>
      <div
        className="mini-progress"
        aria-hidden="true"
        style={{ "--progress": `${progress}%` } as CSSProperties}
      />
    </div>
  );
}
