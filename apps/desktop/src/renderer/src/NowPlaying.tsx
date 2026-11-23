/**
 * Now Playing (docs/spec-desktop.md, Window and layout): the artwork, the title and the lyrics
 * over a background tinted from the artwork, as on the phone. It opens from the player bar's
 * artwork or title, leaves the bar in reach, and closes with Esc or its close button.
 */
import { lyricsDimOpacity, paletteGradient, type Gradient } from "@wave/core";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { PlayerView } from "../../shared/playerView.ts";
import { Icon } from "./Icon.tsx";
import { LyricsView } from "./LyricsView.tsx";
import type { GeniusAccess } from "./useSongGenius.ts";
import { text } from "./text.ts";
import { usePalette } from "./useSongPalette.ts";
import { Artwork } from "./VirtualTable.tsx";
import { AlbumCredit, ArtistCredit, type YtCreditLinks } from "./YtCredit.tsx";
import "./panel.css";

const HEX = /^#[0-9a-f]{6}$/i;

/** The window's own colours, as App sets them on the shell. */
const shellColours = (shell: Element | null) => {
  const style = shell === null ? null : getComputedStyle(shell);
  const colour = (name: string) => style?.getPropertyValue(`--color-${name}`).trim() ?? "";
  return {
    scheme: (style?.colorScheme === "dark" ? "dark" : "light") as "light" | "dark",
    ground: colour("background"),
    ink: [colour("foreground"), colour("accent")],
  };
};

/** The shell's colours, read again whenever App sets new ones (a scheme or theme change). */
function useShellColours() {
  const [colours, setColours] = useState(() =>
    shellColours(document.querySelector(".desktop-shell")),
  );
  useEffect(() => {
    const shell = document.querySelector(".desktop-shell");
    if (shell === null) return;
    const observer = new MutationObserver(() => setColours(shellColours(shell)));
    observer.observe(shell, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);
  return colours;
}

export function NowPlaying({
  view,
  run,
  links,
  onClose,
  actions,
  geniusAccess,
  onGeniusSignIn,
  notify,
}: {
  readonly view: PlayerView | undefined;
  readonly run: (action: Promise<unknown>) => void;
  /** Where a streamed song's artist and album names lead; opening one closes Now Playing. */
  readonly links: YtCreditLinks;
  readonly onClose: () => void;
  /** Add to Playlist and Download for the song playing. */
  readonly actions?: ReactNode;
  readonly geniusAccess: GeniusAccess;
  readonly onGeniusSignIn: () => void;
  /** Shows a toast: the lyrics card's Save Image and Copy Image answers. */
  readonly notify: (message: string) => void;
}) {
  const song = view?.current ?? null;
  const palette = usePalette(song);
  const root = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const theme = useShellColours();
  const ground = useMemo<{ gradient: Gradient; dim: number } | null>(() => {
    if (!HEX.test(theme.ground) || !theme.ink.every((ink) => HEX.test(ink))) return null;
    const gradient = paletteGradient(palette, theme);
    return { gradient, dim: lyricsDimOpacity([gradient.top, gradient.bottom], theme.ink[0]!) };
  }, [palette, theme]);
  // Focus moves in, and back to the bar's artwork or title once it closes. It lands on Now
  // Playing itself, not on Close, so Space still plays and pauses; Tab reaches Close next.
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    root.current?.focus();
    return () => {
      const element = opener.current;
      if (element instanceof HTMLElement && element.isConnected) element.focus();
    };
  }, []);
  const style = (
    ground === null
      ? {}
      : {
          background: `linear-gradient(180deg, ${ground.gradient.top}, ${ground.gradient.bottom})`,
          "--lyrics-dim": ground.dim,
        }
  ) as CSSProperties;
  return (
    <section
      ref={root}
      className="now-playing"
      role="dialog"
      tabIndex={-1}
      aria-label={text.playbackText.nowPlaying}
      style={style}
      data-testid="now-playing"
    >
      <button
        className="icon-button now-playing-close"
        aria-label={text.playbackText.closeNowPlaying}
        title={text.playbackText.closeNowPlaying}
        onClick={onClose}
      >
        <Icon name="back" />
      </button>
      <div className="now-playing-song">
        <Artwork
          large
          full
          kind="song"
          id={song?.id}
          hash={song?.artworkHash}
          url={song?.artworkUrl}
        />
        <div className="now-playing-copy">
          <h1 className="truncate">{song?.title ?? text.desktopLayout.nothingPlaying}</h1>
          {song && <ArtistCredit row={song} links={links} className="truncate secondary" />}
          {song?.album && <AlbumCredit row={song} links={links} className="truncate tertiary" />}
          {song && actions}
        </div>
      </div>
      <div className="now-playing-lyrics">
        <LyricsView
          song={song}
          positionMs={view?.status.positionMs ?? 0}
          onSeek={(positionMs) => run(window.wave.playback.seek(positionMs))}
          geniusAccess={geniusAccess}
          onGeniusSignIn={onGeniusSignIn}
          notify={notify}
          lineIdPrefix="now-playing-lyric"
        />
      </div>
    </section>
  );
}
