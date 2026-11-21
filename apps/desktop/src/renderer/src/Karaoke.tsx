/** Karaoke's pieces of the Lyrics view: its header button and the sung line's words. */
import { geniusLineSegments, type GeniusHighlight, type LyricWord } from "@wave/core";
import { memo, useMemo } from "react";

import { Icon } from "./Icon.tsx";
import { text } from "./text.ts";

/** Turns word by word lighting on and off, for every song until it's turned off. */
export function KaraokeButton({
  on,
  onChange,
}: {
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  const label = text.playbackText.karaoke;
  return (
    <button
      className="icon-button lyrics-karaoke"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      <Icon name="karaoke" size={18} />
    </button>
  );
}

const NO_HIGHLIGHTS: readonly GeniusHighlight[] = [];

/**
 * The sung line's words with Karaoke on: those sung up to [sung] (Core's
 * `currentLyricWordIndex`) lit, the rest dim, over Genius's [highlights]. Each word carries the
 * spaces after it, so the line wraps as the plain one does. It renders once a word: the
 * playback position never reaches it.
 */
export const KaraokeWords = memo(function KaraokeWords({
  line,
  words,
  sung,
  highlights = NO_HIGHLIGHTS,
  index,
  onAnnotation,
}: {
  readonly line: string;
  readonly words: readonly LyricWord[];
  readonly sung: number;
  readonly highlights?: readonly GeniusHighlight[] | undefined;
  readonly index: number;
  /** Opens the annotations of the line at [index]. */
  readonly onAnnotation: (index: number) => void;
}) {
  const segments = useMemo(
    () =>
      geniusLineSegments(
        line,
        highlights,
        words.map((word) => word.start),
      ),
    [line, highlights, words],
  );
  return segments.map(({ start, end, word, referents }) => {
    const fragment = line.slice(start, end);
    const lit = word >= 0 && word <= sung ? "karaoke-word lit" : "karaoke-word";
    return referents.length === 0 ? (
      <span key={start} className={lit}>
        {fragment}
      </span>
    ) : (
      <button
        key={start}
        className={`genius-highlight ${lit}`}
        aria-label={text.playbackText.annotationOn(fragment)}
        onClick={(event) => {
          event.stopPropagation();
          onAnnotation(index);
        }}
      >
        {fragment}
      </button>
    );
  });
});
