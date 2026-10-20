import {
  IconBooks,
  IconCode,
  IconDownload,
  IconLayoutGrid,
  IconPalette,
  IconPlayerPlay,
  IconQuote,
  IconSwipe,
  IconUser,
  type Icon,
} from "@tabler/icons-react-native";
import type { SettingsIcon, SettingsTileColour } from "@wave/core";
import { View } from "react-native";

import { CELL } from "@/catalog/grid";
import { useThemeColor } from "@/theme/useThemeColor";

/** The tile's side: four cells, as iOS Settings sizes its icons against a row. */
export const SETTINGS_TILE = CELL * 4;
const GLYPH = 20;

const GLYPHS: Readonly<Record<SettingsIcon, Icon>> = {
  books: IconBooks,
  palette: IconPalette,
  layout: IconLayoutGrid,
  swipe: IconSwipe,
  play: IconPlayerPlay,
  quote: IconQuote,
  download: IconDownload,
  user: IconUser,
  code: IconCode,
};

/** Whole class names, so Tailwind sees each (`--color-tile-<name>` in global.css). */
const FILLS: Readonly<Record<SettingsTileColour, string>> = {
  red: "bg-tile-red",
  orange: "bg-tile-orange",
  green: "bg-tile-green",
  cyan: "bg-tile-cyan",
  blue: "bg-tile-blue",
  indigo: "bg-tile-indigo",
  purple: "bg-tile-purple",
  pink: "bg-tile-pink",
  grey: "bg-tile-grey",
};

/** The glyph a Settings page's row leads with: white, on its own colour, in a rounded square. */
export function SettingsTile({ icon, colour }: { icon: SettingsIcon; colour: SettingsTileColour }) {
  const Glyph = GLYPHS[icon];
  const glyph = useThemeColor("on-tile");
  return (
    <View
      className={`items-center justify-center ${FILLS[colour]}`}
      style={{
        width: SETTINGS_TILE,
        height: SETTINGS_TILE,
        borderRadius: CELL,
        borderCurve: "continuous",
      }}
    >
      <Glyph size={GLYPH} color={glyph} strokeWidth={1.75} />
    </View>
  );
}
