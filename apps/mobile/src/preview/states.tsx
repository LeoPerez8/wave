import {
  ANCHOR_UNMEASURED,
  defaultSongSort,
  playlistImportSources,
  songSortsFor,
  watchAnchor,
  type DesignPreviewState,
} from "@wave/core";
import { useCallback, useEffect, useRef, type ComponentRef, type ReactNode } from "react";
import { View } from "react-native";

import type { AlbumSummary } from "@/catalog/AlbumTile";
import { openSourceMenu } from "@/library/importPlaylistLink";
import type { AlbumRow, SongRow } from "@/library/LibraryStore";
import { promptNewPlaylist } from "@/library/PlaylistSheets";
import type { PlaylistsControl } from "@/library/PlaylistsList";
import { openSortMenu } from "@/library/SongSortButton";
import { measureRect } from "@/motion/measureRect";
import { runPressedAt } from "@/motion/pressedRect";
import { HandOverPress, type PressHandle } from "@/motion/pressHandle";
import { dismissOverlaysFrom } from "@/overlay/overlay";
import { ItemMenuCard, openItemCard } from "@/playback/ActionsMenu";
import type { ActionItems } from "@/playback/actionTargets";
import { actionEntries, usePlannedActions } from "@/playback/itemActions";

import {
  LONG_TITLE_TRACK_ID,
  SYNTHETIC_ALBUMS,
  SYNTHETIC_PLAYLISTS,
  SYNTHETIC_TRACKS,
  type SyntheticTrack,
} from "./syntheticLibrary";

/** The Design preview's shelves. */
export type Shelf = "albums" | "songs" | "playlists" | "search" | "kinds";

/** A control on a shelf that opens a card: the Songs' Sort, the Playlists' Import and New. */
export type Control = "sort" | PlaylistsControl;

/**
 * A state the Design preview opens straight into from
 * `wave://design-preview?state=<name>` (Core's `designPreviewState`).
 */
export interface PreviewState extends DesignPreviewState {
  /** The shelf it shows. */
  readonly shelf: Shelf;
  /**
   * What on that shelf opens the card: an item (its index) or a control. A
   * state that only shows its shelf opens no card, and has neither.
   */
  readonly from?: number | Control;
  /** Opens the card, as a press on [from] would: [from] is the pressed one. */
  readonly open?: () => void;
}

/** Where the long-titled song sits in the synthetic Songs. */
const LONG_TITLE = SYNTHETIC_TRACKS.findIndex(({ track }) => track.id === LONG_TITLE_TRACK_ID);

/** The first plain song: not the playing one, not a missing one, not a favorite, a short title. */
const PLAIN = SYNTHETIC_TRACKS.findIndex(
  ({ track, state, favorite }) =>
    state === undefined && !favorite && track.id !== LONG_TITLE_TRACK_ID,
);

/**
 * Every state, by name: the one list of them. Add one here: a name, a line on
 * what it shows, the shelf, and, when it opens a card, what opens it and how.
 */
export const PREVIEW_STATES: readonly PreviewState[] = [
  {
    name: "song-card-open",
    shows: "A song's card open over its row, as a long press opens it: the row highlighted.",
    shelf: "songs",
    from: PLAIN,
    open: () => openSongCard(SYNTHETIC_TRACKS[PLAIN] as SyntheticTrack),
  },
  {
    name: "song-card-open-long-title",
    shows:
      "A song's card open over a row whose title is too long for it and truncates: the row highlighted, its artwork inside the tint.",
    shelf: "songs",
    from: LONG_TITLE,
    open: () => openSongCard(SYNTHETIC_TRACKS[LONG_TITLE] as SyntheticTrack),
  },
  {
    name: "album-card-open",
    shows: "An album's card open over its tile, as a long press opens it: the tile highlighted.",
    shelf: "albums",
    from: 0,
    open: () => openAlbumCard(SYNTHETIC_ALBUMS[0] as AlbumSummary),
  },
  {
    name: "sort-card-open",
    shows: "The Sort card of a song list open under the Sort button: the button highlighted.",
    shelf: "songs",
    from: "sort",
    open: () => openSortCard(),
  },
  {
    name: "import-playlists-card-open",
    shows:
      "The Import card (From a Link, From Files) open under Library › Playlists' Import Playlists: the button highlighted.",
    shelf: "playlists",
    from: "importPlaylists",
    open: () => openImportCard(),
  },
  {
    name: "new-playlist-prompt-open",
    shows:
      "New Playlist's name prompt, opened from Library › Playlists' New Playlist: the button highlighted, the keyboard up.",
    shelf: "playlists",
    from: "newPlaylist",
    open: () => openNewPlaylistPrompt(),
  },
  {
    name: "search-field",
    shows:
      "Search's field empty, filled, and focused with a query too long for it: the keyboard up.",
    shelf: "search",
  },
  {
    name: "kind-cards",
    shows:
      "The card shapes on trial for each kind (album, artist, song, playlist), alone and mixed (#570).",
    shelf: "kinds",
  },
];

// ---------------------------------------------------------------------------
// The cards, opened by the openers the real controls use, with choices and
// entries that only close them, so nothing reads or changes the Library.

/** The card a long press on a Library song opens, for a synthetic song. */
export const openSongCard = (item: SyntheticTrack): void => {
  const song = songRow(item);
  const target: ActionItems = { kind: "track", items: [{ song }] };
  const favorites = new Set(item.favorite ? [song.id] : []);
  openItemCard(target, (close) => (
    <PreviewItemMenu target={target} favorites={favorites} close={close} />
  ));
};

/** The card a long press on a Library album opens, for a synthetic album. */
export const openAlbumCard = (album: AlbumSummary): void => {
  const target: ActionItems = { kind: "album", items: [albumRow(album)] };
  openItemCard(target, (close) => (
    <PreviewItemMenu target={target} favorites={NO_FAVORITES} close={close} />
  ));
};

/** The Sort card of the Songs list, its default sort (the synthetic Songs' order) checked. */
export const openSortCard = (): void =>
  openSortMenu(songSortsFor("songs"), defaultSongSort("songs"), () => undefined);

/** The Import card Import Playlists opens with YT Music on (with it off there is no card). */
export const openImportCard = (): void =>
  openSourceMenu(playlistImportSources({ ytMusic: true }), () => undefined);

/** New Playlist's name prompt, the synthetic playlists' names taken; the name is dropped. */
export const openNewPlaylistPrompt = (): void => {
  void promptNewPlaylist(
    () => Promise.resolve(SYNTHETIC_PLAYLISTS.map((playlist) => playlist.name)),
    () => Promise.resolve(null),
  );
};

const NO_FAVORITES: ReadonlySet<number> = new Set();

/**
 * A Library item's long-press card for [target], as `ActionsMenu` draws it:
 * the entries the app plans for it, each only closing the card. [favorites]
 * stands in for the Library's stars.
 */
function PreviewItemMenu({
  target,
  favorites,
  close,
}: {
  target: ActionItems;
  favorites: ReadonlySet<number>;
  close: () => void;
}) {
  // The Library's Songs and Albums can select, so their menus offer Select.
  const planned = usePlannedActions(target, favorites, { surface: "menu", selectable: true });
  return (
    <ItemMenuCard target={target} actions={actionEntries(planned, () => close)} play={close} />
  );
}

// Synthetic album and artist ids: Go to Album and Go to Artist show, and go nowhere.
const SYNTHETIC_ID = 1;

/** [item] as a Library song (no artwork, like the synthetic rows). */
const songRow = (item: SyntheticTrack): SongRow => {
  const { track } = item;
  return {
    id: SYNTHETIC_TRACKS.indexOf(item) + 1,
    path: "",
    title: track.title,
    artist: track.artist,
    album: "",
    durationMs: track.durationMs ?? 0,
    thumbPath: null,
    artworkPath: null,
    titleSort: track.title,
    artistSort: track.artist,
    albumSort: "",
    addedAt: 0,
    albumId: SYNTHETIC_ID,
    artistId: SYNTHETIC_ID,
    artistIds: [SYNTHETIC_ID],
    discNumber: null,
    trackNumber: track.trackNumber ?? null,
    year: null,
    genre: null,
    hasLyrics: false,
    explicit: "unknown",
  };
};

/** [album] as a Library album (no artwork, like the synthetic tiles). */
const albumRow = (album: AlbumSummary): AlbumRow => ({
  id: SYNTHETIC_ALBUMS.indexOf(album) + 1,
  title: album.title,
  titleSort: album.title,
  albumArtist: album.albumArtist,
  albumArtistId: SYNTHETIC_ID,
  albumArtistIds: [SYNTHETIC_ID],
  year: album.year ?? null,
  compilation: false,
  trackCount: album.trackCount,
  durationMs: album.durationMs,
  thumbPath: null,
  artworkPath: null,
});

// ---------------------------------------------------------------------------
// Visits: every time the Design preview opens (from a link, again from the
// same link, or from Settings) is a visit, and shows its state afresh.

/** A visit to the Design preview. */
export interface PreviewVisit {
  /** No later visit has started: its state may still open its card. */
  readonly current: () => boolean;
  /** Closes the card its state opened, unless a later visit has started. */
  readonly leave: () => void;
}

/** How many visits have started; the last is the one on screen. */
let visits = 0;
/** The key of the `Press` the current visit's state opened its card from. */
let openedFrom: number | undefined;

const closeStateCard = (): void => {
  if (openedFrom !== undefined) dismissOverlaysFrom(openedFrom);
  openedFrom = undefined;
};

/**
 * Starts a visit: closes the card the last visit's state opened, so no state
 * opens over another's (or stays open under a preview with none), and a
 * state still waiting to open for an earlier visit no longer will.
 */
export const visitDesignPreview = (): PreviewVisit => {
  closeStateCard();
  const visit = ++visits;
  return {
    current: () => visit === visits,
    leave: () => {
      if (visit === visits) closeStateCard();
    },
  };
};

/** Measures of a state's anchor in a row at one rect that make it still. */
const STILL_FOR = 3;
/** Between measures, in ms. */
const MEASURE_EVERY_MS = 50;
/** Measures after which the card opens anyway (2 s). */
const GIVE_UP_AFTER = 40;

/**
 * Wraps what a state opens its card from (a row, tile or button: one `Press`).
 * Once it is laid out and sits still, its screen done sliding in, opens [open]
 * as that `Press`'s long press would: measured where it sits and known by its
 * key, so the overlay floats the card next to it, highlights it and calls it
 * selected. Opens once, for the visit that is [current].
 */
export function StateAnchor({
  open,
  current,
  children,
}: {
  open: () => void;
  current: () => boolean;
  children: ReactNode;
}) {
  const view = useRef<ComponentRef<typeof View>>(null);
  const press = useRef<PressHandle | undefined>(undefined);
  const handOver = useCallback((handle: PressHandle) => {
    press.current = handle;
    return () => {
      if (press.current === handle) press.current = undefined;
    };
  }, []);
  const latest = useRef({ open, current });
  useEffect(() => {
    latest.current = { open, current };
  });

  useEffect(() => {
    let stopped = false;
    let measuring = false;
    let watch = ANCHOR_UNMEASURED;
    const openNow = (): void => {
      if (!stopped && latest.current.current()) latest.current.open();
    };
    const measure = (): void => {
      if (measuring || stopped || !latest.current.current()) return;
      measuring = true;
      void measureRect(view.current).then((measured) => {
        measuring = false;
        if (stopped || !latest.current.current()) return;
        const step = watchAnchor(watch, measured, {
          stillFor: STILL_FOR,
          giveUpAfter: GIVE_UP_AFTER,
        });
        if (!step.open) {
          watch = step.watch;
          return;
        }
        clearInterval(timer);
        const handle = press.current;
        openedFrom = handle?.key ?? 0;
        if (handle === undefined) runPressedAt(step.rect, openNow);
        else void handle.run(openNow);
      });
    };
    const timer = setInterval(measure, MEASURE_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <HandOverPress value={handOver}>
      <View ref={view} collapsable={false}>
        {children}
      </View>
    </HandOverPress>
  );
}
