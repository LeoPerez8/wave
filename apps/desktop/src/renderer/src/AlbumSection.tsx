import type { YtPick } from "@wave/core";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { AlbumSectionView } from "../../shared/artistPage.ts";
import type { BrowseRow } from "../../shared/browse.ts";
import { labels, text } from "./text.ts";
import { YtSongList } from "./YtLists.tsx";
import "./album.css";

/**
 * A Library album's page beyond its hero and tracks table (docs/spec.md, "Album page"): with
 * YT Music on, the Library | Online toggle, and with Online the album's tracklist with the songs
 * of its release the Library lacks, in the release's order.
 */

export interface AlbumSection {
  /** The section, or null without one (YT Music off, an album artist that isn't an artist's). */
  readonly view: AlbumSectionView | null;
  /** The toggle's segment picked on this visit; null: none yet. */
  readonly pick: YtPick | null;
  readonly setPick: (pick: YtPick) => void;
}

/**
 * The YouTube Music section of the album [albumId] (undefined: no album page). It asks YouTube
 * Music only when main says so: Online picked, or Search online set to Always.
 */
export const useAlbumSection = (
  albumId: number | undefined,
  ytMusic: boolean,
  revision: number,
  onError: () => void,
): AlbumSection => {
  const [picked, setPicked] = useState<{ id: number | undefined; pick: YtPick | null }>({
    id: albumId,
    pick: null,
  });
  const pick = picked.id === albumId ? picked.pick : null;
  const [read, setRead] = useState<{ key: string; view: AlbumSectionView | null }>();
  const [asked, setAsked] = useState(0);
  const key = `${albumId}:${pick}:${ytMusic}:${revision}:${asked}`;
  useEffect(() => {
    if (albumId === undefined) return;
    let current = true;
    void window.wave.artistPage
      .albumSection(albumId, pick)
      .then((view) => {
        if (!current) return;
        setRead({ key, view });
        if (view?.asks)
          void window.wave.artistPage
            .albumAsk(albumId, pick, false)
            .then(() => current && setAsked((n) => n + 1))
            .catch(onError);
      })
      .catch(onError);
    return () => {
      current = false;
    };
  }, [albumId, pick, key, onError]);
  // While another album's answer is read, keep the toggle where it was; then show this one's.
  const view = read?.key.startsWith(`${albumId}:`) ? read.view : null;
  return {
    view: view === null ? null : view.asks ? { ...view, note: "loading" } : view,
    pick,
    setPick: (next) => {
      setPicked({ id: albumId, pick: next });
      // Online after an ask that got no answer asks again.
      if (next === "online" && albumId !== undefined && view?.retry != null)
        void window.wave.artistPage
          .albumAsk(albumId, next, true)
          .then(() => setAsked((n) => n + 1))
          .catch(onError);
    },
  };
};

const noteText = (note: NonNullable<AlbumSectionView["note"]>): string => {
  switch (note) {
    case "loading":
      return labels.loading;
    case "notFound":
      return text.library.notFoundOnline;
    case "offline":
      return text.library.offlineTapOnline;
    case "failed":
      return text.library.noAnswerTapOnline;
  }
};

/** The tracklist's rows in disc groups, each after its "Disc n" head; one group without heads. */
const discGroups = (view: AlbumSectionView, tracks: readonly BrowseRow[]) => {
  const starts = view.discs.length === 0 ? [{ disc: null, at: 0 }] : view.discs;
  return starts.map((head, index) => ({
    disc: head.disc,
    at: index === 0 ? 0 : head.at,
    rows: tracks.slice(index === 0 ? 0 : head.at, starts[index + 1]?.at ?? tracks.length),
  }));
};

/**
 * The album page's tracks: the Library's table ([children]) or, with Online and the release
 * read, the whole tracklist in its place (the table keeps only its header), then the quiet line.
 */
export function AlbumPage({
  section,
  onPlay,
  onSongMenu,
  children,
}: {
  readonly section: AlbumSection;
  /** Plays the tracklist from its row [index]. */
  readonly onPlay: (index: number) => void;
  readonly onSongMenu: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
  readonly children: ReactNode;
}) {
  const online = section.view?.toggle === "online" ? section.view : null;
  const tracks = online?.tracks ?? null;
  return (
    <div className="album-page" data-testid="album-page">
      {tracks === null ? children : <div className="album-online-head">{children}</div>}
      {online !== null &&
        tracks !== null &&
        discGroups(online, tracks).map((group) => (
          <section
            key={group.at}
            className="album-online-disc"
            aria-label={group.disc === null ? undefined : text.library.disc(group.disc)}
          >
            {group.disc !== null && (
              <h2 className="album-disc-heading">{text.library.disc(group.disc)}</h2>
            )}
            <YtSongList
              songs={group.rows}
              numbered
              label={group.disc === null ? labels.songs : text.library.disc(group.disc)}
              onPlay={(index) => onPlay(group.at + index)}
              onMenu={onSongMenu}
            />
          </section>
        ))}
      {online?.note && (
        <p className="yt-quiet secondary" role="status" data-testid="album-online-note">
          {noteText(online.note)}
        </p>
      )}
    </div>
  );
}
