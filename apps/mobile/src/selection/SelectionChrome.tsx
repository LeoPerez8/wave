import { formatNumber } from "@wave/core";
import { useLocalisation } from "@/localisation/localisation";
import { IconDots } from "@tabler/icons-react-native";
import { actionBarLabel, entryDivider, splitActionBar } from "@wave/core";
import { memo } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { grid } from "@/catalog/grid";
import { chrome } from "@/chrome/chrome";
import { OnFloatingChrome } from "@/chrome/onFloatingChrome";
import { TextButton } from "@/components/TextButton";
import { Glass } from "@/glass/Glass";
import { IconButton } from "@/components/IconButton";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { MenuRow } from "@/overlay/MenuRow";
import { openOverlay } from "@/overlay/overlay";
import { ACTION_ICONS, type ActionIcon } from "@/playback/actionIcons";
import { targetCount, type ActionItems } from "@/playback/actionTargets";
import { useItemActions, type ActionEntry } from "@/playback/itemActions";

import { endSelection, selectAllInList, useSelectedTarget, useSelectionSummary } from "./selection";

/**
 * Buttons the bar has room for, More included. Primary actions and Delete may
 * take more (Core's `splitActionBar`): a playlist's songs need seven, about
 * 52dp each on a ~412dp phone, where every caption fits on up to two lines at
 * full size ("Unfavorite" breaks at its soft hyphen).
 */
const BAR_SLOTS = 5;

const RADIUS = chrome.selectionBar / 2;

function BarButton({
  icon: Icon,
  label,
  caption = label,
  onPress,
  opensMenu = false,
  destructive = false,
}: {
  icon: ActionIcon;
  label: string;
  /** What the button says under its icon, when shorter than [label]. */
  caption?: string;
  onPress: () => void;
  opensMenu?: boolean;
  destructive?: boolean;
}) {
  return (
    <IconButton
      icon={Icon}
      label={label}
      caption={caption}
      tone={destructive ? "destructive" : "accent"}
      onPress={onPress}
      opensMenu={opensMenu}
      className="flex-1"
      style={{ width: undefined, height: undefined, gap: 2, paddingHorizontal: 2 }}
      captionProps={{
        numberOfLines: 2,
        android_hyphenationFrequency: "normal",
        adjustsFontSizeToFit: true,
        minimumFontScale: 0.85,
        className: "text-center font-sans text-caption font-semibold",
      }}
    />
  );
}

/** The bar's overflow: the remaining entries as a card, like a long-press menu's. */
function MoreCard({ entries, close }: { entries: readonly ActionEntry[]; close: () => void }) {
  const flow = useOverlayFlow();
  return (
    <CardEntries>
      {entries.map((entry, index) => (
        <MenuRow
          key={entry.action}
          action={entry.action}
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
    <OnFloatingChrome value>
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
            icon={ACTION_ICONS[entry.action]}
            label={entry.label}
            caption={actionBarLabel(entry.action)}
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
    </OnFloatingChrome>
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
  const { language } = useLocalisation();
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
          {/* Songs (and albums with songs) say "12 selected"; other kinds name themselves ("3 albums"). */}
          {target === null || target.kind === "track" || target.kind === "mixed"
            ? `${formatNumber(language, summary.count)} selected`
            : targetCount(target)}
        </Text>
        <TextButton label="Select All" disabled={summary.all} onPress={selectAllInList} />
        <TextButton label="Done" onPress={endSelection} />
      </View>
    </View>
  );
}

/**
 * Selection mode's chrome: the header on top and the action bar at the bottom.
 * Memoized: the layouts holding it render on navigation, and it needn't.
 */
export const SelectionChrome = memo(function SelectionChrome({
  backdropId,
}: {
  backdropId: string;
}) {
  return (
    <>
      <SelectionHeader />
      <SelectionBar backdropId={backdropId} />
    </>
  );
});
