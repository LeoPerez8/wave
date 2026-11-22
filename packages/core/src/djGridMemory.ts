/** The DJ grid kept on this phone between visits (docs/spec.md, DJ). */
import { djAlbumTile, djArtistTile, djGenreTile, type DjTile } from "./dj.ts";
import { isRecord } from "./storedJson.ts";

export const DJ_GRID_SETTING = "dj.grid";

const storeTile = (tile: DjTile): unknown => {
  if (tile.kind === "artist")
    return { kind: tile.kind, name: tile.name, libraryId: tile.libraryId };
  if (tile.kind === "album")
    return {
      kind: tile.kind,
      name: tile.name,
      artist: tile.artist,
      libraryId: tile.libraryId,
      browseId: tile.browseId,
      cover: tile.cover,
    };
  return {
    kind: tile.kind,
    name: tile.name,
    artists: tile.artists,
    opens: tile.opens.map(storeTile),
  };
};

const readTile = (value: unknown): DjTile | null => {
  if (!isRecord(value) || typeof value["kind"] !== "string") return null;
  if (value["kind"] === "artist" && typeof value["name"] === "string")
    return djArtistTile(
      value["name"],
      typeof value["libraryId"] === "number" ? value["libraryId"] : null,
    );
  if (
    value["kind"] === "album" &&
    typeof value["name"] === "string" &&
    typeof value["artist"] === "string"
  )
    return djAlbumTile({
      title: value["name"],
      artist: value["artist"],
      libraryId: typeof value["libraryId"] === "number" ? value["libraryId"] : null,
      browseId: typeof value["browseId"] === "string" ? value["browseId"] : null,
      cover: typeof value["cover"] === "string" ? value["cover"] : null,
    });
  if (value["kind"] === "genre" && typeof value["name"] === "string") {
    const family = djGenreTile(value["name"]);
    if (family === null) return null;
    const opens = Array.isArray(value["opens"]) ? value["opens"].map(readTile) : [];
    return {
      ...family,
      artists: Array.isArray(value["artists"]) ? (value["artists"] as typeof family.artists) : [],
      opens: opens.filter((tile): tile is DjTile => tile !== null),
    };
  }
  return null;
};

export const storedDjGridMemory = (tiles: readonly DjTile[] | null): string | null =>
  tiles === null || tiles.length === 0
    ? null
    : JSON.stringify({ version: 1, tiles: tiles.map(storeTile) });

export const readDjGridMemory = (stored: string | null): readonly DjTile[] | null => {
  if (stored === null) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (!isRecord(value) || value["version"] !== 1 || !Array.isArray(value["tiles"])) return null;
    const tiles = value["tiles"].map(readTile);
    if (tiles.some((tile) => tile === null)) return null;
    return tiles.filter((tile): tile is DjTile => tile !== null).length > 0
      ? (tiles as DjTile[])
      : null;
  } catch {
    return null;
  }
};
