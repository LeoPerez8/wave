/**
 * A Library album page's YouTube Music section on the desktop (docs/spec.md, "YT Music", Album
 * page): the Library | Online toggle, and with Online the album's tracklist with the songs of
 * its release the Library lacks, streamed. The page opens on Library and asks nothing until
 * Online is picked. The album artist is asked as their artist page asks (`ArtistSectionShape`),
 * so an answer one page got stands on the other; Core decides what shows
 * (`ytLibraryAlbumView`) and what to ask (`ytAlbumOpening`).
 */
import { selectAlbumDetail } from "@wave/client/db/albums";
import type { LibraryDatabase } from "@wave/client/db/database";
import { trackQuery } from "@wave/client/db/tracks";
import type { SongRow } from "@wave/client";
import {
  albumDiscHeads,
  libraryFinder,
  ytAlbumOpening,
  ytArtistOpeningState,
  ytLibraryAlbumView,
  ytTrackId,
  type YtAlbumEntry,
  type YtAlbumSong,
  type YtPick,
  type YtReleaseLoad,
} from "@wave/core";
import { sql } from "drizzle-orm";

import type { AlbumSectionView } from "../../shared/artistPage.ts";
import type { BrowseRow } from "../../shared/browse.ts";
import { ytRow } from "../../shared/yt.ts";
import { browseSongs, browseTrackIds } from "../library/browse.ts";
import type { ArtistSectionShape } from "./artistSection.ts";
import type { YtAlbumRead } from "./ytPages.ts";

export interface AlbumSectionDeps {
  readonly db: LibraryDatabase;
  /** YT Music's setting: off, the page has no section. */
  readonly enabled: () => boolean;
  /** The system's connection, checked as each request runs. */
  readonly online: () => boolean;
  /** Search online acts as Always: the page opens with Online and asks on its own. */
  readonly always: () => boolean;
  readonly now: () => number;
  /** The artist pages' section, whose answer for the album artist the album goes by. */
  readonly artist: Pick<ArtistSectionShape, "ask" | "state">;
  /** The release's page (`YtPagesShape.album`), its songs kept to stream. */
  readonly release: (browseId: string) => Promise<YtAlbumRead>;
}

export interface AlbumSectionShape {
  /** What the album [albumId]'s page shows with [pick] (null: nothing picked yet); null: none. */
  readonly view: (albumId: number, pick: YtPick | null) => AlbumSectionView | null;
  /**
   * Asks what the section waits for: the album artist, or the release's page; with [again],
   * what an ask that got no answer asked. Never rejects.
   */
  readonly ask: (albumId: number, pick: YtPick | null, again: boolean) => Promise<void>;
  /** The queue Play makes: the album's songs, or with Online its whole tracklist. */
  readonly queue: (albumId: number, pick: YtPick | null) => string[];
}

type Entry = YtAlbumEntry<YtAlbumSong, SongRow>;

export const createAlbumSection = (deps: AlbumSectionDeps): AlbumSectionShape => {
  const { db } = deps;
  /** Each release's page as read this run, by browse id. */
  const releases = new Map<string, YtReleaseLoad<YtAlbumSong>>();

  const nameOf = (artistId: number): string | null =>
    db.get<{ name: string }>(sql`SELECT name FROM artists WHERE id=${artistId}`)?.name ?? null;

  const shown = (albumId: number, pick: YtPick | null) => {
    const detail = selectAlbumDetail(db, albumId);
    if (detail === null) return null;
    const { album, tracks } = detail;
    // The album goes by its first album artist.
    const artistId = album.albumArtistIds[0] ?? album.albumArtistId;
    const name = nameOf(artistId);
    if (name === null) return null;
    let library: ((song: YtAlbumSong) => SongRow | null) | undefined;
    const state = deps.artist.state(name);
    const online = deps.online();
    const context = {
      name,
      artistId,
      album,
      tracks,
      // The Library's file of a song from another album, read only once the release is.
      elsewhere: (song: YtAlbumSong) =>
        (library ??= libraryFinder(trackQuery(db, "library").all()))(song),
      enabled: deps.enabled(),
      now: deps.now(),
      integrated: false,
      always: deps.always(),
      pick,
      releasePage: (release: { readonly browseId: string }) => releases.get(release.browseId),
    };
    const opening = ytAlbumOpening(state, {
      ...context,
      contentReady: true,
      settled: true,
      online,
    });
    // The release's order, the Library's songs among its others (`ytAlbumTracklist`).
    const view = ytLibraryAlbumView(ytArtistOpeningState(state, online), context);
    if (view === null) return null;
    return { artistId, tracks, view, opening };
  };

  const rows = (entries: readonly Entry[]): BrowseRow[] => {
    const library = new Map(
      browseSongs(
        db,
        entries.flatMap((entry) => (entry.source === "library" ? [entry.track.id] : [])),
      ).map((row) => [row.id, row]),
    );
    return entries.flatMap((entry): BrowseRow[] => {
      const row = entry.source === "library" ? library.get(entry.track.id) : ytRow(entry.song);
      return row === undefined ? [] : [{ ...row, trackNumber: entry.number }];
    });
  };

  const read = async (browseId: string) => {
    releases.set(browseId, { status: "loading" });
    const answer = await deps.release(browseId).catch(() => null);
    releases.set(
      browseId,
      answer?.status === "ok" && answer.album !== null
        ? { status: "loaded", songs: answer.album.songs }
        : { status: "quiet", reason: answer?.status === "offline" ? "offline" : "failed" },
    );
  };

  return {
    view: (albumId, pick) => {
      const found = shown(albumId, pick);
      if (found === null) return null;
      const { view, opening, tracks } = found;
      const browseId = opening.readRelease;
      const own = new Set(tracks.map((track) => track.id));
      return {
        toggle: view.toggle,
        note: view.note,
        asks: opening.askArtist || (browseId !== null && !releases.has(browseId)),
        retry: view.retry,
        tracks: view.tracks === null ? null : rows(view.tracks),
        discs:
          view.tracks === null
            ? []
            : albumDiscHeads(
                // A song of another album, or streamed, has no disc of this one.
                view.tracks.map((entry) =>
                  entry.source === "library" && own.has(entry.track.id)
                    ? entry.track.discNumber
                    : undefined,
                ),
              ),
        release: view.songs === null ? null : (view.release?.browseId ?? null),
      };
    },
    ask: async (albumId, pick, again) => {
      const found = shown(albumId, pick);
      if (found === null) return;
      const { view, opening, artistId } = found;
      if (again && view.retry === "artist") return deps.artist.ask(artistId);
      if (again && view.retry === "release" && view.release !== null)
        return read(view.release.browseId);
      if (opening.askArtist) return deps.artist.ask(artistId);
      const browseId = opening.readRelease;
      if (browseId !== null && !releases.has(browseId)) await read(browseId);
    },
    queue: (albumId, pick) => {
      const tracks = shown(albumId, pick)?.view.tracks ?? null;
      if (tracks === null) return browseTrackIds(db, { kind: "album", id: albumId });
      return tracks.map((entry) =>
        entry.source === "library" ? String(entry.track.id) : ytTrackId(entry.song.videoId),
      );
    },
  };
};
