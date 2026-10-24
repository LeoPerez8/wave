/** Shared app adapters for song-radio sessions used by the Magic Queue and playlist suggestions. */
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Storage } from "expo-sqlite/kv-store";
import { artistRadio } from "@/home/ytArtistPage";
import { withNetworkLog } from "@/lib/networkMeter";
import { appLog } from "@/log/appLog";
import type { LibraryStore } from "@/library/LibraryStore";
import { noteRadioNow } from "@/ytmusic/candidateCatalog";
import { createRadioPageCatalog } from "@/ytmusic/radioPageCatalog";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic } from "@/ytmusic/YtMusic";
import { createSongRadioReaders } from "./songRadioReaders";
import { createSongRadioSession, type SongRadioSeed } from "./songRadioSession";

export const createAppSongRadioReaders = (label: string) => {
  const pages = createRadioPageCatalog({
    read: () => Storage.getItemSync("candidateCatalog.radioPages"),
    write: (value) => Storage.setItemSync("candidateCatalog.radioPages", value),
  });
  let services: {
    readonly yt: YtMusic["Service"];
    readonly context: Context.Context<LibraryStore>;
  } | null = null;

  /** Readers stay separate per surface and session, sharing the ordered page cache. */
  const allReaders = createSongRadioReaders((seed: SongRadioSeed) => {
    const { yt, context } = services!;
    return createSongRadioSession(seed, {
      cached: pages.get(seed.id),
      radio: (videoId) => yt.radio({ videoId }),
      search: (query) =>
        withSearchTurn("discover", query, yt.searchSongs(query)).pipe(
          Effect.map((page) => page.songs),
        ),
      artist: (name) =>
        artistRadio({ name }).pipe(Effect.provide(context), Effect.provideService(YtMusic, yt)),
      more: (token) => yt.radioMore(token),
      measure: (read) =>
        withNetworkLog(`${label} radio`, read, (page) =>
          page === null ? "no radio" : `${page.songs.length} songs`,
        ),
      save: (page) =>
        Effect.gen(function* () {
          pages.put(seed.id, page);
          const artists =
            seed.artists.length > 0
              ? seed.artists
              : (page.songs.find((song) => song.videoId === seed.videoId)?.artists ?? []);
          for (const artist of artists)
            yield* noteRadioNow(artist, page.songs).pipe(Effect.provide(context));
        }),
      fallback: (name) =>
        appLog(
          "info",
          "WaveRecommendations",
          `${label}: no song match for ${seed.title}; using ${name}'s artist radio`,
        ),
    });
  });

  /** The readers, making new ones with [yt] and [context]. */
  return (yt: YtMusic["Service"], context: Context.Context<LibraryStore>) => {
    services = { yt, context };
    return allReaders;
  };
};
