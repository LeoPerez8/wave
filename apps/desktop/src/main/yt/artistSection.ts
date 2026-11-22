/**
 * A Library artist page's YouTube Music section on the desktop (docs/spec.md, "YT Music",
 * Artist page): the Library | Online toggle, and with Online every song and release of the
 * artist the Library lacks. The page opens on Library and asks nothing until Online is picked,
 * unless a saved answer stands (a week). The answer is asked as the phone asks it
 * (`fetchArtistAnswer`) and saved where the phone saves it (`yt_artists`, by artist key), so
 * Core decides what shows (`ytArtistSectionView`, `ytArtistShelves`, `ytArtistSectionAsks`).
 */
import { selectArtistAlbums } from "@wave/client/db/artists";
import type { LibraryDatabase } from "@wave/client/db/database";
import { trackQuery } from "@wave/client/db/tracks";
import { selectYtArtist, saveYtArtist } from "@wave/client/db/ytArtists";
import { fetchArtistAnswer } from "@wave/client/ytArtistFetch";
import {
  YT_ARTIST_SECTION_START,
  artistPopularSongs,
  artistSongOrder,
  identityKey,
  libraryAlbumFinder,
  libraryMatcher,
  stepYtArtistSection,
  ytArtistSectionAsks,
  ytArtistSectionView,
  ytArtistShelves,
  ytTrackId,
  type YtAlbumSong,
  type YtArtistCandidate,
  type YtArtistPage,
  type YtArtistSection,
  type YtPick,
  type YtSong,
} from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { ArtistPageSongs, ArtistSectionView } from "../../shared/artistPage.ts";
import { ytRow } from "../../shared/yt.ts";
import { artistSongsForPopular, browseSongs, browseTrackIds } from "../library/browse.ts";
import { readBrowseSort } from "../library/browseSort.ts";

export interface ArtistSectionDeps {
  readonly db: LibraryDatabase;
  /** YT Music's setting: off, the page has no section. */
  readonly enabled: () => boolean;
  /** The system's connection, checked as each request runs. */
  readonly online: () => boolean;
  /** Search online acts as Always: the page opens with Online and asks on its own. */
  readonly always: () => boolean;
  readonly now: () => number;
  /** Remembers the songs the section shows, so they can stream and be queued. */
  readonly keep: (songs: readonly YtAlbumSong[]) => void;
  /** An Artists search; rejects with the JVM's `code` when it gets no answer. */
  readonly search: (query: string) => Promise<readonly YtArtistCandidate[]>;
  /** The artist's page with every song of theirs (`ytArtistFullPage`); rejects as [search]. */
  readonly page: (browseId: string) => Promise<YtArtistPage<YtAlbumSong>>;
}

export interface ArtistSectionShape {
  /** What the page [artistId] shows with [pick] (null: nothing picked yet); null: no section. */
  readonly view: (
    artistId: number,
    pick: YtPick | null,
    offset: number,
    limit: number,
  ) => ArtistSectionView | null;
  /** Asks YouTube Music for the artist and saves the answer; never rejects. */
  readonly ask: (artistId: number) => Promise<void>;
  /**
   * The queue Play makes: the Library's songs, or with Online the page's Popular list.
   * `listStart` is where the section's `songs` begin in it.
   */
  readonly queue: (
    artistId: number,
    pick: YtPick | null,
  ) => { readonly ids: string[]; readonly listStart: number };
  /**
   * The artist page's songs with [pick] (docs/spec.md, "Artist songs"): the whole list in Popular
   * order whatever the table's sort, YouTube Music's songs in it with Online, and its first
   * [limit] rows.
   */
  readonly pageSongs: (artistId: number, pick: YtPick | null, limit: number) => ArtistPageSongs;
  /** The queue the artist page's Play makes: `pageSongs`'s whole list, in its order. */
  readonly pageQueue: (artistId: number, pick: YtPick | null) => string[];
  /** What stands for the artist [name], what was saved for them read on first sight. */
  readonly state: (name: string) => YtArtistSection<YtAlbumSong>;
}

type Section = YtArtistSection<YtAlbumSong>;

const reasonOf = (error: unknown): "offline" | "failed" =>
  (error as { code?: unknown } | null)?.code === "ERR_YT_OFFLINE" ? "offline" : "failed";

export const createArtistSection = (deps: ArtistSectionDeps): ArtistSectionShape => {
  const { db } = deps;
  /** Each artist's section, by artist key, for as long as the app runs. */
  const sections = new Map<string, Section>();

  const nameOf = (artistId: number): string | null =>
    db.get<{ name: string }>(sql`SELECT name FROM artists WHERE id=${artistId}`)?.name ?? null;

  /** The section of [name], what was saved for it read on first sight. */
  const sectionOf = (name: string): Section => {
    const key = identityKey(name);
    let section = sections.get(key);
    if (section === undefined) {
      const saved = selectYtArtist<YtAlbumSong>(db, key);
      if (saved?.outcome === "found") deps.keep(saved.page.allSongs ?? saved.page.songs);
      section = stepYtArtistSection<YtAlbumSong>(YT_ARTIST_SECTION_START, {
        type: "restored",
        saved,
      });
      sections.set(key, section);
    }
    return section;
  };

  /** Whether the Library has a song, its missing songs included. */
  const inLibrary = (): ((song: YtSong) => boolean) =>
    libraryMatcher(
      trackQuery(db, "library")
        .all()
        .map((row) => ({ title: row.title, artist: row.artist, durationMs: row.durationMs ?? 0 })),
    );

  const shown = (artistId: number, pick: YtPick | null) => {
    const name = nameOf(artistId);
    if (name === null) return null;
    const state = sectionOf(name);
    const context = {
      name,
      enabled: deps.enabled(),
      now: deps.now(),
      always: deps.always(),
      integrated: false,
      pick,
    };
    const view = ytArtistSectionView(state, { ...context, inLibrary: inLibrary() });
    return view === null ? null : { name, state, context, view };
  };

  /**
   * With Online, the artist's full list saved and their songs sorted by Popular, the page's
   * songs as one list: the Library's files and the songs YouTube Music adds, in its order
   * (`artistSongOrder`). Null otherwise: another sort keeps the Library's table, sorted, with
   * the songs YouTube Music adds after it.
   */
  const popularList = (artistId: number, found: NonNullable<ReturnType<typeof shown>>) => {
    if (found.view.toggle !== "online") return null;
    if (readBrowseSort(db, "artist")?.key !== "popular") return null;
    const popular = artistPopularSongs(found.state);
    if (popular === null) return null;
    const library = browseSongs(
      db,
      browseTrackIds(db, { kind: "artist", id: artistId }).map(Number),
    );
    return artistSongOrder(
      [
        ...library.map((track) => ({ source: "library" as const, track })),
        ...found.view.songs.map((song) => ({ source: "stream" as const, song })),
      ],
      popular,
      { sort: "popular", online: true },
    );
  };

  /**
   * The artist page's list: the Library's songs, with Online the ones YouTube Music adds, in
   * Popular order (`artistSongOrder`) once the artist's list is saved; with none, the Library's
   * by song name and YouTube Music's after them. [known]: a Popular list ranks them.
   */
  const pageList = (artistId: number, pick: YtPick | null) => {
    const name = nameOf(artistId);
    const found = shown(artistId, pick);
    const online = found?.view.toggle === "online";
    const popular = name === null ? null : artistPopularSongs(sectionOf(name));
    const list = artistSongOrder(
      [
        ...artistSongsForPopular(db, artistId).map((track) => ({
          source: "library" as const,
          track,
        })),
        ...(online ? found.view.songs : []).map((song) => ({ source: "stream" as const, song })),
      ],
      popular,
      { sort: "popular", online },
    );
    return { known: popular !== null, list };
  };

  return {
    view: (artistId, pick, offset, limit) => {
      const found = shown(artistId, pick);
      if (found === null) return null;
      const { state, context, view } = found;
      const { albums, appearsOn } = selectArtistAlbums(db, artistId);
      const libraryAlbum = libraryAlbumFinder(artistId, [...albums, ...appearsOn]);
      const lacking = (kind: "albums" | "singles") =>
        ytArtistShelves(state, { ...context, libraryAlbum })
          .filter((shelf) => shelf.kind === kind)
          .flatMap((shelf) => shelf.releases)
          .filter((release) => release.library === null)
          .map((release) => release.album);
      const list = popularList(artistId, found);
      const rows =
        list?.map((row) => (row.source === "library" ? row.track : ytRow(row.song))) ??
        view.songs.map(ytRow);
      return {
        toggle: view.toggle,
        note: view.note,
        asks: ytArtistSectionAsks(state, context),
        popular: list !== null,
        ranked: list?.filter((row) => row.popularRank !== undefined).length ?? 0,
        songs: { items: rows.slice(offset, offset + limit), offset, total: rows.length },
        albums: lacking("albums"),
        singles: lacking("singles"),
      };
    },
    ask: async (artistId) => {
      const name = nameOf(artistId);
      if (name === null) return;
      const key = identityKey(name);
      const before = sectionOf(name);
      if (before.status !== "ready") return;
      sections.set(key, stepYtArtistSection(before, { type: "requested" }));
      const step = (event: Parameters<typeof stepYtArtistSection<YtAlbumSong>>[1]) =>
        sections.set(key, stepYtArtistSection(sections.get(key) ?? before, event));
      const request = <A>(run: () => Promise<A>) =>
        Effect.tryPromise({ try: run, catch: (error) => ({ reason: reasonOf(error) }) });
      const answer = await Effect.runPromise(
        Effect.result(
          fetchArtistAnswer(name, before.saved, {
            canSend: deps.online,
            search: (query) => request(() => deps.search(query)),
            page: (browseId) => request(() => deps.page(browseId)),
            saved: Effect.sync(() => selectYtArtist<YtAlbumSong>(db, key)),
            save: (answer) => Effect.sync(() => saveYtArtist(db, key, answer)),
          }),
        ),
      );
      if (Result.isSuccess(answer)) {
        const saved = answer.success;
        if (saved.outcome === "found") deps.keep(saved.page.allSongs ?? saved.page.songs);
        step({ type: "answered", saved });
      } else step({ type: "failed", reason: answer.failure.reason });
    },
    queue: (artistId, pick) => {
      const library = browseTrackIds(db, { kind: "artist", id: artistId });
      const found = shown(artistId, pick);
      if (found?.view.toggle !== "online") return { ids: library, listStart: library.length };
      const list = popularList(artistId, found);
      if (list !== null)
        return {
          ids: list.map((row) =>
            row.source === "library" ? String(row.track.id) : ytTrackId(row.song.videoId),
          ),
          listStart: 0,
        };
      return {
        ids: [...library, ...found.view.songs.map((song) => ytTrackId(song.videoId))],
        listStart: library.length,
      };
    },
    pageSongs: (artistId, pick, limit) => {
      const { known, list } = pageList(artistId, pick);
      return {
        popular: known,
        ranked: list.filter((row) => row.popularRank !== undefined).length,
        songs: list
          .slice(0, limit)
          .map((row) => (row.source === "library" ? row.track : ytRow(row.song))),
        total: list.length,
      };
    },
    pageQueue: (artistId, pick) =>
      pageList(artistId, pick).list.map((row) =>
        row.source === "library" ? String(row.track.id) : ytTrackId(row.song.videoId),
      ),
    state: sectionOf,
  };
};
