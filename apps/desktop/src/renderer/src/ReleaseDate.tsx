/**
 * Release Date (docs/spec.md, "Release date"): the date Wave has for a song, and three fields to
 * type another, read by Core's rule as the phone reads them (a year, a month and year, or a full
 * date). Main keeps it as the phone does, so it syncs and a playlist's Release date sort uses it.
 */
import { formatReleaseDate, readTypedReleaseDate, type TypedReleaseDateFields } from "@wave/core";
import { useEffect, useRef, useState } from "react";
import type { ReleaseDateView } from "../../shared/releaseDates.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import { trapTab } from "./SongActions.tsx";
import { language, text } from "./text.ts";
import "./playlists.css";
import "./releaseDate.css";

/** A Library song's one-song target, or a streamed song's video id. */
export type ReleaseDateSong = SongTarget | string;

const pad = (n: number) => String(n).padStart(2, "0");
/** The computer's date today, `YYYY-MM-DD`. */
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** The fields filled with [date] (`1985`, `1985-06` or `1985-06-21`), else empty. */
const fieldsOf = (date: string | null): TypedReleaseDateFields => {
  const [year = "", month = "", day = ""] = date?.split("-") ?? [];
  return { year, month, day };
};

export function ReleaseDateDialog({
  song,
  onClose,
  failed,
}: {
  readonly song: ReleaseDateSong;
  /** Closes the dialog; [saved] when a date was kept or cleared. */
  readonly onClose: (saved: boolean) => void;
  readonly failed: (message?: string) => void;
}) {
  const [view, setView] = useState<ReleaseDateView>();
  const [fields, setFields] = useState<TypedReleaseDateFields>(fieldsOf(null));
  /** What main said no to: the account can't keep one more typed date. */
  const [full, setFull] = useState(false);
  // The window's handlers change as it renders; the song alone reads its date again.
  const given = useRef({ onClose, failed });
  useEffect(() => {
    given.current = { onClose, failed };
  });
  useEffect(() => {
    let current = true;
    void window.wave.releaseDates
      .view(song)
      .then((read) => {
        if (!current) return;
        setView(read);
        setFields(fieldsOf(read.date));
      })
      .catch(() => {
        if (!current) return;
        given.current.failed();
        given.current.onClose(false);
      });
    return () => {
      current = false;
    };
  }, [song]);
  const playlists = text.playlists;
  const read = readTypedReleaseDate(fields, today());
  const keep = (typed: TypedReleaseDateFields | null) => {
    void window.wave.releaseDates
      .save(song, typed)
      .then((saved) => {
        if (saved.ok) onClose(true);
        else if (saved.problem === "full") setFull(true);
      })
      .catch(() => failed(playlists.releaseDateCouldntSave));
  };
  const field = (name: keyof TypedReleaseDateFields, label: string, length: number) => (
    <label className="release-date-field">
      <span className="secondary">{label}</span>
      <input
        className="dialog-input"
        inputMode="numeric"
        maxLength={length}
        size={length}
        autoFocus={name === "year"}
        value={fields[name]}
        aria-invalid={!read.ok && read.problem === "impossible"}
        aria-describedby="release-date-problem"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const value = event.target.value;
          setFull(false);
          setFields((before) => ({ ...before, [name]: value }));
        }}
      />
    </label>
  );
  const problem = full
    ? playlists.releaseDateFull
    : !read.ok && read.problem === "impossible"
      ? playlists.releaseDateImpossible
      : null;
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-date-title"
        aria-describedby="release-date-shown"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose(false);
          } else trapTab(event);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (read.ok) keep(fields);
        }}
      >
        <h2 id="release-date-title">{playlists.releaseDateTitle}</h2>
        <p id="release-date-shown" className="secondary">
          {view === undefined
            ? null
            : view.date === null
              ? text.desktopLibrary.releaseDateUnknown
              : text.desktopLibrary.releaseDateKnown(formatReleaseDate(view.date, language))}
        </p>
        {view !== undefined && (
          <>
            <div className="release-date-fields">
              {field("year", playlists.releaseDateYear, 4)}
              {field("month", playlists.releaseDateMonth, 2)}
              {field("day", playlists.releaseDateDay, 2)}
            </div>
            {/* The line is kept so the buttons don't move when a problem shows. */}
            <p
              id="release-date-problem"
              className={problem === null ? "dialog-hint secondary" : "dialog-problem"}
              role="status"
            >
              {problem ?? playlists.releaseDateHint}
            </p>
          </>
        )}
        <div className="dialog-buttons">
          {view?.typed && (
            <button type="button" onClick={() => keep(null)}>
              {playlists.releaseDateClear}
            </button>
          )}
          <button type="button" onClick={() => onClose(false)}>
            {playlists.cancel}
          </button>
          <button type="submit" className="accent" disabled={view === undefined || !read.ok}>
            {playlists.releaseDateSave}
          </button>
        </div>
      </form>
    </div>
  );
}
