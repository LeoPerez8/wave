/** Faithful data/effect replay, not RN rendering. Native transport and scheduling are boundaries. */
import * as Effect from "effect/Effect";
import type * as Core from "@wave/core";
import type { TestDatabase } from "../../src/library/db/testDatabase.ts";
import type { SongRow } from "../../src/library/LibraryStore.ts";
import type { NativeYtSong } from "../../src/native/waveYtMusic.ts";
import { artistOpeningRequest } from "../../src/ytmusic/artistOpeningRequest.ts";
import { albumOpening } from "../../src/ytmusic/albumOpening.ts";
import { loadLibraryStore, loadWorktreeModule } from "./store.ts";

export const loadDetailOpening = async (root: string, db: TestDatabase) => {
  const store = await loadLibraryStore(root, db);
  const core = await loadWorktreeModule<typeof Core>(root, "packages/core/src/index.ts");
  const fixed = typeof core.ytAlbumOpening === "function";
  const request = fixed
    ? (
        await loadWorktreeModule<{ artistOpeningRequest: typeof artistOpeningRequest }>(
          root,
          "apps/mobile/src/ytmusic/artistOpeningRequest.ts",
        )
      ).artistOpeningRequest
    : <A, E, R>(_online: () => boolean, effect: Effect.Effect<A, E, R>) => effect;
  const appOpening = fixed
    ? (
        await loadWorktreeModule<{ albumOpening: typeof albumOpening }>(
          root,
          "apps/mobile/src/ytmusic/albumOpening.ts",
        )
      ).albumOpening
    : null;
  const album = (id: number, now: number, online = true) => {
    const detail = Effect.runSync(store.getAlbum(id));
    if (detail === null) throw new Error(`album ${id} missing`);
    const artist = Effect.runSync(
      store.linkRows({ artistId: detail.album.albumArtistIds[0] }),
    ).artist!;
    const saved = Effect.runSync(store.ytArtist(core.identityKey(artist.name)));
    // Both historical routes acquire a cold shared songs query at mount; the finder itself is lazy.
    const rows = fixed ? null : Effect.runSync(store.listSongs);
    let built: ((song: Core.YtSong) => SongRow | null) | null = null;
    const find =
      rows === null
        ? () => null
        : (song: Core.YtSong) => (built ??= core.libraryFinder(rows))(song);
    const state: Core.YtArtistSection<NativeYtSong> = { status: "ready", saved, failure: null };
    const context = {
      name: artist.name,
      artistId: artist.id,
      album: detail.album,
      tracks: detail.tracks,
      elsewhere: find,
      enabled: true,
      now,
      integrated: true,
      contentReady: true,
      settled: false,
      online,
      releasePage: () => undefined,
    };
    const work = appOpening?.(state, context);
    const view = work?.view ?? core.ytLibraryAlbumView(state, context);
    return {
      detail,
      artist,
      state,
      context,
      view,
      requests:
        work === undefined
          ? Number(view?.askArtist === true || view?.release != null)
          : Number(work.askArtist || work.readRelease !== null),
    };
  };
  const answer = (opening: ReturnType<typeof album>, songs: readonly NativeYtSong[]) => {
    const context = {
      ...opening.context,
      settled: true,
      keepTracklist: true,
      releasePage: () => ({ status: "loaded" as const, songs }),
    };
    const work = fixed ? core.ytAlbumOpening(opening.state, context) : null;
    const find =
      !fixed || work?.finder ? core.libraryFinder(Effect.runSync(store.listSongs)) : () => null;
    const view =
      appOpening !== null
        ? appOpening(opening.state, context, find).view
        : core.ytLibraryAlbumView(opening.state, { ...context, elsewhere: find });
    const local = opening.detail.tracks.map((track) => ({
      source: "library" as const,
      track,
      number: track.trackNumber,
    }));
    return view?.tracks ?? local;
  };
  const offlineView = (
    kind: "artist" | "album" | "ytArtist",
    now: number,
    state: Core.YtArtistSection<NativeYtSong> = { status: "reading" },
  ) => {
    if (kind === "album")
      return core.ytAlbumOpening(state, {
        name: "Justice",
        artistId: 1,
        album: { title: "Cross", albumArtistIds: [1] },
        tracks: [],
        elsewhere: () => null,
        enabled: true,
        now,
        integrated: true,
        online: false,
        settled: false,
        contentReady: false,
        releasePage: () => undefined,
      }).view?.note;
    if (kind === "ytArtist")
      return core.ytArtistPageOpening(state, {
        enabled: true,
        now,
        online: false,
        settled: false,
        librarySong: () => null,
        libraryAlbum: () => null,
      }).view.note;
    // Same offline state and public view the Library artist section renders, independent of its finder.
    return core.ytArtistSectionView(core.ytArtistOpeningState(state, false), {
      name: "Justice",
      enabled: true,
      now,
      integrated: true,
      inLibrary: () => true,
    })?.note;
  };
  return { core, store, fixed, request, album, answer, offlineView };
};
