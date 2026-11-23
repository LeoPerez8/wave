import {
  formatNumber,
  geniusLyricsSearchRequest,
  type GeniusLyricsHit,
  type SongLookup,
} from "@wave/core";
import { useEffect, useState } from "react";
import { onlineLyricsRows, type GeniusLyricsSearchView } from "../../shared/geniusLyricsSearch.ts";
import { Icon } from "./Icon.tsx";
import { language, text } from "./text.ts";
import type { GeniusAccess } from "./useSongGenius.ts";
import { Artwork } from "./VirtualTable.tsx";

export interface OnlineLyricsProps {
  /** The query, trimmed. */
  readonly query: string;
  /** The Library's results for the query are in: its Lyrics rows are known. */
  readonly ready: boolean;
  /** The songs Search's Lyrics rows show. */
  readonly shown: readonly SongLookup[];
  /** The query names the top result's song by its title and artist: Genius isn't asked (#1470). */
  readonly namesSong: boolean;
  /** "Genius insights" and the Wave account; a change asks again. */
  readonly access: GeniusAccess;
  readonly onSignIn: () => void;
  /** A hit was clicked. */
  readonly onOpen: () => void;
  readonly onError: () => void;
}

/**
 * Search's online lyrics (docs/spec.md, "Lyrics search"): the songs Genius finds for a query
 * of three or more words, asked by main once the typing pauses. A click plays the Library's
 * song or YT Music's, else opens the hit's Genius page; main decides which.
 */
export function OnlineLyrics({
  query,
  ready,
  shown,
  namesSong,
  access,
  onSignIn,
  onOpen,
  onError,
}: OnlineLyricsProps) {
  const [answer, setAnswer] = useState<{ key: string; view: GeniusLyricsSearchView }>();
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<string>();
  const [selected, setSelected] = useState<number>();
  const [opening, setOpening] = useState<number>();
  const request = access === "off" ? null : geniusLyricsSearchRequest(query, true, namesSong);
  const asked = request?.query;
  const delay = request?.delayMs;
  const key = `${access}:${attempt}:${asked}`;
  useEffect(() => {
    if (asked === undefined || !ready) return;
    let current = true;
    const timer = setTimeout(() => {
      void window.wave.lyrics
        .searchOnline(asked)
        .then((view) => current && setAnswer({ key, view }))
        .catch(() => current && setAnswer({ key, view: { status: "failed" } }));
    }, delay);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [asked, delay, ready, key]);
  // The connection coming or going asks again, as the phone follows it.
  useEffect(() => {
    const again = () => setAttempt((count) => count + 1);
    window.addEventListener("online", again);
    window.addEventListener("offline", again);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("offline", again);
    };
  }, []);
  if (asked === undefined || !ready || answer?.key !== key) return null;
  const { view } = answer;
  if (view.status === "disabled" || view.status === "idle") return null;
  const heading = text.playbackText.lyricsOnline;
  if (view.status !== "hits") {
    const signedOut = view.status === "signedOut";
    return (
      <section className="search-section" data-testid="search-online-lyrics" aria-label={heading}>
        <h2>{heading}</h2>
        <div className="genius-note" role="status">
          <span>
            {signedOut
              ? text.playbackText.signInToWaveAccountToSearchLyricsOnline
              : view.status === "offline"
                ? text.playbackText.noConnection
                : text.playbackText.couldntSearchLyricsOnline}
          </span>
          {signedOut ? (
            <button className="text-button" onClick={onSignIn}>
              {text.settings.signIn}
            </button>
          ) : (
            view.status === "failed" && (
              <button className="text-button" onClick={() => setAttempt((count) => count + 1)}>
                {text.playbackText.tryAgain}
              </button>
            )
          )}
        </div>
      </section>
    );
  }
  const { rows, total, more } = onlineLyricsRows(view.hits, shown, expanded === asked);
  if (rows.length === 0) return null;
  const count = formatNumber(language, total);
  const open = (hit: GeniusLyricsHit) => {
    if (opening !== undefined) return;
    setOpening(hit.id);
    onOpen();
    void window.wave.lyrics
      .openOnlineHit(hit.id)
      .then((opened) => opened === "failed" && onError())
      .catch(onError)
      .finally(() => setOpening(undefined));
  };
  return (
    <section className="search-section" data-testid="search-online-lyrics" aria-label={heading}>
      <h2>{`${heading} · ${count}`}</h2>
      <div role="list">
        {rows.map((hit) => (
          <button
            key={hit.id}
            role="listitem"
            className="table-row table-columns search-row"
            data-testid="search-online-lyric"
            aria-selected={selected === hit.id}
            aria-busy={opening === hit.id}
            aria-label={text.playbackText.geniusLyricsResult(hit.title, hit.artist)}
            onClick={() => setSelected(hit.id)}
            onDoubleClick={() => open(hit)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                open(hit);
              }
            }}
          >
            <span className="title-cell">
              <span className="row-picture">
                <Artwork />
                <span className="row-play">
                  <Icon name="play" size={16} />
                </span>
              </span>
              <span className="truncate">{hit.title}</span>
            </span>
            <span className="truncate secondary">{hit.artist}</span>
            <span className="album-column" />
            <span className="star-column" />
            <span className="time-column" />
          </button>
        ))}
      </div>
      {more && (
        <button className="search-more" onClick={() => setExpanded(asked)}>
          {text.playbackText.showAllValue(count)}
        </button>
      )}
    </section>
  );
}
