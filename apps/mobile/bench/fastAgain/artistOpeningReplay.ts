/**
 * Faithful replay of the artist opening's reads/derivations, not RN rendering.
 * Worktree store and Core are real. Only native/navigation scheduling is absent.
 */
import * as Effect from "effect/Effect";
import type * as Core from "@wave/core";
import type { ArtistDetail, LibraryStore, SongRow } from "../../src/library/LibraryStore.ts";
import type { NativeYtSong } from "../../src/native/waveYtMusic.ts";
import { loadLibraryStore, loadWorktreeModule } from "./store.ts";
import type { TestDatabase } from "../../src/library/db/testDatabase.ts";

const context = (detail: ArtistDetail, now: number, integrated: boolean, settled: boolean) => ({
  name: detail.artist.name,
  enabled: true,
  now,
  integrated,
  settled,
  contentReady: true,
  // Library mode isolates the saved Popular order; integrated includes online additions.
  pick: integrated ? ("online" as const) : ("library" as const),
});

export const loadArtistOpening = async (root: string, db: TestDatabase) => {
  const store = await loadLibraryStore(root, db);
  const core = await loadWorktreeModule<typeof Core>(root, "packages/core/src/index.ts");
  return makeArtistOpening(store, core);
};

export const makeArtistOpening = (store: LibraryStore["Service"], core: typeof Core) => {
  const fixed = typeof core.ytArtistOpening === "function";
  type Finder = (song: NativeYtSong) => SongRow | null;
  interface Opening {
    readonly detail: ArtistDetail;
    readonly saved: Core.YtArtistSaved<NativeYtSong> | null;
    readonly songs: readonly (SongRow & { readonly popularRank?: number | undefined })[];
    readonly find: Finder | null;
  }
  const state = (saved: Opening["saved"]): Core.YtArtistSection<NativeYtSong> => ({
    status: "ready",
    saved,
    failure: null,
  });
  const open = (id: number, now: number, integrated: boolean): Opening => {
    const detail = Effect.runSync(store.getArtist(id));
    if (detail === null) throw new Error(`artist ${id} missing`);
    const saved = Effect.runSync(store.ytArtist(core.identityKey(detail.artist.name)));
    // ti always follows the cold songs query, even on Library/integrated openings.
    const wanted =
      !fixed || core.ytArtistOpening(state(saved), context(detail, now, integrated, false)).finder;
    const find = wanted ? core.libraryFinder(Effect.runSync(store.listSongs)) : null;
    const popular = saved?.outcome === "found" ? (saved.page.allSongs ?? null) : null;
    const songs = core.sortSongs(
      popular === null ? detail.songs : core.rankPopular(detail.songs, popular),
      { key: "popular", descending: false },
    );
    // ti's section/counts use the lazy finder, building it before its first rows.
    if (find !== null)
      core.ytArtistSectionView(state(saved), {
        ...context(detail, now, integrated, false),
        inLibrary: (song) => find(song) !== null,
      });
    // The page also builds a targeted finder for held download placement when shared is ready.
    if (find !== null) core.libraryFinder(songs);
    return { detail, saved, songs, find };
  };
  const localPage = ({ detail, songs }: Opening) => ({
    artist: detail.artist,
    albums: detail.albums,
    appearsOn: detail.appearsOn,
    songs,
    counts: { albums: detail.artist.albumCount, songs: songs.length },
    items: core.artistPageItems(
      [
        { label: "Albums", covers: detail.albums },
        { label: "Appears on", covers: detail.appearsOn },
      ],
      songs,
      "Popular",
    ),
  });
  const settle = (opening: Opening, now: number, integrated: boolean) => {
    const { detail, saved, songs } = opening;
    const options = context(detail, now, integrated, true);
    const wanted = fixed && core.ytArtistOpening(state(saved), options).finder;
    const find =
      opening.find ?? (wanted ? core.libraryFinder(Effect.runSync(store.listSongs)) : null);
    const findAlbum = core.libraryAlbumFinder(detail.artist.id, [
      ...detail.albums,
      ...detail.appearsOn,
    ]);
    const view = core.ytArtistSectionView(state(saved), {
      ...options,
      inLibrary: (song) => find?.(song) !== null,
    });
    const shelves = core.ytArtistShelves(state(saved), { ...options, libraryAlbum: findAlbum });
    const counts = core.ytArtistCounts(state(saved), {
      ...options,
      local: localPage(opening).counts,
      inLibrary: (song) => find?.(song) !== null,
      libraryRelease: (album) => findAlbum(album) !== null,
    });
    return {
      ...localPage(opening),
      view,
      shelves,
      counts,
      integrated: core.ytArtistIntegrated(state(saved), options),
      items: core.artistPageItems(
        [
          {
            label: "Albums",
            covers: [
              ...detail.albums,
              ...shelves
                .filter((s) => s.kind === "albums")
                .flatMap((s) => s.releases.filter((r) => r.library === null).map((r) => r.album)),
            ],
          },
          {
            label: "Singles & EPs",
            covers: shelves
              .filter((s) => s.kind === "singles")
              .flatMap((s) => s.releases.filter((r) => r.library === null).map((r) => r.album)),
          },
          { label: "Appears on", covers: detail.appearsOn },
        ],
        [...songs, ...(view?.songs ?? [])],
        "Popular",
      ),
    };
  };
  return { store, core, fixed, open, localPage, settle };
};
