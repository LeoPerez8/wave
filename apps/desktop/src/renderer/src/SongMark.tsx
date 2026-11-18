import { useEffect, useState } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import { songRowMark, type SongRowMark, type SongState } from "../../shared/songState.ts";
import { Icon } from "./Icon.tsx";
import { text } from "./text.ts";

/** How often a list asks main for its visible songs' downloads and failed files. */
const EVERY_MS = 1_000;

/**
 * The session state of the Library songs [ids] (the rows a list shows), read again each second
 * while the window shows, since a download moves or a file fails without the list changing.
 */
export function useSongStates(ids: readonly number[]): ReadonlyMap<number, SongState> {
  const [states, setStates] = useState<ReadonlyMap<number, SongState>>(new Map());
  const key = ids
    .filter((id) => id > 0)
    .slice(0, 200)
    .join(",");
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const asked = key === "" ? [] : key.split(",").map(Number);
    const poll = async () => {
      try {
        if (asked.length > 0 && !document.hidden) {
          const page = await window.wave.songs.states(asked);
          if (current)
            setStates((previous) => {
              const next = new Map(page.items.map((state) => [state.id, state]));
              return JSON.stringify([...previous]) === JSON.stringify([...next]) ? previous : next;
            });
        }
      } catch {
        // The next read answers.
      } finally {
        if (current) timer = setTimeout(() => void poll(), EVERY_MS);
      }
    };
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key]);
  return states;
}

/** The row's class for its [mark]: a missing song is dimmed, a failed file marked. */
export const markClass = (mark: SongRowMark) =>
  mark.kind === "missing" || mark.kind === "downloading"
    ? "missing-row"
    : mark.kind === "failed"
      ? "failed-row"
      : "";

/** What sits over a song row's picture: Play on hover, or the song's state. */
export function SongMark({ mark, title }: { readonly mark: SongRowMark; readonly title: string }) {
  if (mark.kind === "downloading")
    return (
      <span className="row-play row-mark">
        <span
          className="row-progress"
          role="progressbar"
          aria-label={text.desktopLibrary.downloading(title)}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(mark.progress === null ? {} : { "aria-valuenow": Math.round(mark.progress * 100) })}
        >
          <span style={{ width: `${Math.round((mark.progress ?? 0) * 100)}%` }} />
        </span>
      </span>
    );
  return (
    <span
      className={`row-play ${mark.kind === "failed" ? "row-mark" : ""}`}
      {...(mark.kind === "failed" ? { title: text.desktopLibrary.fileFailed } : {})}
    >
      <Icon
        name={
          mark.kind === "unavailable"
            ? "folder"
            : mark.kind === "missing"
              ? "download"
              : mark.kind === "failed"
                ? "missing"
                : "play"
        }
        size={16}
      />
    </span>
  );
}

/** [row]'s mark in a list of songs, from the [states] main gave. */
export const rowMark = (row: BrowseRow, states: ReadonlyMap<number, SongState>) =>
  songRowMark(row, states.get(row.id));
