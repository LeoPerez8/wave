/**
 * The playing song's lyrics, in the side panel and in Now Playing: synced lines follow playback
 * and a click (or Enter on the focused line) seeks to one. Main decides what shows
 * (`window.wave.lyrics.song`): the file's own, else LRCLIB's or YT Music's.
 */
import { currentLyricIndex, desktopKey, ytTrackId } from "@wave/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { BrowseRow } from "../../shared/browse.ts";
import type { SongLyrics } from "../../shared/lyrics.ts";
import { pressOf } from "./keys.ts";
import { rovingTarget, scrollToRow } from "./rovingList.ts";
import { labels, text } from "./text.ts";

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

/** After the owner scrolls the lyrics, they stay where they put them this long. */
const HOLD_AFTER_SCROLL_MS = 4000;

function LyricLines({
  lines,
  current,
  onSeek,
}: {
  readonly lines: readonly { readonly text: string; readonly timeMs?: number }[];
  /** The line being sung, or -1 (before the first line, or unsynced lyrics). */
  readonly current: number;
  readonly onSeek?: ((positionMs: number) => void) | undefined;
}) {
  const list = useRef<HTMLDivElement>(null);
  /** The keyboard's line, or null while it follows the sung one. */
  const [active, setActive] = useState<number | null>(null);
  const scrolled = useRef(0);
  const focused = active ?? Math.max(0, current);
  useEffect(() => {
    const element = list.current;
    const row = element?.querySelector<HTMLElement>(`[data-line="${current}"]`);
    if (!element || !row || active !== null) return;
    if (Date.now() - scrolled.current < HOLD_AFTER_SCROLL_MS) return;
    scrollToRow(element, row, true, "smooth");
  }, [current, active]);
  useEffect(() => {
    if (active === null) return;
    const element = list.current;
    const row = element?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (element && row) scrollToRow(element, row, false);
  }, [active]);
  const seek = (index: number) => {
    const time = lines[index]?.timeMs;
    if (time === undefined || onSeek === undefined) return;
    onSeek(time);
    setActive(null);
    scrolled.current = 0;
  };
  const key = (event: KeyboardEvent) => {
    const command = desktopKey(pressOf(event), "list");
    const page = Math.floor((list.current?.clientHeight ?? 400) / 40);
    const to = rovingTarget(command, focused, lines.length, page);
    if (to !== undefined) {
      event.preventDefault();
      setActive(to);
    } else if (command === "playRow") {
      event.preventDefault();
      seek(focused);
    }
  };
  return (
    <div
      ref={list}
      className="lyric-lines"
      role="listbox"
      aria-label={labels.lyrics}
      tabIndex={0}
      aria-activedescendant={lines.length > 0 ? `lyric-${focused}` : undefined}
      onKeyDown={key}
      onWheel={() => (scrolled.current = Date.now())}
      onBlur={() => setActive(null)}
    >
      {lines.map((line, index) => (
        <div
          key={index}
          id={`lyric-${index}`}
          role="option"
          data-line={index}
          aria-selected={index === focused}
          aria-current={index === current ? "true" : undefined}
          className={`lyric-line ${line.timeMs === undefined ? "unsynced" : ""} ${
            index === current ? "sung" : index < current ? "past" : ""
          } ${active === index ? "keyboard" : ""}`}
          onClick={() => seek(index)}
        >
          {line.text || "♪"}
        </div>
      ))}
    </div>
  );
}

/** The lyrics of [song] at [positionMs]; [onSeek] moves playback to a line's time. */
export function LyricsView({
  song,
  positionMs,
  onSeek,
}: {
  readonly song: BrowseRow | null;
  readonly positionMs: number;
  readonly onSeek: (positionMs: number) => void;
}) {
  const { lyrics, retry } = useSongLyrics(song === null ? null : trackIdOf(song));
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
  if (lyrics.kind === "unsynced")
    return <LyricLines lines={lyrics.lines.map((line) => ({ text: line }))} current={-1} />;
  return (
    <LyricLines
      lines={lyrics.lines}
      current={currentLyricIndex(lyrics.lines, positionMs)}
      onSeek={onSeek}
    />
  );
}
