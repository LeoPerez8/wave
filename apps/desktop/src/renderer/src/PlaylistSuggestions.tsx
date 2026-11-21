import { PLAYLIST_SHOWN_OFFERS } from "@wave/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  PlaylistSuggestionSlot,
  PlaylistSuggestionsView,
} from "../../shared/playlistSuggestions.ts";
import { Icon } from "./Icon.tsx";
import { albumName, artistName, text } from "./text.ts";
import { Artwork, time } from "./VirtualTable.tsx";
import "./playlistSuggestions.css";

/** How often the section reads its view while something in it loads. */
const LOADING_POLL_MS = 300;
/** How much of the section must show for it to be in sight: its heading. */
const HEADING_PX = 48;

/**
 * A playlist page with its Recommended songs (docs/spec.md, Playlist recommendations): the
 * songs table ([children]), the section below it, and Go to Suggestions while the section is
 * out of sight. The page scrolls as one. Main holds the visit: the page reads its view while
 * it's open and closes it when it leaves. With YT Music off main shows nothing and reads nothing.
 */
export function PlaylistSuggestionsPage({
  playlistId,
  songs,
  sources,
  onError,
  children,
}: {
  readonly playlistId: number;
  /** How many songs the playlist has: with none, the section asks for some first. */
  readonly songs: number;
  /** Changes when the Library or the playlist changed, so the visit renews behind its offers. */
  readonly sources: string;
  readonly onError: () => void;
  readonly children: ReactNode;
}) {
  const [view, setView] = useState<{ id: number; view: PlaylistSuggestionsView }>();
  const [tick, setTick] = useState(0);
  const page = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    let current = true;
    void window.wave.playlistSuggestions
      .view(playlistId, sources)
      .then((next) => current && setView({ id: playlistId, view: next }))
      .catch(onError);
    return () => {
      current = false;
    };
  }, [playlistId, sources, tick, onError]);
  useEffect(
    () => () => void window.wave.playlistSuggestions.close(playlistId).catch(() => {}),
    [playlistId],
  );
  const shown = view?.id === playlistId && view.view.shown ? view.view : null;
  const waiting =
    shown !== null && (shown.loading || shown.slots.some((slot) => slot.kind === "busy"));
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setTick((n) => n + 1), LOADING_POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, tick]);
  // Go to Suggestions shows while the section is below what the page shows.
  const hasSection = shown !== null;
  useEffect(() => {
    const target = section.current;
    if (!hasSection || target === null || page.current === null) return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setAway(
          entry !== undefined &&
            !entry.isIntersecting &&
            entry.boundingClientRect.top > (entry.rootBounds?.bottom ?? 0),
        ),
      // In sight once its heading shows, not when its top edge peeks in.
      { root: page.current, rootMargin: `0px 0px -${HEADING_PX}px 0px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasSection]);
  const again = () => setTick((n) => n + 1);
  const run = (work: Promise<unknown>) => void work.then(again, onError);
  const t = text.playlists;
  return (
    <div className="playlist-page" ref={page} data-testid="playlist-page">
      {children}
      {shown && (
        <section
          ref={section}
          className="playlist-suggestions"
          aria-labelledby="playlist-suggestions-title"
          data-testid="playlist-suggestions"
        >
          <header className="playlist-suggestions-head">
            <h2 id="playlist-suggestions-title">{t.recommendedSongs}</h2>
            {shown.loading && <span className="secondary">{t.loading}</span>}
            {!shown.loading && shown.error !== "load" && songs > 0 && (
              <button
                className="text-button"
                onClick={() => run(window.wave.playlistSuggestions.refresh(playlistId))}
              >
                {t.refreshRecommendations}
              </button>
            )}
          </header>
          <Slots
            view={shown}
            onAdd={(key) => run(window.wave.playlistSuggestions.add(playlistId, key))}
            onDismiss={(key) => run(window.wave.playlistSuggestions.dismiss(playlistId, key))}
            onRefill={() => run(window.wave.playlistSuggestions.retry(playlistId, true))}
          />
          {shown.error === "load" && (
            <p className="yt-quiet secondary" role="status">
              {text.playbackText.couldntLoadRecommendations}
              <button
                className="text-button"
                onClick={() => run(window.wave.playlistSuggestions.retry(playlistId, false))}
              >
                {t.tryAgain}
              </button>
            </p>
          )}
          {shown.error === "save" && (
            <p className="yt-quiet secondary" role="status">
              {t.couldntSaveChoice}
            </p>
          )}
          {!shown.loading && shown.error === null && shown.slots.length === 0 && (
            <p className="yt-quiet secondary" role="status">
              {songs === 0 ? t.addSongsForRecommendations : t.noMoreMatching}
            </p>
          )}
        </section>
      )}
      {shown?.offered && away && (
        <button
          className="go-to-suggestions"
          onClick={() => section.current?.scrollIntoView({ block: "start" })}
        >
          <Icon name="down" size={14} />
          {t.goToSuggestions}
        </button>
      )}
    </div>
  );
}

/** The section's slots, each in its place: an offer, its placeholder, or a retry. */
function Slots({
  view,
  onAdd,
  onDismiss,
  onRefill,
}: {
  readonly view: Extract<PlaylistSuggestionsView, { shown: true }>;
  readonly onAdd: (key: string) => void;
  readonly onDismiss: (key: string) => void;
  readonly onRefill: () => void;
}) {
  const t = text.playlists;
  if (view.loading && !view.slots.some((slot) => slot.kind === "offer"))
    return (
      <div className="suggestion-list" role="status" aria-label={t.loadingRecommended}>
        {Array.from({ length: PLAYLIST_SHOWN_OFFERS }, (_, i) => (
          <div key={i} className="suggestion-row suggestion-placeholder" />
        ))}
      </div>
    );
  const slot = (item: PlaylistSuggestionSlot, index: number) => {
    if (item.kind === "busy")
      return (
        <div
          key={`busy-${index}`}
          role="listitem"
          aria-busy="true"
          aria-label={
            item.title === null
              ? t.loadingAnother
              : item.action === "add"
                ? t.adding(item.title)
                : t.dismissing(item.title)
          }
          className="suggestion-row suggestion-placeholder"
        />
      );
    if (item.kind === "unfilled")
      return (
        <div key={`unfilled-${index}`} role="listitem" className="suggestion-row suggestion-line">
          <span className="secondary">{t.savedButNoAnother}</span>
          <button className="text-button" onClick={onRefill}>
            {t.tryAgain}
          </button>
        </div>
      );
    const { row } = item;
    return (
      <div key={item.key} role="listitem" className="yt-list-item suggestion-row">
        <div
          className="table-row table-columns yt-row"
          aria-label={[row.title, artistName(row.artist)].filter(Boolean).join(", ")}
        >
          <span className="title-cell">
            <span className="row-picture">
              <Artwork hash={row.artworkHash} url={row.artworkUrl} />
            </span>
            <span className="truncate">{row.title}</span>
          </span>
          <span className="truncate secondary">{artistName(row.artist)}</span>
          <span className="album-column truncate secondary">{albumName(row.album)}</span>
          <span className="star-column" />
          <span className="time-column secondary">
            {row.durationMs > 0 ? time(row.durationMs) : ""}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label={t.addRecommendation(row.title)}
          title={t.addRecommendation(row.title)}
          disabled={view.loading}
          onClick={() => onAdd(item.key)}
        >
          <Icon name="add" size={16} />
        </button>
        <button
          className="icon-button"
          aria-label={t.dismissRecommendation(row.title)}
          title={t.dismissRecommendation(row.title)}
          disabled={view.loading}
          onClick={() => onDismiss(item.key)}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  };
  return (
    <div className="suggestion-list" role="list" aria-label={t.recommendedSongs}>
      {view.slots.map(slot)}
    </div>
  );
}
