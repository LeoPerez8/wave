import { beginTiming } from "@/lib/timing";
import {
  itemActions,
  parseTrackId,
  ytSongActions,
  type ItemActionEntry,
  type NowPlayingAction,
  type YtSongActionEntry,
} from "@wave/core";
import type { ArtistRow, SongRow } from "@wave/client";
import { useMemo } from "react";

import { followArtistLink, followStreamedArtistLink } from "@/library/ArtistChoice";
import { useLinkRows } from "@/library/hooks";
import { openAlbum, useCurrentPath } from "@/library/routes";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { targetFacts, type ActionItems } from "@/playback/actionTargets";
import { goToArtistPress } from "@/playback/goToArtistPress";
import { itemActionPress } from "@/playback/itemActions";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import type { FindInLibrary } from "@/ytmusic/libraryFinder";
import { openYtAlbum, ytAlbumPageHere } from "@/ytmusic/routes";
import { useStreamedArtistLink } from "@/ytmusic/streamedArtist";
import { runYtSongSwipe } from "@/ytmusic/YtSongActions";

import { usePlayingSongAnswer, usePlayingSongTarget } from "./playingSong";
import { closeNowPlayingForLink } from "./sheet";

/**
 * Now Playing's slots for Magic Queue, Go to Artist and Go to Album: each runs
 * the playing song's card's entry of the same name (Core's `itemActions` for
 * a Library song, `ytSongActions` for a streamed one, with `playing` set), as
 * the card plans it now, so a slot does what the card would and is off where
 * the card has no such entry (Core's `nowPlayingSlotShow`). Go to Artist and
 * Go to Album close Now Playing as the player's artist and album lines do,
 * and the page opens under it.
 */

/** The slot actions that run an entry of the playing song's card. */
export type SongMenuSlotAction = Extract<
  NowPlayingAction,
  "magicQueue" | "goToArtist" | "goToAlbum"
>;

/** The playing song's card, as the slots read it, and what pressing one of its entries does. */
export interface PlayingSongMenu {
  /** The card's actions, for Core's `nowPlayingSlotShow`. */
  readonly actions: readonly string[];
  /** Runs the card's entry for [action] as the card does; nothing while the card has none. */
  readonly run: (action: SongMenuSlotAction) => void;
}

const NO_FAVORITES: ReadonlySet<number> = new Set();
const NO_ACTIONS: readonly string[] = [];
const findNothing: FindInLibrary = () => null;
const nothing = (): void => undefined;

/** The Library song [song]'s card at [here], as the playing song's menu plans it. */
const libraryCard = (
  target: ActionItems,
  here: string,
  ytMusic: boolean,
): readonly ItemActionEntry<ArtistRow>[] =>
  itemActions<ArtistRow>({
    kind: "track",
    items: targetFacts(target, NO_FAVORITES, findNothing),
    surface: "menu",
    selectable: false,
    here,
    ytMusic,
    playing: true,
  });

/** Runs a Library song's card entry for a slot. */
const runLibraryEntry = (
  entry: ItemActionEntry<ArtistRow>,
  target: ActionItems,
  here: string,
  links: ReturnType<typeof useLinkRows>,
): void => {
  switch (entry.action) {
    case "goToAlbum": {
      const { albumId } = entry;
      beginTiming("albumLink", "Album");
      closeNowPlayingForLink(() => openAlbum(albumId, links.album));
      return;
    }
    case "goToArtist":
      goToArtistPress(entry, {
        begin: () => beginTiming("goToArtist", "Artist"),
        run: (go) => () => closeNowPlayingForLink(go),
        follow: (artists) => followArtistLink(artists, links.artist),
        followStreamed: followStreamedArtistLink,
      })();
      return;
    default:
      itemActionPress({ target, surface: "menu", finish: nothing, here, find: findNothing, links })(
        entry,
      )();
  }
};

/** Runs a streamed song's card entry for a slot. */
const runStreamEntry = (entry: YtSongActionEntry<ArtistRow>, song: NativeYtSong): void => {
  switch (entry.action) {
    case "goToAlbum": {
      const { album } = entry;
      beginTiming("albumLink", "Album");
      // The page heads with what the song knows of its album until the page is read.
      closeNowPlayingForLink(() =>
        openYtAlbum(album, { title: song.album ?? "", line: "", artworkUrl: song.artworkUrl }),
      );
      return;
    }
    case "goToArtist": {
      const { artists } = entry;
      beginTiming("goToArtist", "Artist");
      closeNowPlayingForLink(() => followStreamedArtistLink(artists));
      return;
    }
    case "magicQueue":
      // The card's own runner, on the press: it reads the Library's song (the
      // Magic Queue grows from its file when it has one by now) and starts it.
      runYtSongSwipe(song, "magicQueue");
      return;
    default:
      return;
  }
};

/**
 * The playing song's card for the slots, followed while [active] (a slot holds
 * one of these actions and Now Playing shows): a Library song's once its row
 * is read, a streamed song's at once, none for an unsearched entry (which has
 * no card while its search runs) or with nothing playing.
 */
export const usePlayingSongMenu = (
  trackId: string | null,
  ytSong: NativeYtSong | null,
  active: boolean,
): PlayingSongMenu => {
  const ref = trackId === null ? null : parseTrackId(trackId);
  const libraryId = active && ref?.kind === "library" ? ref.id : null;
  const stream = active && ref?.kind === "yt" ? ytSong : null;
  const here = useCurrentPath(active);
  const ytMusic = useYtMusicEnabled();
  // The sheet reads the same answer for its controls; a Library song's row is its `track`.
  const answer = usePlayingSongAnswer(
    usePlayingSongTarget(libraryId === null ? null : trackId, null),
  );
  const song: SongRow | null =
    libraryId !== null && answer?.track?.id === libraryId ? answer.track : null;
  const artists = useStreamedArtistLink(stream === null ? null : stream.artists, active);
  const target = useMemo<ActionItems | null>(
    () => (song === null ? null : { kind: "track", items: [{ song }] }),
    [song],
  );
  const library = useMemo(
    () => (target === null ? [] : libraryCard(target, here, ytMusic)),
    [target, here, ytMusic],
  );
  const streamed = useMemo(
    () =>
      stream === null
        ? []
        : ytSongActions(artists, {
            album: stream.albumId,
            ytAlbumHere: ytAlbumPageHere(here),
            ytMusic,
            playing: true,
          }),
    [stream, artists, here, ytMusic],
  );
  // Read ahead, so Go to Album and Go to Artist open header-first, as the card's do.
  let albumId: number | undefined;
  let artistId: number | undefined;
  for (const entry of library) {
    if (entry.action === "goToAlbum") albumId = entry.albumId;
    if (entry.action === "goToArtist" && "artists" in entry && entry.artists.kind === "open")
      artistId = entry.artists.artistId;
  }
  const links = useLinkRows(albumId, artistId, target !== null);
  const actions = useMemo(
    () =>
      target !== null
        ? library.map(({ action }) => action)
        : stream !== null
          ? streamed.map(({ action }) => action)
          : NO_ACTIONS,
    [target, library, stream, streamed],
  );
  return {
    actions,
    run: (action) => {
      if (target !== null) {
        const entry = library.find((planned) => planned.action === action);
        if (entry !== undefined) runLibraryEntry(entry, target, here, links);
      } else if (stream !== null) {
        const entry = streamed.find((planned) => planned.action === action);
        if (entry !== undefined) runStreamEntry(entry, stream);
      }
    },
  };
};
