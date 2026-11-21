import {
  formatNumber,
  RECAP_SLIDE_MS,
  recapAutoForward,
  recapBack,
  recapCardFileName,
  recapForward,
  recapTitle,
  type RecapColour,
  type RecapPeriod,
} from "@wave/core";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CARD_HEIGHT, CARD_WIDTH } from "../../shared/cards.ts";
import type { DesktopRecap, RecapStory, StatsRow } from "../../shared/stats.ts";
import { CardImageActions } from "./CardImageActions.tsx";
import { Icon } from "./Icon.tsx";
import { language, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";
import "./recap.css";

/** Each story's backdrop: a Recap colour, white ink on it, as the phone's. */
const BACKDROP: Record<RecapStory["kind"], RecapColour> = {
  minutes: "indigo",
  topSongs: "pink",
  topArtists: "purple",
  topAlbum: "blue",
  topGenres: "orange",
  habits: "green",
  discovered: "red",
  summary: "indigo",
};

/** A Recap's tile and Home's card: purple for a year, indigo for a month. */
export const recapColour = (period: RecapPeriod): RecapColour =>
  period.kind === "year" ? "purple" : "indigo";

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** A row's picture: a song's or album's cover, or an artist's image. */
function Picture({
  row,
  kind,
  className,
}: {
  readonly row: StatsRow;
  readonly kind: "song" | "album" | "artist";
  readonly className: string;
}) {
  return (
    <span className={`recap-picture ${className}`}>
      <Artwork
        kind={kind}
        id={row.id > 0 ? row.id : undefined}
        hash={row.artworkHash}
        url={row.artworkUrl}
        artist={kind === "artist"}
        large
      />
    </span>
  );
}

/** One line of a story, rising in after [step] others. */
function Rise({ step, children }: { readonly step: number; readonly children: ReactNode }) {
  return (
    <div className="recap-rise" style={{ animationDelay: `${step * 120}ms` }}>
      {children}
    </div>
  );
}

interface Line {
  readonly key: string;
  readonly picture?: ReactNode;
  readonly title: string;
  readonly detail?: string;
}

/** A story's numbered lines, ranked from [firstRank] (#2 under a #1 of its own). */
function RankedLines({
  lines,
  firstRank,
}: {
  readonly lines: readonly Line[];
  readonly firstRank: number;
}) {
  return (
    <ol className="recap-lines">
      {lines.map((line, index) => (
        <li
          key={line.key}
          className="recap-rise"
          style={{ animationDelay: `${(index + 2) * 120}ms` }}
        >
          <span className="recap-rank">{index + firstRank}</span>
          {line.picture}
          <span className="recap-line-text">
            <strong>{line.title}</strong>
            {line.detail !== undefined && <span className="recap-quiet">{line.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

const artistLine = (row: StatsRow): Line => ({
  key: row.key,
  picture: <Picture row={row} kind="artist" className="recap-picture-line" />,
  title: row.title,
  detail: text.stats.plays(row.countedPlays),
});

/** The first place of a ranked story: "#1 · 12 plays". */
const first = (detail: string) => `#1 · ${detail}`;

function Story({ period, story }: { readonly period: RecapPeriod; readonly story: RecapStory }) {
  const strings = text.recap;
  switch (story.kind) {
    case "minutes":
      return (
        <>
          <Rise step={0}>
            <p className="recap-heading">{strings.listenedIn(period)}</p>
          </Rise>
          <Rise step={1}>
            <p className="recap-figure recap-figure-large">
              {formatNumber(language, story.minutes)}
            </p>
          </Rise>
          <Rise step={2}>
            <p className="recap-title">{strings.minutes(story.minutes)}</p>
          </Rise>
        </>
      );
    case "topSongs": {
      const [top, ...rest] = story.songs;
      if (top === undefined) return null;
      return (
        <>
          <Rise step={0}>
            <p className="recap-heading">{strings.topSongs}</p>
          </Rise>
          <Rise step={1}>
            <Picture row={top} kind="song" className="recap-picture-top" />
            <p className="recap-quiet recap-small">{first(text.stats.plays(top.countedPlays))}</p>
            <p className="recap-title">{top.title}</p>
            <p className="recap-quiet">{top.artist}</p>
          </Rise>
          <RankedLines
            firstRank={2}
            lines={rest.map((row) => ({
              key: row.key,
              title: row.title,
              detail: `${row.artist} · ${text.stats.plays(row.countedPlays)}`,
            }))}
          />
        </>
      );
    }
    case "topArtists": {
      const [top, ...rest] = story.artists;
      if (top === undefined) return null;
      return (
        <>
          <Rise step={0}>
            <p className="recap-heading">{strings.topArtists}</p>
          </Rise>
          <Rise step={1}>
            <Picture row={top} kind="artist" className="recap-picture-top" />
            <p className="recap-quiet recap-small">{first(text.stats.plays(top.countedPlays))}</p>
            <p className="recap-title">{top.title}</p>
          </Rise>
          <RankedLines firstRank={2} lines={rest.map(artistLine)} />
        </>
      );
    }
    case "topAlbum":
      return (
        <>
          <Rise step={0}>
            <p className="recap-heading">{strings.topAlbum}</p>
          </Rise>
          <Rise step={1}>
            <Picture row={story.album} kind="album" className="recap-picture-album" />
          </Rise>
          <Rise step={2}>
            <p className="recap-title">{story.album.title}</p>
            <p className="recap-quiet">
              {[story.album.artist, text.stats.plays(story.album.countedPlays)]
                .filter((part) => part !== "")
                .join(" · ")}
            </p>
          </Rise>
        </>
      );
    case "topGenres": {
      const [top, ...rest] = story.genres;
      if (top === undefined) return null;
      return (
        <>
          <Rise step={0}>
            <p className="recap-heading">{strings.topGenres}</p>
          </Rise>
          <Rise step={1}>
            <p className="recap-quiet recap-small">
              {first(strings.shareOfPlays(percent(top.share)))}
            </p>
            <p className="recap-figure">{top.family.name}</p>
          </Rise>
          <RankedLines
            firstRank={2}
            lines={rest.map((genre) => ({
              key: genre.family.key,
              title: genre.family.name,
              detail: percent(genre.share),
            }))}
          />
        </>
      );
    }
    case "habits":
      return (
        <>
          <Rise step={0}>
            <p className="recap-heading">{strings.listenedMost}</p>
          </Rise>
          <Rise step={1}>
            <p className="recap-title">{strings.onWeekday(story.peakWeekday)}</p>
            <p className="recap-title">{strings.aroundHour(story.peakHour)}</p>
          </Rise>
          <Rise step={2}>
            <p className="recap-heading recap-gap">{strings.longestStreak}</p>
            <p className="recap-figure">{story.longestStreakDays}</p>
            <p className="recap-heading">{strings.streakDays(story.longestStreakDays)}</p>
          </Rise>
        </>
      );
    case "discovered":
      return (
        <>
          <Rise step={0}>
            <p className="recap-heading">{strings.discovered}</p>
          </Rise>
          <Rise step={1}>
            <p className="recap-figure">{formatNumber(language, story.count)}</p>
            <p className="recap-title">{strings.newArtists(story.count)}</p>
          </Rise>
          <RankedLines firstRank={1} lines={story.artists.map(artistLine)} />
        </>
      );
    case "summary": {
      const top = story.artists[0];
      const column = (heading: string, names: readonly string[]) =>
        names.length > 0 && (
          <div className="recap-column">
            <p className="recap-quiet recap-small">{heading}</p>
            <ol>
              {names.map((name, index) => (
                // A name can repeat (two songs with one title); the rank can't.
                <li key={index}>
                  <span className="recap-rank">{index + 1}</span>
                  <strong>{name}</strong>
                </li>
              ))}
            </ol>
          </div>
        );
      return (
        <>
          {top !== undefined && (
            <Rise step={0}>
              <Picture row={top} kind="artist" className="recap-picture-summary" />
            </Rise>
          )}
          <Rise step={1}>
            <div className="recap-columns">
              {column(
                strings.summaryTopArtists,
                story.artists.map((row) => row.title),
              )}
              {column(
                strings.summaryTopSongs,
                story.songs.map((row) => row.title),
              )}
            </div>
          </Rise>
          <Rise step={2}>
            <div className="recap-columns">
              <div className="recap-column">
                <p className="recap-quiet recap-small">{strings.minutesListened}</p>
                <p className="recap-title">{formatNumber(language, story.minutes)}</p>
              </div>
              {story.genre !== null && (
                <div className="recap-column">
                  <p className="recap-quiet recap-small">{strings.topGenre}</p>
                  <p className="recap-title">{story.genre}</p>
                </div>
              )}
            </div>
          </Rise>
        </>
      );
    }
  }
}

/**
 * A Recap's stories, filling the window: each stays `RECAP_SLIDE_MS` and the summary, the last,
 * stays until it is closed. Right and Left move between them, Esc closes. The story is a card
 * of a shared image's size, scaled to the window, so Save Image and Copy Image give what shows.
 */
export function RecapViewer({
  recap,
  onClose,
  notify,
}: {
  readonly recap: DesktopRecap;
  readonly onClose: () => void;
  readonly notify: (message: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [scale, setScale] = useState(0);
  const viewer = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const count = recap.slides.length;
  const story = recap.slides[index]!;
  const title = recapTitle(recap.period, text);
  const colour = `var(--color-recap-${BACKDROP[story.kind]})`;

  const forward = () => {
    const next = recapForward(index, count);
    if (next === null) onClose();
    else setIndex(next);
  };
  const back = () => setIndex(recapBack(index));
  const keys = useRef({ forward, back, onClose });
  useEffect(() => {
    keys.current = { forward, back, onClose };
  });

  // The window's keys are the Recap's while it shows: nothing behind it hears them.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const run =
        event.key === "ArrowRight"
          ? keys.current.forward
          : event.key === "ArrowLeft"
            ? keys.current.back
            : event.key === "Escape"
              ? keys.current.onClose
              : undefined;
      if (run !== undefined) {
        event.preventDefault();
        run();
        return;
      }
      if (event.key !== "Tab") return;
      // Tab stays among the Recap's own buttons.
      const buttons = [...(viewer.current?.querySelectorAll("button:not(:disabled)") ?? [])];
      const at = buttons.indexOf(document.activeElement as Element);
      const next = buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
      event.preventDefault();
      if (next instanceof HTMLElement) next.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    const opener = document.activeElement;
    viewer.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // The story's music follows it; main decides whether anything plays.
  useEffect(() => {
    void window.wave.stats.recapStory(index).catch(() => undefined);
  }, [index]);

  useLayoutEffect(() => {
    const element = stage.current!;
    const fit = () =>
      setScale(Math.min(element.clientWidth / CARD_WIDTH, element.clientHeight / CARD_HEIGHT));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={viewer}
      className="recap-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={text.recap.slidePosition(recap.period, index + 1, count)}
      tabIndex={-1}
      style={{ backgroundColor: colour }}
      data-testid="recap-viewer"
      data-story={story.kind}
    >
      <div className="recap-drag" />
      <div className="recap-bars" aria-hidden="true">
        {recap.slides.map((slide, bar) => (
          <span key={`${slide.kind}-${bar}`} className="recap-bar">
            {bar < index ? (
              <span className="recap-bar-fill recap-bar-full" />
            ) : bar === index ? (
              <span
                key={index}
                className="recap-bar-fill recap-bar-running"
                style={{
                  animationDuration: `${RECAP_SLIDE_MS}ms`,
                  animationPlayState: held ? "paused" : "running",
                }}
                onAnimationEnd={() => {
                  // The summary's bar fills and it stays.
                  const next = recapAutoForward(index, count);
                  if (next !== null) setIndex(next);
                }}
              />
            ) : null}
          </span>
        ))}
      </div>
      <div className="recap-head">
        <CardImageActions
          card={() => card.current}
          fileName={() => recapCardFileName(title, new Date())}
          notify={notify}
          onBusy={setHeld}
        />
        <button className="icon-button" aria-label={text.recap.close} onClick={onClose}>
          <Icon name="missing" />
        </button>
      </div>
      <div className="recap-body">
        <button
          className="icon-button recap-nav"
          aria-label={text.recap.previousSlide}
          onClick={back}
        >
          <Icon name="back" />
        </button>
        <div ref={stage} className="recap-stage">
          <div
            className="recap-frame"
            style={{ width: CARD_WIDTH * scale, height: CARD_HEIGHT * scale }}
          >
            <div
              ref={card}
              className="recap-card"
              style={{ transform: `scale(${scale})`, backgroundColor: colour }}
            >
              <p className="recap-card-title">
                <strong>{title}</strong>
                <span className="recap-quiet">{text.recap.kinds[recap.period.kind]}</span>
              </p>
              <div className="recap-story" key={index}>
                <Story period={recap.period} story={story} />
              </div>
              <p className="recap-mark">Wave</p>
            </div>
          </div>
        </div>
        <button
          className="icon-button recap-nav"
          aria-label={text.recap.nextSlide}
          onClick={forward}
        >
          <Icon name="forward" />
        </button>
      </div>
    </div>
  );
}
