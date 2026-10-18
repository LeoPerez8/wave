import { PLAY_ACTION_LABELS, entryDivider, withOpacity, type PlayCard } from "@wave/core";
import { Text, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import { useShuffleControl } from "@/nowPlaying/ShuffleMenu";
import { ACTION_ICONS, type MenuAction } from "@/playback/actionIcons";
import { useThemeColor } from "@/theme/useThemeColor";

import { CardEntries } from "./CardEntries";
import { useOverlayFlow } from "./flow";
import { MenuRow } from "./MenuRow";
import { useSlideToChoose } from "./useSlideToChoose";

/** One row of a menu's list. */
export interface MenuChoice {
  /** What it does, which picks its icon. */
  readonly action: MenuAction;
  readonly label: string;
  readonly onPress: () => void;
  /** Deletes something for good: drawn in the destructive colour. */
  readonly destructive?: boolean | undefined;
}

/** One of the play cards at the top of a menu (Core's `menuLayout`). */
export interface PlayCardChoice {
  readonly action: PlayCard;
  readonly onPress: () => void;
}

/** A card's fill: a wash of the card's ink, which shows on glass in any theme, as its dividers do. */
const CARD_FILL = 0.08;
const CARD_RADIUS = CELL * 1.5;
const CARD_ICON = 24;
const CARD_STROKE = 1.75;

/** A play card: the action's icon over its short label, in the menu's ink. */
function PlayCardButton({
  action,
  onPress,
  highlighted,
}: {
  action: PlayCard;
  onPress: () => void;
  highlighted: boolean;
}) {
  const ink = useThemeColor("foreground");
  const Icon = ACTION_ICONS[action];
  const label = PLAY_ACTION_LABELS[action];
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      haptic="selection"
      highlighted={highlighted}
      className="items-center justify-center"
      style={{
        minHeight: grid.row + CELL * 2,
        borderRadius: CARD_RADIUS,
        backgroundColor: withOpacity(ink, CARD_FILL),
        paddingVertical: CELL * 1.5,
        paddingHorizontal: CELL / 2,
        gap: CELL / 2,
      }}
    >
      <Icon size={CARD_ICON} color={ink} strokeWidth={CARD_STROKE} />
      <Text numberOfLines={2} className="text-center font-sans text-footnote text-foreground">
        {label}
      </Text>
    </Press>
  );
}

/**
 * What a long-press menu offers under its heading: its play [cards] in one
 * row of equal-width cards, then its [entries] as list rows (Shuffle drawn as
 * the shuffle kind chosen names it). The finger that long-pressed the row can
 * slide onto a card or an entry and lift to run it; the one under it shows
 * pressed meanwhile.
 */
export function MenuChoices({
  cards,
  entries,
}: {
  cards: readonly PlayCardChoice[];
  entries: readonly MenuChoice[];
}) {
  // Cards first, then the entries, by one index.
  const { underFinger, trackEntry, trackList } = useSlideToChoose((index) =>
    index < cards.length ? cards[index]?.onPress() : entries[index - cards.length]?.onPress(),
  );
  const flow = useOverlayFlow();
  const shuffle = useShuffleControl();

  return (
    <View ref={trackList} collapsable={false} style={{ flexShrink: 1 }}>
      {cards.length > 0 && (
        <View className="flex-row" style={{ gap: CELL, paddingVertical: CELL }}>
          {cards.map((card, index) => (
            <View key={card.action} ref={trackEntry(index)} collapsable={false} style={{ flex: 1 }}>
              <PlayCardButton
                action={card.action}
                onPress={card.onPress}
                highlighted={index === underFinger}
              />
            </View>
          ))}
        </View>
      )}
      {/* The first entry sits nearest the finger, whichever side of the row the card opened on. */}
      <CardEntries>
        {entries.map((entry, index) => (
          <View key={entry.action} ref={trackEntry(cards.length + index)} collapsable={false}>
            <MenuRow
              action={entry.action}
              icon={entry.action === "shuffle" ? shuffle.icon : undefined}
              label={entry.action === "shuffle" ? shuffle.label : entry.label}
              onPress={entry.onPress}
              divider={entryDivider(index, entries.length, flow)}
              highlighted={cards.length + index === underFinger}
              destructive={entry.destructive === true}
            />
          </View>
        ))}
      </CardEntries>
    </View>
  );
}
