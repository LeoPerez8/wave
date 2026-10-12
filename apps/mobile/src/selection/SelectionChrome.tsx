import {
  IconArrowForwardUp,
  IconDisc,
  IconDots,
  IconListCheck,
  IconMicrophone2,
  IconPencil,
  IconPlaylistAdd,
  IconPlaylistX,
  IconRowInsertBottom,
  IconStar,
  IconStarOff,
  IconTrash,
} from "@tabler/icons-react-native";
import { entryDivider, splitActionBar, type ItemAction } from "@wave/core";
import type { ComponentType } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EntryRow } from "@/catalog/EntryRow";
import { grid } from "@/catalog/grid";
import { chrome } from "@/chrome/chrome";
import { TextButton } from "@/components/TextButton";
import { Glass } from "@/glass/Glass";
import { Press } from "@/motion/Press";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import {
  targetCount,
  useItemActions,
  type ActionEntry,
  type ActionItems,
} from "@/playback/itemActions";
import { useThemeColor } from "@/theme/useThemeColor";

import { endSelection, selectAllInList, useSelectedTarget, useSelectionSummary } from "./selection";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const ICONS: { readonly [A in ItemAction]: ComponentType<IconProps> } = {
  playNext: IconArrowForwardUp,
  addToQueue: IconRowInsertBottom,
  addToPlaylist: IconPlaylistAdd,
  favorite: IconStar,
  unfavorite: IconStarOff,
  removeFromPlaylist: IconPlaylistX,
  goToAlbum: IconDisc,
  goToArtist: IconMicrophone2,
  renamePlaylist: IconPencil,
  deletePlaylist: IconTrash,
  select: IconListCheck,
  delete: IconTrash,
};

/** Buttons the bar has room for, More included. */
const BAR_SLOTS = 5;

const RADIUS = chrome.selectionBar / 2;

function BarButton({
  icon: Icon,
  label,
  onPress,
  opensMenu = false,
  destructive = false,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
  opensMenu?: boolean;
  destructive?: boolean;
}) {
  const accent = useThemeColor("accent");
  const danger = useThemeColor("destructive");
  const tone = destructive ? danger : accent;
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      opensMenu={opensMenu}
      haptic="selection"
      depth={0.1}
      className="flex-1 items-center justify-center"
      style={{ gap: 2 }}
    >
      <Icon size={24} color={tone} strokeWidth={1.5} />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        className="font-sans text-caption font-semibold"
        style={{ color: tone }}
      >
        {label}
      </Text>
    </Press>
  );
}

/** The bar's overflow: the remaining entries as a card, like a long-press menu's. */
function MoreCard({ entries, close }: { entries: readonly ActionEntry[]; close: () => void }) {
  const flow = useOverlayFlow();
  return (
    <CardEntries>
      {entries.map((entry, index) => (
        <EntryRow
          key={entry.action}
          label={entry.label}
          onPress={() => {
            close();
            entry.onPress();
          }}
          divider={entryDivider(index, entries.length, flow)}
          destructive={entry.destructive}
        />
      ))}
    </CardEntries>
  );
}

function ActionBar({ target, backdropId }: { target: ActionItems; backdropId: string }) {
  const insets = useSafeAreaInsets();
  const entries = useItemActions(target, { surface: "selection", finish: endSelection });
  const { bar, more } = splitActionBar(entries, BAR_SLOTS);
  return (
    <View
      accessibilityRole="toolbar"
      accessibilityLabel="Selection actions"
      pointerEvents="box-none"
      className="absolute flex-row"
      style={{
        left: grid.margin,
        right: grid.margin,
        bottom: insets.bottom + chrome.gap,
        height: chrome.selectionBar,
      }}
    >
      <Glass backdropId={backdropId} cornerRadius={RADIUS} />
      {bar.map((entry) => (
        <BarButton
          key={entry.action}
          icon={ICONS[entry.action]}
          label={entry.label}
          onPress={entry.onPress}
          destructive={entry.destructive}
        />
      ))}
      {more.length > 0 && (
        <BarButton
          icon={IconDots}
          label="More"
          opensMenu
          onPress={() =>
            openOverlay({
              label: "More actions",
              anchor: pressedRect(),
              render: (close) => <MoreCard entries={more} close={close} />,
            })
          }
        />
      )}
    </View>
  );
}

/**
 * The floating glass selection bar, in place of the mini player and tab bar
 * while a list is selecting: the same actions as the items' long-press menu
 * (the shared list in `itemActions`), acting on the checked items in list
 * order, after which selection mode ends. Overflow goes behind More.
 */
export function SelectionBar({ backdropId }: { backdropId: string }) {
  const target = useSelectedTarget();
  if (target === null) return null;
  return <ActionBar target={target} backdropId={backdropId} />;
}

/**
 * The top of the screen while a list is selecting: the count ("12 selected", "3 albums"), Select All
 * and Done, over the screen's own header.
 */
export function SelectionHeader() {
  const insets = useSafeAreaInsets();
  const summary = useSelectionSummary();
  const target = useSelectedTarget();
  if (summary === null) return null;
  return (
    <View
      className="absolute left-0 right-0 top-0 bg-background"
      style={{ paddingTop: insets.top + 4 }}
    >
      <View
        className="flex-row items-center"
        style={{ minHeight: 48, paddingHorizontal: grid.margin, gap: grid.margin }}
      >
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          numberOfLines={1}
          className="flex-1 font-sans text-title3 font-medium text-foreground"
        >
          {/* Songs say "12 selected"; other kinds name themselves ("3 albums"). */}
          {target === null || target.kind === "track"
            ? `${summary.count.toLocaleString("en")} selected`
            : targetCount(target)}
        </Text>
        <TextButton label="Select All" disabled={summary.all} onPress={selectAllInList} />
        <TextButton label="Done" onPress={endSelection} />
      </View>
    </View>
  );
}

/** Selection mode's chrome: the header on top and the action bar at the bottom. */
export function SelectionChrome({ backdropId }: { backdropId: string }) {
  return (
    <>
      <SelectionHeader />
      <SelectionBar backdropId={backdropId} />
    </>
  );
}
