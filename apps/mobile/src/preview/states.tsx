import {
  ANCHOR_UNMEASURED,
  defaultSongSort,
  ITEM_ACTION_LABELS,
  isDestructiveAction,
  itemActions,
  playlistImportSources,
  songSortsFor,
  watchAnchor,
  type ActionSubject,
  type DesignPreviewState,
} from "@wave/core";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useRef, type ComponentRef, type ReactNode } from "react";
import { View } from "react-native";

import type { AlbumSummary } from "@/catalog/AlbumTile";
import { SourceMenu } from "@/library/importPlaylistLink";
import { askNewPlaylistName } from "@/library/PlaylistSheets";
import { SortMenu } from "@/library/SongSortButton";
import { measureRect } from "@/motion/measureRect";
import { pressedRect, runPressedAt } from "@/motion/pressedRect";
import { HandOverPress, type PressHandle } from "@/motion/pressHandle";
import { dismissOverlaysFrom, openOverlay } from "@/overlay/overlay";
import { MenuCard } from "@/playback/ActionsMenu";
import type { Heading } from "@/playback/actionTargets";
import { useLyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";

import {
  LONG_TITLE_TRACK_ID,
  SYNTHETIC_ALBUMS,
  SYNTHETIC_PLAYLISTS,
  SYNTHETIC_TRACKS,
  type SyntheticTrack,
} from "./syntheticLibrary";

/** The Design preview's shelves. */
export type Shelf = "albums" | "songs" | "playlists";

/** A control on a shelf that opens a card: the Songs' Sort, the Playlists' Import and New. */
export type Control = "sort" | "importPlaylists" | "newPlaylist";

/**
 * A state the Design preview opens straight into from
 * `wave://design-preview?state=<name>` (Core's `designPreviewState`).
 */
export interface PreviewState extends DesignPreviewState {
  /** The shelf it shows. */
  readonly shelf: Shelf;
  /** What on that shelf opens the card: an item (its index) or a control. */
  readonly from: number | Control;
  /** Opens the card, as a press on [from] would: [from] is the pressed one. */
  readonly open: () => void;
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
 * what it shows, the shelf, what opens the card, and how to open it.
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
];

// ---------------------------------------------------------------------------
// The cards, opened through the overlay as the real controls open them, each
// entry only closing its card, so nothing reads or changes the Library.

/** The card a long press on a Library song opens, for a synthetic song. */
export const openSongCard = ({ track, favorite }: SyntheticTrack): void =>
  openItemCard(
    { title: track.title, subtitle: track.artist, covers: [] },
    // Synthetic album and artist ids: Go to Album and Go to Artist show, and go nowhere.
    { kind: "track", items: [{ albumId: 1, artistIds: [1], favorite, inPlaylist: false }] },
  );

/** The card a long press on a Library album opens, for a synthetic album. */
export const openAlbumCard = (album: AlbumSummary): void =>
  openItemCard(
    { title: album.title, subtitle: album.albumArtist, covers: [] },
    // A synthetic artist id: Go to Artist shows, and goes nowhere.
    { kind: "album", items: [{ artistIds: [1] }] },
  );

/** The Sort card of the Songs list, its default sort (the synthetic Songs' order) checked. */
export const openSortCard = (): void => {
  openOverlay({
    label: "Sort by",
    anchor: pressedRect(),
    render: (close) => (
      <SortMenu sorts={songSortsFor("songs")} current={defaultSongSort("songs")} choose={close} />
    ),
  });
};

/** The Import card Import Playlists opens with YT Music on (with it off there is no card). */
export const openImportCard = (): void => {
  openOverlay({
    label: "Import",
    anchor: pressedRect(),
    render: (close) => (
      <SourceMenu sources={playlistImportSources({ ytMusic: true })} choose={close} />
    ),
  });
};

/** New Playlist's name prompt, the synthetic playlists' names taken; the name is dropped. */
export const openNewPlaylistPrompt = (): void => {
  void askNewPlaylistName(SYNTHETIC_PLAYLISTS.map((playlist) => playlist.name));
};

/** A Library item's long-press card, through the overlay: [heading], then the entries for [subject]. */
const openItemCard = (heading: Heading, subject: Pick<ActionSubject, "kind" | "items">): void => {
  openOverlay({
    label: heading.title,
    anchor: pressedRect(),
    render: (close) => <PreviewItemMenu heading={heading} subject={subject} close={close} />,
  });
};

function PreviewItemMenu({
  heading,
  subject,
  close,
}: {
  heading: Heading;
  subject: Pick<ActionSubject, "kind" | "items">;
  close: () => void;
}) {
  const here = usePathname();
  const onlineLookups = useLyricsAndGenreLookupsEnabled();
  const entries = itemActions({
    ...subject,
    surface: "menu",
    // The Library's Songs and Albums can select, so their menus offer Select.
    selectable: true,
    onlineLookups,
    here,
  }).map((entry) => ({
    key: entry.action,
    label: ITEM_ACTION_LABELS[entry.action],
    onPress: close,
    destructive: isDestructiveAction(entry.action),
  }));
  return <MenuCard heading={heading} entries={entries} />;
}

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watch = ANCHOR_UNMEASURED;
    const openNow = (): void => {
      if (latest.current.current()) latest.current.open();
    };
    const measure = (): void => {
      void measureRect(view.current).then((measured) => {
        if (stopped || !latest.current.current()) return;
        const step = watchAnchor(watch, measured, {
          stillFor: STILL_FOR,
          giveUpAfter: GIVE_UP_AFTER,
        });
        if (!step.open) {
          watch = step.watch;
          timer = setTimeout(measure, MEASURE_EVERY_MS);
          return;
        }
        const handle = press.current;
        openedFrom = handle?.key ?? 0;
        if (handle === undefined) runPressedAt(step.rect, openNow);
        else void handle.run(openNow);
      });
    };
    timer = setTimeout(measure, MEASURE_EVERY_MS);
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
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
