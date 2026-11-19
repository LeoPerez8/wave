/**
 * Discover from a fixture instead of live YouTube Music: main's `discover.mixes` and
 * `discover.playMix` handlers are replaced, so a check asserts what it set up. The Magic Queue
 * row keeps main's own picks from the Library.
 */
import type { ElectronApplication } from "@playwright/test";
import type { BrowseRow } from "../src/shared/browse.ts";
import type { DiscoverMixesView } from "../src/shared/ytPages.ts";

const song = (n: number): BrowseRow => ({
  id: 0,
  videoId: `fixture${String(n).padStart(4, "0")}`,
  title: `Fixture song ${n}`,
  artist: "Fixture Artist",
  album: "",
  artworkHash: null,
  durationMs: 180_000,
  count: 0,
  year: null,
  genre: null,
  trackNumber: null,
  favorite: false,
  path: null,
  unavailable: false,
});

const songs = (count: number) => {
  const items = Array.from({ length: count }, (_, n) => song(n));
  return { items, offset: 0, total: items.length };
};

/** One Artist mix and one Genre mix, of 12 and 10 songs. */
export const DISCOVER_FIXTURE: DiscoverMixesView = {
  status: "ok",
  mixes: [
    {
      id: "artist:fixture",
      name: "Fixture Artist",
      row: "artist-mixes",
      artists: "Fixture Artist",
      artworkUrl: null,
      songs: songs(12),
    },
    {
      id: "genre:electronic",
      name: "Electronic",
      row: "genre-mixes",
      artists: "Fixture Artist",
      artworkUrl: null,
      songs: songs(10),
    },
  ],
};

/**
 * Serves [DISCOVER_FIXTURE] from main, while YT Music is on and the window is online, as main's
 * own handler would; returns the `[id, index]` of each mix played.
 */
export const stubDiscover = async (app: ElectronApplication) =>
  app.evaluateHandle(({ ipcMain, net }, fixture) => {
    const played: [string, number][] = [];
    ipcMain.removeHandler("discover.mixes");
    ipcMain.handle("discover.mixes", () =>
      net.isOnline() ? fixture : { status: "offline", mixes: [] },
    );
    ipcMain.removeHandler("discover.playMix");
    ipcMain.handle("discover.playMix", (_, id: string, index: number) => {
      played.push([id, index]);
      return fixture.mixes.some((mix) => mix.id === id);
    });
    return played;
  }, DISCOVER_FIXTURE);
