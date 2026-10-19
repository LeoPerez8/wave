import {
  DISCOVER_MIX_LEVELS,
  MAGIC_QUEUE_LEVELS,
  entryDivider,
  type DiscoverMixLevel,
} from "@wave/core";
import { Text } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";

import { setDiscoverMixLevel, useDiscoverMixLevel, type LevelSectionId } from "./discoverMixLevel";

type Levels = typeof DISCOVER_MIX_LEVELS;

/** Each section's card: its title, and its levels with the share each gives. */
const CARDS: Record<LevelSectionId, { readonly title: string; readonly levels: Levels }> = {
  "artist-mixes": { title: "New music in mixes", levels: DISCOVER_MIX_LEVELS },
  "genre-mixes": { title: "New music in mixes", levels: DISCOVER_MIX_LEVELS },
  "magic-queue": { title: "New music in the Magic Queue", levels: MAGIC_QUEUE_LEVELS },
};

const levelOf = (levels: Levels, level: DiscoverMixLevel) =>
  levels.find((entry) => entry.level === level) ?? levels[0]!;

/** The level card: the five levels, from mostly familiar to all new, [current] checked. */
function LevelMenu({
  title,
  levels,
  current,
  choose,
}: {
  title: string;
  levels: Levels;
  current: DiscoverMixLevel;
  choose: (level: DiscoverMixLevel) => void;
}) {
  const flow = useOverlayFlow();
  return (
    <>
      <Text
        accessibilityRole="header"
        className="font-sans text-body font-medium text-foreground"
        style={{ paddingBottom: CELL * 1.5 }}
      >
        {title}
      </Text>
      <Hairline />
      <CardEntries>
        {levels.map((entry, index) => (
          <EntryRow
            key={entry.level}
            label={`${entry.label} · ${entry.share}`}
            selected={entry.level === current}
            divider={entryDivider(index, levels.length, flow)}
            onPress={() => choose(entry.level)}
          />
        ))}
      </CardEntries>
    </>
  );
}

/**
 * A section's header control (Artist mixes, Genre mixes, Magic Queue): how
 * much of what it plays is new ("60% new"), opening the card of levels next
 * to itself. A level chosen re-blends a mix section's saved mixes at once,
 * offline, and sets the share the next Magic Queue starts at. With a
 * [disabledNote] it's disabled: dimmed, opening nothing, the note in place
 * of the share (the Magic Queue's "Needs YT Music" while YT Music is off).
 */
export function DiscoverMixLevelButton({
  section,
  disabledNote,
}: {
  section: LevelSectionId;
  disabledNote?: string;
}) {
  const level = useDiscoverMixLevel(section);
  const { title, levels } = CARDS[section];
  const open = () => {
    openOverlay({
      label: title,
      anchor: pressedRect(),
      render: (close) => (
        <LevelMenu
          title={title}
          levels={levels}
          current={level}
          choose={(chosen) => {
            setDiscoverMixLevel(section, chosen);
            close();
          }}
        />
      ),
    });
  };
  return (
    <TextButton
      label={disabledNote ?? levelOf(levels, level).share}
      opensMenu
      disabled={disabledNote !== undefined}
      onPress={open}
    />
  );
}
