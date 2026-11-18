import {
  searchOnlineAlways,
  stepYtSection,
  ytSearchQuery,
  ytSectionToggle,
  YT_SECTION_HIDDEN,
  type SearchOnline,
  type YtSong,
} from "@wave/core";
import { useEffect, useReducer, useState, type MouseEvent, type ReactNode } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { YtSearchPage } from "../../shared/yt.ts";
import { Icon } from "./Icon.tsx";
import { labels, text } from "./text.ts";
import { Artwork, time } from "./VirtualTable.tsx";

type SearchSong = YtSong & { readonly row: BrowseRow };

/**
 * Search's Library | Online toggle, the Library's results ([children]) and YouTube Music's songs
 * under them. Core's `stepYtSection` decides when YT Music is asked, as on the phone: when Online
 * is picked, when the Library has nothing for the query, or as you type with Search online set to
 * Always. Hidden while YT Music is off; offline, one quiet line says the results come back online.
 */
export function YtResults({
  query,
  enabled,
  preference,
  libraryHasResults,
  onPlay,
  onDownload,
  onMenu,
  children,
}: {
  readonly query: string;
  readonly enabled: boolean;
  readonly preference: SearchOnline | undefined;
  /** Undefined while the Library is still answering this query. */
  readonly libraryHasResults: boolean | undefined;
  readonly onPlay: (videoId: string) => void;
  /** Downloads a song into the Library; it shows on the Downloads page. */
  readonly onDownload: (videoId: string) => void;
  /** Opens a song's menu (a right-click). */
  readonly onMenu?: ((row: BrowseRow, event: MouseEvent<HTMLElement>) => void) | undefined;
  readonly children: ReactNode;
}) {
  const [section, dispatch] = useReducer(stepYtSection<SearchSong>, YT_SECTION_HIDDEN);
  const [selected, setSelected] = useState<number>();
  const trimmed = query.trim();
  const ready = preference !== undefined;
  useEffect(() => {
    if (preference === undefined) return;
    dispatch({
      type: "typed",
      query: trimmed,
      enabled,
      libraryHasResults,
      // The desktop has no mobile data.
      always: searchOnlineAlways(preference, { onMobileData: false }),
    });
  }, [trimmed, enabled, preference, libraryHasResults]);
  const current =
    enabled && ready && "query" in section && section.query === ytSearchQuery(trimmed);
  const loading = current && section.status === "loading" ? section.query : null;
  const delay = section.status === "loading" ? section.delayMs : 0;
  useEffect(() => {
    if (loading === null) return;
    let active = true;
    const timer = setTimeout(() => {
      void window.wave.yt
        .search(loading)
        .catch((): YtSearchPage => ({
          status: "failed",
          songs: { items: [], offset: 0, total: 0 },
        }))
        .then((page) => {
          if (active) {
            if (page.status === "ok")
              dispatch({
                type: "found",
                query: loading,
                songs: page.songs.items.flatMap((row): SearchSong[] =>
                  row.videoId === undefined
                    ? []
                    : [
                        {
                          videoId: row.videoId,
                          title: row.title,
                          artists: [row.artist],
                          album: row.album,
                          durationMs: row.durationMs,
                          artworkUrl: row.artworkUrl ?? null,
                          explicit: false,
                          row,
                        },
                      ],
                ),
                artists: [],
                albums: [],
              });
            else
              dispatch({
                type: "failed",
                query: loading,
                reason: page.status === "offline" ? "offline" : "failed",
              });
            setSelected(undefined);
          }
        });
    }, delay);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [loading, delay]);
  const pick = ytSectionToggle(section);
  const songs =
    current && section.status === "results" ? section.songs.map((song) => song.row) : [];
  return (
    <>
      {enabled && (
        <div className="search-online-toggle" role="group" aria-label={text.settings.searchOnline}>
          {(["library", "online"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={pick === value}
              disabled={!ready}
              title={value === "library" ? text.library.libraryHint : text.library.onlineHint}
              onClick={() => dispatch({ type: "picked", pick: value })}
            >
              {text.library[value]}
            </button>
          ))}
        </div>
      )}
      {children}
      {current && section.status === "quiet" && (
        <p className="yt-quiet secondary" role="status" data-testid="yt-status">
          {section.reason === "offline" ? labels.ytOffline : labels.ytFailed}
        </p>
      )}
      {current && section.status === "loading" && (
        <p className="yt-quiet secondary" role="status">
          {text.library.searching}
        </p>
      )}
      {current && section.status === "results" && (
        <section
          className="yt-results"
          aria-labelledby="yt-results-heading"
          data-testid="yt-results"
        >
          <h2 id="yt-results-heading">{labels.youTubeMusic}</h2>
          {songs.length === 0 && <p className="secondary">{text.library.notFoundOnline}</p>}
          <div role="list">
            {songs.map((row, index) => (
              <div key={row.videoId ?? index} role="listitem" className="yt-item">
                <button
                  className="table-row table-columns yt-row"
                  aria-selected={selected === index}
                  aria-label={[row.title, row.artist].filter(Boolean).join(", ")}
                  onClick={() => setSelected(index)}
                  onDoubleClick={() => row.videoId !== undefined && onPlay(row.videoId)}
                  onContextMenu={(event) => {
                    if (onMenu === undefined) return;
                    event.preventDefault();
                    setSelected(index);
                    onMenu(row, event);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (row.videoId !== undefined) onPlay(row.videoId);
                    }
                  }}
                >
                  <span className="title-cell">
                    <span className="row-picture">
                      <Artwork url={row.artworkUrl} />
                      <span className="row-play">
                        <Icon name="play" size={16} />
                      </span>
                    </span>
                    <span className="truncate">{row.title}</span>
                  </span>
                  <span className="truncate secondary">{row.artist}</span>
                  <span className="album-column truncate secondary">{row.album}</span>
                  <span className="star-column" />
                  <span className="time-column secondary">
                    {row.durationMs > 0 ? time(row.durationMs) : ""}
                  </span>
                </button>
                {row.videoId !== undefined && (
                  <button
                    className="icon-button yt-download"
                    aria-label={`${text.itemActions.labels.download}, ${row.title}`}
                    title={text.itemActions.labels.download}
                    onClick={() => onDownload(row.videoId!)}
                  >
                    <Icon name="download" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
