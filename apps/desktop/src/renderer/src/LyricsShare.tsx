/**
 * Share in the Lyrics view (docs/spec.md, Sharing lyrics): its button, the bar above the lines
 * while they're picked (Core's `tapLyricLine` decides each click), and the card's preview, where
 * a click on the card moves to the cover's next colour and Save Image or Copy Image draw it.
 */
import {
  LYRIC_CARD_FALLBACK,
  LYRIC_CARD_LAYOUT,
  MAX_SHARED_LYRIC_LINES,
  logoIconPaths,
  lyricCardFileName,
  lyricCardInk,
  lyricCardLayout,
  nextLyricCardColour,
  withOpacity,
} from "@wave/core";
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";

import type { BrowseRow } from "../../shared/browse.ts";
import { CARD_WIDTH } from "../../shared/cards.ts";
import { CardImageActions } from "./CardImageActions.tsx";
import { Icon } from "./Icon.tsx";
import { text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";
import "./lyricsShare.css";

/** What a lyrics card shows. */
export interface LyricCardContent {
  readonly song: BrowseRow;
  /** The picked lines, in order (Core's `sharedLyricLines`). */
  readonly lines: readonly string[];
  /** The colours a click cycles through, the first to start with (Core's `lyricCardColours`). */
  readonly colours: readonly string[];
}

/** Share, after Karaoke and Translate in the Lyrics view's header: it starts picking lines. */
export function ShareLyricsButton({ onClick }: { readonly onClick: () => void }) {
  const label = text.playbackText.shareLyrics;
  return (
    <button className="icon-button" aria-label={label} title={label} onClick={onClick}>
      <Icon name="share" />
    </button>
  );
}

/** The row above the lyrics while Share picks lines: Cancel, how many, and Next. */
export function PickingBar({
  count,
  onCancel,
  onNext,
}: {
  readonly count: number;
  readonly onCancel: () => void;
  readonly onNext: () => void;
}) {
  const words = text.playbackText;
  return (
    <div className="lyrics-picking" role="toolbar" aria-label={words.shareLyrics}>
      <button className="text-button" onClick={onCancel}>
        {words.cancel}
      </button>
      <span className="lyrics-picking-count" aria-live="polite">
        {count === 0
          ? words.selectUpToValueLines(MAX_SHARED_LYRIC_LINES)
          : words.valueOfValue(count, MAX_SHARED_LYRIC_LINES)}
      </span>
      <button className="text-button" onClick={onNext} disabled={count === 0}>
        {words.next}
      </button>
    </div>
  );
}

/** Wave's logo, its two waves stroked in [colour], in a [size] square. */
function WaveMark({ size, colour }: { readonly size: number; readonly colour: string }) {
  const paths = logoIconPaths({ size, inset: 0 });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {[paths.top, paths.bottom].map((d) => (
        <path
          key={d}
          d={d}
          stroke={colour}
          strokeWidth={paths.stroke}
          strokeLinecap="round"
          fill="none"
        />
      ))}
    </svg>
  );
}

/**
 * The card at its image's size, 1080 px wide and as tall as Core's `lyricCardLayout` says for
 * its lines: solid in [colour], the cover with the title and artist at the top, the lines large
 * and bold, and the Wave mark, laid out as the phone's.
 */
function LyricCard({
  content,
  colour,
  scale,
  ref,
}: {
  readonly content: LyricCardContent;
  readonly colour: string;
  readonly scale: number;
  readonly ref: Ref<HTMLDivElement>;
}) {
  const { margin, header, headerGap, footer, footerGap, lineHeight, lineGap } = LYRIC_CARD_LAYOUT;
  const width = CARD_WIDTH;
  const shape = lyricCardLayout(content.lines);
  const ink = lyricCardInk(colour);
  const faded = withOpacity(ink, 0.72);
  const unit = width / 100;
  const cover = unit * 15;
  const size = shape.textSize * width;
  const { song } = content;
  return (
    <div
      ref={ref}
      className="lyric-card"
      data-testid="lyric-card"
      style={{
        width,
        height: Math.round(width * shape.aspect),
        padding: width * margin,
        backgroundColor: colour,
        color: ink,
        transform: `scale(${scale})`,
      }}
    >
      <div className="lyric-card-head" style={{ height: width * header, gap: unit * 3.5 }}>
        <span
          className="lyric-card-cover"
          style={{
            width: cover,
            height: cover,
            borderRadius: unit * 1.5,
            backgroundColor: withOpacity(ink, 0.16),
            color: faded,
          }}
        >
          <Artwork
            large
            full
            kind="song"
            id={song.id}
            hash={song.artworkHash}
            url={song.artworkUrl}
          />
        </span>
        <div className="lyric-card-song">
          <p
            className="lyric-card-title"
            style={{ fontSize: unit * 4.6, lineHeight: `${unit * 5.8}px` }}
          >
            {song.title || text.playbackText.unknownTitle}
          </p>
          <p
            className="lyric-card-artist"
            style={{ color: faded, fontSize: unit * 4, lineHeight: `${unit * 5.4}px` }}
          >
            {song.artist || text.playbackText.unknownArtist}
          </p>
        </div>
      </div>
      <div
        className="lyric-card-lines"
        style={{ marginTop: width * headerGap, gap: size * lineGap }}
      >
        {content.lines.map((line, at) => (
          <p
            // Lines never reorder while the card shows.
            key={at}
            className="lyric-card-line"
            style={{
              fontSize: size,
              lineHeight: `${size * lineHeight}px`,
              letterSpacing: -size * 0.01,
            }}
          >
            {line}
          </p>
        ))}
      </div>
      <div className="lyric-card-space" style={{ minHeight: width * footerGap }} />
      <div
        className="lyric-card-mark"
        style={{ height: width * footer, gap: unit * 1.5, color: faded }}
      >
        <WaveMark size={unit * 6} colour={faded} />
        <span style={{ fontSize: unit * 3.6 }}>Wave</span>
      </div>
    </div>
  );
}

/**
 * The card's preview over the window, after Next: a click on the card changes its colour, and
 * Save Image and Copy Image under it. Close or Esc goes back to picking lines.
 */
export function LyricCardPreview({
  content,
  notify,
  onClose,
}: {
  readonly content: LyricCardContent;
  readonly notify: (message: string) => void;
  readonly onClose: () => void;
}) {
  const [colour, setColour] = useState(content.colours[0] ?? LYRIC_CARD_FALLBACK);
  const [scale, setScale] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const closing = useRef(onClose);
  useLayoutEffect(() => {
    closing.current = onClose;
  });
  const height = Math.round(CARD_WIDTH * lyricCardLayout(content.lines).aspect);

  // Focus moves in, and back where it was once the preview closes.
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // The window's keys are the preview's while it shows: Esc closes it, Tab stays in it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closing.current();
        return;
      }
      if (event.key !== "Tab") return;
      const buttons = [...(dialog.current?.querySelectorAll("button:not(:disabled)") ?? [])];
      const at = buttons.indexOf(document.activeElement as Element);
      const next = buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
      event.preventDefault();
      event.stopPropagation();
      if (next instanceof HTMLElement) next.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useLayoutEffect(() => {
    const element = stage.current!;
    const fit = () =>
      setScale(
        Math.min(1, element.clientWidth / CARD_WIDTH, element.clientHeight / Math.max(1, height)),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [height]);

  const share = text.share;
  const preview = (
    <div
      ref={dialog}
      className="lyric-card-preview"
      role="dialog"
      aria-modal="true"
      aria-label={text.playbackText.shareLyrics}
      tabIndex={-1}
    >
      <div className="lyric-card-preview-head">
        <button
          className="icon-button"
          aria-label={share.close}
          title={share.close}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div ref={stage} className="lyric-card-stage">
        <button
          className="lyric-card-frame"
          aria-label={share.lyricsCard}
          title={share.changesColour}
          style={{ width: CARD_WIDTH * scale, height: height * scale }}
          onClick={() => setColour((current) => nextLyricCardColour(content.colours, current))}
        >
          <LyricCard ref={card} content={content} colour={colour} scale={scale} />
        </button>
      </div>
      <p className="lyric-card-hint">
        {content.colours.length > 1 ? share.tapToChangeColour : " "}
      </p>
      <CardImageActions
        card={() => card.current}
        fileName={() => lyricCardFileName(content.song.title, new Date())}
        notify={notify}
      />
    </div>
  );
  // In the shell, which holds the window's colours, over the panel and Now Playing alike.
  return createPortal(preview, document.querySelector(".desktop-shell") ?? document.body);
}
