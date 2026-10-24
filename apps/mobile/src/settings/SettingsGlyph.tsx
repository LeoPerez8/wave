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
import type { SettingsIcon } from "@wave/core";
import { View } from "react-native";

import { CELL } from "@/catalog/grid";
import { useThemeColor } from "@/theme/useThemeColor";

/** Keep the former tile's column so row titles and separators stay in place. */
const GLYPH_COLUMN = CELL * 4;
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

/** A Settings page's row leads with a plain glyph in the secondary text tone. */
export function SettingsGlyph({ icon }: { icon: SettingsIcon }) {
  const Glyph = GLYPHS[icon];
  const glyph = useThemeColor("secondary");
  return (
    <View
      className="items-center justify-center"
      style={{ width: GLYPH_COLUMN, height: GLYPH_COLUMN }}
    >
      <Glyph size={GLYPH} color={glyph} strokeWidth={1.75} />
    </View>
  );
}
