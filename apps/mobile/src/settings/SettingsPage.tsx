import { useLocalisation } from "@/localisation/localisation";
import { type Catalogue, type LayoutPage, type SettingsIcon, type SettingsPage } from "@wave/core";
import { memo, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { ScreenHeader } from "@/components/ScreenHeader";
import { StagedSections } from "@/components/StagedSections";
import { useListScrollable } from "@/motion/heldTouch";
import { Press } from "@/motion/Press";

import { SETTINGS_GLYPH_GAP, SettingsGlyph } from "./SettingsGlyph";

/** Room between a page's sections. */
export const SECTION_GAP = 48;

/**
 * A short Settings section's height (a row and its note), for mounting a page's
 * sections across frames; short, so the first frame fills the screen.
 */
const SECTION_ESTIMATE = grid.row + CELL * 4;

/**
 * A page of Settings, one of Settings › Layout's, or a page one of them opens
 * for a single setting (a swipe direction's picker), by its title.
 */
type PageId =
  | { readonly page: SettingsPage }
  | { readonly layoutPage: LayoutPage }
  | { readonly title: string };

const pageTitle = (id: PageId, strings: Catalogue): string => {
  if ("title" in id) return id.title;
  return "page" in id
    ? strings.settings.pages[id.page]
    : strings.settings.layoutPages[id.layoutPage];
};

/**
 * A Settings page: back, its title, then its sections (each one element) with
 * room between them, scrolling. The first frame mounts only the sections on
 * screen and the rest follow a frame later (#1355). It holds still while a long-pressed finger
 * slides on a menu (Touch's sample opens one).
 */
export function SettingsPageScreen({ children, ...id }: PageId & { children: ReactNode }) {
  const { strings } = useLocalisation();
  const scrollable = useListScrollable();
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={pageTitle(id, strings)} />
      <ScrollView
        scrollEnabled={scrollable}
        contentContainerStyle={{
          paddingHorizontal: grid.margin,
          paddingBottom: SECTION_GAP,
          gap: SECTION_GAP,
        }}
      >
        <StagedSections estimate={SECTION_ESTIMATE} gap={SECTION_GAP}>
          {children}
        </StagedSections>
      </ScrollView>
    </View>
  );
}

/**
 * A Settings page whose content scrolls itself, filling the page under the
 * header: an arrangement editor, whose drag holds the scrolling still, or
 * Settings › Downloads' virtualized list.
 */
export function SettingsEditorScreen({ children, ...id }: PageId & { children: ReactNode }) {
  const { strings } = useLocalisation();
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={pageTitle(id, strings)} />
      {children}
    </View>
  );
}

/**
 * A row in Settings opening one of its pages, with a line on what's there when
 * it has one. Settings' own rows lead with their page's glyph; the rows inside
 * a page (Layout's) have none. `trailing` sits on its right edge, outside the
 * row's own press (Version History's Install Now). Memoized: a summary that
 * changes redraws its own row, not the list (#1355).
 */
export const SettingsPageRow = memo(function SettingsPageRow({
  title,
  summary,
  icon,
  trailing,
  onPress,
}: {
  title: string;
  summary: string | null;
  icon?: SettingsIcon;
  trailing?: ReactNode;
  onPress: () => void;
}) {
  return (
    <View>
      <View className="flex-row items-center" style={{ gap: CELL }}>
        <Press
          className="flex-1"
          accessibilityRole="button"
          accessibilityLabel={summary === null ? title : `${title}, ${summary}`}
          onPress={onPress}
          haptic="selection"
        >
          <View
            className="flex-row items-center py-2"
            style={{ minHeight: grid.row, gap: SETTINGS_GLYPH_GAP }}
          >
            {icon !== undefined && <SettingsGlyph icon={icon} />}
            <View className="flex-1 justify-center">
              <Text className="font-sans text-title3 font-normal text-foreground">{title}</Text>
              {summary !== null && (
                <Text numberOfLines={1} className="font-sans text-subheadline text-secondary">
                  {summary}
                </Text>
              )}
            </View>
          </View>
        </Press>
        {trailing}
      </View>
      <Hairline />
    </View>
  );
});
