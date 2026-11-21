/**
 * The playing song's lyrics, in the side panel and in Now Playing: the sung line of synced
 * lyrics lights, word by word and followed by the scroll with Karaoke on, and a click (or
 * Enter on the focused line) seeks to one. Main decides what shows
 * (`window.wave.lyrics.song`): the file's own, else LRCLIB's or YT Music's.
 */
import {
  currentLyricIndex,
  currentLyricWordIndex,
  desktopKey,
  geniusLineReferents,
  geniusLineSegments,
  karaokeLyricLines,
  placeGeniusReferents,
  ytTrackId,
  type KaraokeLyricLine,
} from "@wave/core";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

import type { BrowseRow } from "../../shared/browse.ts";
import type { SongLyrics } from "../../shared/lyrics.ts";
import { GeniusAbout, GeniusAnnotations, MoreInsights } from "./GeniusInsights.tsx";
import { KaraokeButton, KaraokeWords } from "./Karaoke.tsx";
import { pressOf } from "./keys.ts";
import { LineTranslation, TranslateButton, TranslationNote } from "./LyricsTranslation.tsx";
import { rovingTarget, scrollToRow } from "./rovingList.ts";
import { labels, text } from "./text.ts";
import { useKaraokeOn, useLyricsFollow } from "./useKaraoke.ts";
import {
  useLyricsTranslation,
  useTranslateOn,
  type LyricsTranslationView,
} from "./useLyricsTranslation.ts";
import { useSongGenius, type GeniusAccess } from "./useSongGenius.ts";

/** The queue track id main knows a song by (`QueueEntry.trackId`). */
export const trackIdOf = (song: BrowseRow): string =>
  song.videoId !== undefined ? ytTrackId(song.videoId) : String(song.id);

/** Answers already shown, so the panel and Now Playing don't ask twice; a failure isn't kept. */
const known = new Map<string, SongLyrics>();

function useSongLyrics(trackId: string | null) {
  const [answer, setAnswer] = useState<{ trackId: string; lyrics: SongLyrics }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (trackId === null || known.has(trackId)) return;
    let current = true;
    const done = (lyrics: SongLyrics) => {
      if (lyrics.kind !== "failed") {
        known.set(trackId, lyrics);
        if (known.size > 50) known.delete(known.keys().next().value!);
      }
      if (current) setAnswer({ trackId, lyrics });
    };
    window.wave.lyrics.song(trackId).then(done, () => done({ kind: "failed" }));
    return () => {
      current = false;
    };
  }, [trackId, attempt]);
  const lyrics =
    trackId === null
      ? undefined
      : (known.get(trackId) ?? (answer?.trackId === trackId ? answer.lyrics : undefined));
  return {
    lyrics,
    retry: () => {
      setAnswer(undefined);
      setAttempt((n) => n + 1);
    },
  };
}

function LyricLines({
  lines,
  current,
  onSeek,
  genius,
  translation,
  onGeniusSignIn,
  lineIdPrefix,
  karaoke,
  sungWord,
  shown,
}: {
  readonly lines: readonly { readonly text: string; readonly timeMs?: number }[];
  /** The line being sung, or -1 (before the first line, or unsynced lyrics). */
  readonly current: number;
  readonly onSeek?: ((positionMs: number) => void) | undefined;
  readonly genius: ReturnType<typeof useSongGenius>;
  readonly translation: LyricsTranslationView;
  readonly onGeniusSignIn: () => void;
  readonly lineIdPrefix: string;
  /** With Karaoke on, the synced lines with every word timed; undefined with it off. */
  readonly karaoke: readonly KaraokeLyricLine[] | undefined;
  /** The word being sung in the sung line with Karaoke on, or -1. */
  readonly sungWord: number;
  /** The view is on screen. */
  readonly shown: boolean;
}) {
  /** The keyboard's line, or null while it follows the sung one. */
  const [active, setActive] = useState<number | null>(null);
  const [annotations, setAnnotations] = useState<{
    readonly placement: NonNullable<ReturnType<typeof placeGeniusReferents>>;
    readonly selection:
      | { readonly kind: "line"; readonly index: number }
      | { readonly kind: "referent"; readonly id: number };
  }>();
  const referents = genius.state.kind === "answer" ? genius.state.referents : undefined;
  const placement = useMemo(
    () =>
      referents?.length
        ? placeGeniusReferents(
            lines.map((line) => line.text),
            referents,
          )
        : undefined,
    [lines, referents],
  );
  const selection =
    annotations !== undefined && annotations.placement === placement
      ? annotations.selection
      : undefined;
  const opened =
    selection?.kind === "referent" && placement !== undefined
      ? placement.unplaced.filter(({ id }) => id === selection.id)
      : selection?.kind === "line" && placement !== undefined
        ? geniusLineReferents(placement.lines[selection.index] ?? [])
        : [];
  const focused = active ?? Math.max(0, current);
  // When the lyrics move on their own. Share's line picking tells it `pickStarted` and
  // `pickEnded` through `follow.step`.
  const follow = useLyricsFollow({
    current,
    karaoke: karaoke !== undefined,
    synced: lines.some((line) => line.timeMs !== undefined),
    held: active !== null,
    shown,
  });
  const { scroll } = follow;
  const openLine = useCallback(
    (index: number) => {
      if (placement) setAnnotations({ placement, selection: { kind: "line", index } });
    },
    [placement],
  );
  useEffect(() => {
    if (active === null) return;
    const element = scroll.current;
    const row = element?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (element && row) scrollToRow(element, row, false);
  }, [active, scroll]);
  const seek = (index: number) => {
    const time = lines[index]?.timeMs;
    if (time === undefined || onSeek === undefined) return;
    onSeek(time);
    setActive(null);
    follow.lineTapped(index);
  };
  const key = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    const command = desktopKey(pressOf(event), "list");
    const page = Math.floor((scroll.current?.clientHeight ?? 400) / 40);
    const to = rovingTarget(command, focused, lines.length, page);
    if (to !== undefined) {
      event.preventDefault();
      setActive(to);
    } else if (command === "playRow") {
      event.preventDefault();
      seek(focused);
    } else if (command === "songMenu" && placement?.lines[focused]?.length) {
      event.preventDefault();
      setAnnotations({ placement, selection: { kind: "line", index: focused } });
    }
  };
  return (
    <div
      ref={scroll}
      className="lyrics-scroll"
      onWheel={follow.scrolledByHand}
      onTouchMove={follow.scrolledByHand}
      // A press on the view itself, not on a line: its scrollbar.
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) follow.scrolledByHand();
      }}
      onScroll={follow.scrolled}
    >
      <GeniusAbout state={genius.state} onRetry={genius.retry} onSignIn={onGeniusSignIn} />
      <TranslationNote {...translation} />
      <div
        className="lyric-lines"
        role="listbox"
        aria-label={labels.lyrics}
        tabIndex={0}
        aria-activedescendant={lines.length > 0 ? `${lineIdPrefix}-${focused}` : undefined}
        onKeyDown={key}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setActive(null);
        }}
      >
        {lines.map((line, index) => {
          const highlights = placement?.lines[index];
          const annotated = highlights !== undefined && highlights.length > 0;
          // The sung line's words, lit one by one; a pause between lines has none.
          const words = index === current ? karaoke?.[index]?.words : undefined;
          return (
            <div
              key={index}
              id={`${lineIdPrefix}-${index}`}
              role="option"
              data-line={index}
              aria-label={annotated ? line.text : undefined}
              aria-keyshortcuts={annotated ? "Shift+F10" : undefined}
              aria-selected={index === focused}
              aria-current={index === current ? "true" : undefined}
              className={`lyric-line ${line.timeMs === undefined ? "unsynced" : ""} ${
                index === current ? "sung" : index < current ? "past" : ""
              } ${active === index ? "keyboard" : ""} ${words?.length ? "karaoke" : ""}`}
              onClick={() => seek(index)}
            >
              {words?.length ? (
                <KaraokeWords
                  line={line.text}
                  words={words}
                  sung={sungWord}
                  highlights={highlights}
                  index={index}
                  onAnnotation={openLine}
                />
              ) : annotated ? (
                geniusLineSegments(line.text, highlights).map(({ start, end, referents }) => {
                  const fragment = line.text.slice(start, end);
                  return referents.length === 0 ? (
                    <span key={start}>{fragment}</span>
                  ) : (
                    <button
                      key={start}
                      className="genius-highlight"
                      aria-label={text.playbackText.annotationOn(fragment)}
                      onClick={(event) => {
                        event.stopPropagation();
                        openLine(index);
                      }}
                    >
                      {fragment}
                    </button>
                  );
                })
              ) : (
                line.text || "♪"
              )}
              {/* What sits under a line's words goes here. */}
              <LineTranslation shown={translation.shown} index={index} line={line.text} />
            </div>
          );
        })}
      </div>
      {placement && (
        <MoreInsights
          referents={placement.unplaced}
          onOpen={(id) => setAnnotations({ placement, selection: { kind: "referent", id } })}
        />
      )}
      {opened.length > 0 && (
        <GeniusAnnotations referents={opened} onClose={() => setAnnotations(undefined)} />
      )}
    </div>
  );
}

/** The lyrics of [song] at [positionMs]; [onSeek] moves playback to a line's time. */
export function LyricsView({
  song,
  positionMs,
  onSeek,
  geniusAccess,
  onGeniusSignIn,
  foreground = true,
  lineIdPrefix = "lyric",
}: {
  readonly song: BrowseRow | null;
  readonly positionMs: number;
  readonly onSeek: (positionMs: number) => void;
  readonly geniusAccess: GeniusAccess;
  readonly onGeniusSignIn: () => void;
  readonly foreground?: boolean;
  readonly lineIdPrefix?: string;
}) {
  const trackId = song === null ? null : trackIdOf(song);
  const { lyrics, retry } = useSongLyrics(trackId);
  const lines = useMemo(
    () =>
      lyrics?.kind === "synced"
        ? lyrics.lines
        : lyrics?.kind === "unsynced"
          ? lyrics.lines.map((line) => ({ text: line }))
          : undefined,
    [lyrics],
  );
  const genius = useSongGenius(lines?.length ? trackId : null, song, geniusAccess, foreground);
  const [translateOn, setTranslateOn] = useTranslateOn();
  const translation = useLyricsTranslation(trackId, lines, translateOn);
  const [karaokeOn, setKaraokeOn] = useKaraokeOn();
  // Core gives every word a time: Enhanced LRC's stamps, else its share of the line's span.
  const karaoke = useMemo(
    () => (karaokeOn && lyrics?.kind === "synced" ? karaokeLyricLines(lyrics.lines) : undefined),
    [karaokeOn, lyrics],
  );
  const words = text.playbackText;
  if (song === null) return <p className="lyrics-note">{labels.nothingPlaying}</p>;
  if (lyrics === undefined)
    return (
      <div className="lyrics-skeleton" role="status" aria-label={words.searchingForLyrics}>
        {[72, 54, 86, 40, 64].map((width, index) => (
          <span key={index} style={{ width: `${width}%` }} />
        ))}
      </div>
    );
  if (lyrics.kind === "failed")
    return (
      <div className="lyrics-note" role="status">
        <p>{words.couldntSearchForLyrics}</p>
        <button className="text-button" onClick={retry}>
          {words.tryAgain}
        </button>
      </div>
    );
  if (lyrics.kind === "none")
    return (
      <p className="lyrics-note" role="status">
        {words.noLyrics}
      </p>
    );
  const current = lyrics.kind === "synced" ? currentLyricIndex(lyrics.lines, positionMs) : -1;
  return (
    <div className="lyrics-view">
      {/* The Lyrics view's buttons, for a song with lyrics. */}
      <div className="lyrics-header">
        {/* Plain lyrics have no times to follow. */}
        {lyrics.kind === "synced" && <KaraokeButton on={karaokeOn} onChange={setKaraokeOn} />}
        <TranslateButton on={translateOn} onChange={setTranslateOn} />
      </div>
      <LyricLines
        key={trackId}
        lines={lines ?? []}
        current={current}
        karaoke={karaoke}
        sungWord={currentLyricWordIndex(karaoke?.[current]?.words ?? [], positionMs)}
        shown={foreground}
        onSeek={onSeek}
        genius={genius}
        translation={translation}
        onGeniusSignIn={onGeniusSignIn}
        lineIdPrefix={lineIdPrefix}
      />
    </div>
  );
}
