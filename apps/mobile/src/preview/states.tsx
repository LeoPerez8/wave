import {
  ITEM_ACTION_LABELS,
  isDestructiveAction,
  itemActions,
  type DesignPreviewState,
} from "@wave/core";
import { usePathname } from "expo-router";
import { useRef, type ComponentRef, type ReactNode } from "react";
import { View } from "react-native";

import { measureRect } from "@/motion/measureRect";
import { pressedRect, runPressedAt } from "@/motion/pressedRect";
import { openOverlay } from "@/overlay/overlay";
import { MenuCard } from "@/playback/ActionsMenu";
import { useLyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";

import { SYNTHETIC_TRACKS, type SyntheticTrack } from "./syntheticLibrary";

/** The Design preview's two shelves. */
export type Shelf = "albums" | "songs";

/**
 * A state the Design preview opens straight into from
 * `wave://design-preview?state=<name>` (Core's `designPreviewState`).
 */
export interface PreviewState extends DesignPreviewState {
  /** The shelf it shows. */
  readonly shelf: Shelf;
  /** The item on that shelf (its index) whose card it opens. */
  readonly item: number;
  /** Opens the card, as a long press on the item would: the item is the pressed one. */
  readonly open: () => void;
}

/** A song row's card, over the row at [index] of the synthetic Songs. */
const songCard = (index: number): Pick<PreviewState, "shelf" | "item" | "open"> => ({
  shelf: "songs",
  item: index,
  open: () => openSongCard(SYNTHETIC_TRACKS[index] as SyntheticTrack),
});

/** Every state, by name. Add one here: a name, a line on what it shows, and how to open it. */
export const PREVIEW_STATES: readonly PreviewState[] = [
  {
    name: "song-card-open",
    shows: "A song's card open over its row, as a long press opens it: the row highlighted.",
    // A plain row: not the playing one, not a missing one, not a favorite.
    ...songCard(3),
  },
];

/**
 * Opens the card a long press on a Library song opens, through the overlay, for a
 * synthetic song: the same entries (Core's `itemActions`, as the Songs list asks
 * for them), each of which only closes the card, so nothing reads or changes the
 * Library.
 */
const openSongCard = ({ track, favorite }: SyntheticTrack): void => {
  openOverlay({
    label: track.title,
    anchor: pressedRect(),
    render: (close) => (
      <PreviewSongMenu
        title={track.title}
        artist={track.artist}
        favorite={favorite}
        close={close}
      />
    ),
  });
};

function PreviewSongMenu({
  title,
  artist,
  favorite,
  close,
}: {
  title: string;
  artist: string;
  favorite: boolean;
  close: () => void;
}) {
  const here = usePathname();
  const onlineLookups = useLyricsAndGenreLookupsEnabled();
  const entries = itemActions({
    kind: "track",
    // Synthetic album and artist ids: Go to Album and Go to Artist show, and go nowhere.
    items: [{ albumId: 1, artistIds: [1], favorite, inPlaylist: false }],
    surface: "menu",
    // The Songs list can select, so its menu offers Select.
    selectable: true,
    onlineLookups,
    here,
  }).map((entry) => ({
    key: entry.action,
    label: ITEM_ACTION_LABELS[entry.action],
    onPress: close,
    destructive: isDestructiveAction(entry.action),
  }));
  return <MenuCard heading={{ title, subtitle: artist, covers: [] }} entries={entries} />;
}

/**
 * Wraps the item a state opens its card over. Once the item is laid out, opens
 * [open] there, measured as a long press measures its row, so the overlay
 * floats the card next to it and highlights it. Opens once.
 */
export function StateAnchor({
  open,
  children,
}: {
  open: (() => void) | undefined;
  children: ReactNode;
}) {
  const view = useRef<ComponentRef<typeof View>>(null);
  const opened = useRef(false);
  const onLayout = () => {
    if (open === undefined || opened.current) return;
    opened.current = true;
    void measureRect(view.current).then((rect) => runPressedAt(rect, open));
  };
  return (
    <View ref={view} collapsable={false} onLayout={onLayout}>
      {children}
    </View>
  );
}
