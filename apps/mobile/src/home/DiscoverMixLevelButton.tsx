import { DISCOVER_MIX_LEVELS, entryDivider, type DiscoverMixLevel } from "@wave/core";
import { Text } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";

import { setDiscoverMixLevel, useDiscoverMixLevel } from "./discoverMixLevel";

const levelOf = (level: DiscoverMixLevel) =>
  DISCOVER_MIX_LEVELS.find((entry) => entry.level === level) ?? DISCOVER_MIX_LEVELS[0]!;

/** The level card: the five levels, from mostly familiar to all new, [current] checked. */
function LevelMenu({
  current,
  choose,
}: {
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
        New music in mixes
      </Text>
      <Hairline />
      <CardEntries>
        {DISCOVER_MIX_LEVELS.map((entry, index) => (
          <EntryRow
            key={entry.level}
            label={`${entry.label} · ${entry.share}`}
            selected={entry.level === current}
            divider={entryDivider(index, DISCOVER_MIX_LEVELS.length, flow)}
            onPress={() => choose(entry.level)}
          />
        ))}
      </CardEntries>
    </>
  );
}

/**
 * Discover mixes' header control: how much of every mix is new ("60% new"),
 * opening the card of levels next to itself. A level chosen re-blends the
 * saved mixes at once, offline.
 */
export function DiscoverMixLevelButton() {
  const level = useDiscoverMixLevel();
  const open = () => {
    openOverlay({
      label: "New music in mixes",
      anchor: pressedRect(),
      render: (close) => (
        <LevelMenu
          current={level}
          choose={(chosen) => {
            setDiscoverMixLevel(chosen);
            close();
          }}
        />
      ),
    });
  };
  return <TextButton label={levelOf(level).share} opensMenu onPress={open} />;
}
