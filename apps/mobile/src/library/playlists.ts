import {
  CENTRE_FRAMING,
  framingSquare,
  framingText,
  readFraming,
  sortKey,
  type ImageFraming,
  type ImageSize,
  type PlaylistSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { Image } from "react-native";

import { artworkUri } from "@/catalog/artworkUri";
import { makeExternalStore } from "@/lib/externalStore";
import { currentLocalisation } from "@/localisation/localisation";
import { WaveNative, type PlaylistPhoto } from "@/native/waveNative";

import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";
import { shazamPlaylistId, setShazamPlaylistId } from "@/settings/shazamPlaylist";

import { countNotified } from "./db/playlistWork";
import {
  LibraryStore,
  type LibraryStoreError,
  type PlaylistAddResult,
  type PlaylistRow,
} from "./LibraryStore";
import { publishLibraryChange } from "./libraryChanges";
import { appRuntime } from "./runtime";

/** Bumped after every playlist edit, for what follows it (`onPlaylistsEdited`). */
const playlistsVersion = makeExternalStore(0);

/** Calls [listener] after every playlist edit; returns how to stop. */
export const onPlaylistsEdited = (listener: () => void): (() => void) =>
  playlistsVersion.subscribe(listener);

/**
 * The playlists changed (an edit here, or the Wave account sent some):
 * playlist queries re-run, and the remembered list is read again now, so the
 * next card that lists them doesn't wait for it. [playlistIds]: the playlists
 * changed, when known; queries over other playlists stay as they are.
 * [burst]: one of a stream of additions (an import filling a playlist), which
 * screens take at their own pace (Core's `LibraryChange.burst`); the list
 * isn't read ahead for each, and no playlist was deleted.
 */
export const playlistsChanged = (playlistIds?: readonly number[], burst = false): void => {
  countNotified(playlistIds);
  playlistsVersion.update((version) => version + 1);
  publishLibraryChange({
    kind: "playlists",
    ...(playlistIds === undefined ? {} : { ids: playlistIds }),
    ...(burst ? { burst } : {}),
  });
  if (burst) return;
  appRuntime.runPromise(listPlaylistsRemembered).catch(() => {});
  // A deleted playlist's image goes with it.
  tidyDeletedPlaylistImages();
};

/**
 * Runs a playlist edit, then announces it (for [playlistId] alone, when it
 * edits one playlist; as a burst with [burst]).
 */
const edit = <A>(
  run: (store: LibraryStore["Service"]) => Effect.Effect<A, LibraryStoreError>,
  playlistId?: number,
  burst = false,
): Promise<A> => {
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  const edited = LibraryStore.use(run);
  return appRuntime
    .runPromise(edited)
    .finally(() => playlistsChanged(playlistId === undefined ? undefined : [playlistId], burst));
};

/** The playlists as last read, and the `playlistsVersion` they were read at. */
let remembered: { readonly version: number; readonly rows: readonly PlaylistRow[] } | undefined;

/**
 * Lists the playlists and remembers them, so cards that list them (Add to
 * Playlist) or check names against them (the name prompt) open at once.
 */
export const listPlaylistsRemembered: Effect.Effect<
  readonly PlaylistRow[],
  LibraryStoreError,
  LibraryStore
> = Effect.gen(function* () {
  // Read before the query: an edit landing meanwhile leaves these rows out of date.
  const version = playlistsVersion.get();
  const store = yield* LibraryStore;
  const rows = yield* store.listPlaylists;
  remembered = { version, rows };
  return rows;
});

/**
 * Reads the playlists once at app start, so the first New Playlist prompt or
 * Add to Playlist card of the session opens at once too, and deletes images
 * a deletion left behind (Wave closed before it got to them). Safe to call
 * repeatedly.
 */
export const primePlaylists = (): void => {
  tidyDeletedPlaylistImages();
  if (knownPlaylists() === undefined) {
    appRuntime.runPromise(listPlaylistsRemembered).catch(() => {});
  }
};

/** The playlists, as remembered when no edit has happened since; undefined otherwise. */
export const knownPlaylists = (): readonly PlaylistRow[] | undefined =>
  remembered?.version === playlistsVersion.get() ? remembered.rows : undefined;

/** The playlists: remembered ones at once, else read now. */
export const currentPlaylists = (): Promise<readonly PlaylistRow[]> => {
  const known = knownPlaylists();
  return known === undefined
    ? appRuntime.runPromise(listPlaylistsRemembered)
    : Promise.resolve(known);
};

/** Every playlist's name, for checking a new name with Core's `checkPlaylistName`. */
export const playlistNames = (): Promise<readonly string[]> =>
  currentPlaylists().then((playlists) => playlists.map((playlist) => playlist.name));

/** Library tracks [trackIds] as songs a playlist holds (Core's `PlaylistSong`). */
export const libraryPlaylistSongs = (trackIds: readonly number[]): PlaylistSong[] =>
  trackIds.map((trackId) => ({ source: "library", trackId }));

/**
 * Creates a playlist holding [songs] in that order: Library tracks and YT
 * Music songs the Library doesn't have (streamed until it does), a song given
 * twice going in once.
 */
export const createPlaylist = (
  name: string,
  songs: readonly PlaylistSong[] = [],
): Promise<PlaylistAddResult> => edit((store) => store.createPlaylist(name, songs));

// Read the preference after the previous save finishes, including rapid first taps.
let shazamSave: Promise<void> = Promise.resolve();

/** One-tap Recognize save; the ordinary playlist and preference use normal sync. */
export const addToShazam = (song: PlaylistSong): Promise<void> => {
  const save = shazamSave.then(async () => {
    const result = await edit((store) =>
      store.addToShazam(shazamPlaylistId(), song, currentLocalisation().language),
    );
    setShazamPlaylistId(result.syncId);
    showToast(result.toast);
  });
  shazamSave = save.catch(() => {});
  return save;
};

/** A playlist just created empty, as Library › Playlists will list it: for its screen's first frame. */
export const emptyPlaylistRow = (id: number, name: string): PlaylistRow => ({
  id,
  name,
  sort: sortKey(name),
  createdAt: Date.now(),
  trackCount: 0,
  durationMs: 0,
  unavailableCount: 0,
  thumbPaths: [],
  artworkPaths: [],
  hasImage: false,
});

export const renamePlaylist = (id: number, name: string): Promise<void> =>
  edit((store) => store.renamePlaylist(id, name), id);

export const deletePlaylist = (id: number): Promise<void> =>
  edit((store) => store.deletePlaylist(id), id);

/** Deletes playlist image files nothing shows any more; one that won't go is left behind. */
const deleteImageFiles = (paths: readonly string[]): Promise<void> =>
  paths.length === 0 ? Promise.resolve() : WaveNative.deletePlaylistImages(paths).catch(() => {});

/**
 * The crop screen: frames [photo], starting at [framing]. Resolves the
 * framing chosen (Done), or null (Cancel).
 */
export type FramePhoto = (
  photo: PlaylistPhoto,
  framing: ImageFraming,
) => Promise<ImageFraming | null>;

/**
 * Frames [photo] with [frame], then gives the playlist that square of it as
 * its image, keeping [photo] as the original. A [fresh] photo (just picked)
 * is deleted when it doesn't become the original. Resolves false on Cancel.
 */
const framePlaylistImage = async (
  id: number,
  photo: PlaylistPhoto,
  start: ImageFraming,
  frame: FramePhoto,
  fresh: boolean,
): Promise<boolean> => {
  // What a Cancel or a failure leaves behind: the fresh photo, then the new square's files too.
  let discard: readonly string[] = fresh ? [photo.path] : [];
  let unused: readonly string[];
  try {
    const framing = await frame(photo, start);
    if (framing === null) {
      await deleteImageFiles(discard);
      return false;
    }
    const files = await WaveNative.cropPlaylistImage(photo.path, framingSquare(photo, framing));
    discard = [files.path, files.thumbPath, ...discard];
    const image = { ...files, originalPath: photo.path, framing: framingText(photo, framing) };
    unused = await edit((store) => store.setPlaylistImage(id, image), id);
  } catch (error) {
    await deleteImageFiles(discard);
    throw error;
  }
  await deleteImageFiles(unused);
  return true;
};

/**
 * Change Image: opens Android's photo picker, frames the picked photo square
 * with [frame] (the crop screen, from its centre square), and gives the
 * playlist that framing as its image in place of its mosaic, keeping the
 * photo for Adjust Image. The image stays on this phone. Resolves false when
 * nothing was picked or the framing was cancelled.
 */
export const pickPlaylistImage = async (id: number, frame: FramePhoto): Promise<boolean> => {
  const photo = await WaveNative.pickPlaylistPhoto();
  if (photo === null) return false;
  return framePlaylistImage(id, photo, CENTRE_FRAMING, frame, true);
};

/** A saved image's size, in px. */
const imageSize = (path: string): Promise<ImageSize> =>
  Image.getSize(artworkUri({ artworkPath: path }, "original") ?? path);

/**
 * Adjust Image: frames the playlist's original photo again with [frame],
 * starting at the last framing (an image saved before originals were kept is
 * its own original, from its centre). Resolves false when the playlist has no
 * image or the framing was cancelled.
 */
export const adjustPlaylistImage = async (id: number, frame: FramePhoto): Promise<boolean> => {
  const original = await appRuntime.runPromise(
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    LibraryStore.use((store) => store.playlistImageOriginal(id)),
  );
  if (original === null) return false;
  const kept = readFraming(original.framing);
  const size = kept?.size ?? (await imageSize(original.originalPath));
  const photo = { path: original.originalPath, width: size.width, height: size.height };
  return framePlaylistImage(id, photo, kept?.framing ?? CENTRE_FRAMING, frame, false);
};

/** Takes the playlist's image away, so its mosaic shows again. */
export const removePlaylistImage = (id: number): Promise<void> =>
  edit((store) => store.removePlaylistImage(id), id).then(deleteImageFiles);

/**
 * Deletes the image files of playlists deleted here or, through the Wave
 * account, on another phone. Runs after every playlist change and at app start.
 */
const tidyDeletedPlaylistImages = (): void => {
  appRuntime
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    .runPromise(LibraryStore.use((store) => store.takeDeletedPlaylistImages))
    .then(deleteImageFiles)
    .catch(() => {});
};

/** Appends [songs] the playlist doesn't hold yet (Core's `planPlaylistSongs`). */
export const addToPlaylist = (
  id: number,
  songs: readonly PlaylistSong[],
  /** One of a stream of additions (an import filling the playlist): see `playlistsChanged`. */
  { burst = false }: { readonly burst?: boolean } = {},
): Promise<PlaylistAddResult> => edit((store) => store.addToPlaylist(id, songs), id, burst);

export const movePlaylistItem = (
  playlistId: number,
  itemId: number,
  toIndex: number,
): Promise<void> =>
  edit((store) => store.movePlaylistItem(playlistId, itemId, toIndex), playlistId);

/** Makes the playlist hold exactly these songs, in this order (an import's Replace). */
export const replacePlaylistSongs = (
  playlistId: number,
  songs: readonly PlaylistSong[],
): Promise<void> => edit((store) => store.replacePlaylistSongs(playlistId, songs), playlistId);

/** Removes these entries (not every copy of their songs) from the playlist. */
export const removePlaylistItems = (
  playlistId: number,
  itemIds: readonly number[],
): Promise<void> => {
  return edit((store) => store.removePlaylistItems(playlistId, itemIds), playlistId).then(
    (removal) => {
      const count = removal.entries.length;
      if (count === 0) return;
      const text = currentLocalisation().strings.playlists;
      void showToast(text.removed(count), {
        label: text.undo,
        run: () => {
          void edit((store) => store.restorePlaylistItems(removal), playlistId).catch(
            (error: unknown) => showError(text.couldntRestore, error),
          );
        },
      });
    },
  );
};
