import {
  LAYOUT_PAGES,
  SETTINGS_PAGES,
  type LayoutPage,
  type SettingsIcon,
  type SettingsPage,
  type SettingsTileColour,
} from "@wave/core";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Press } from "@/motion/Press";

import { SettingsTile } from "./SettingsTile";

/** Room between a page's sections. */
export const SECTION_GAP = 48;

/**
 * A page of Settings, one of Settings › Layout's, or a page one of them opens
 * for a single setting (a swipe direction's picker), by its title.
 */
type PageId =
  | { readonly page: SettingsPage }
  | { readonly layoutPage: LayoutPage }
  | { readonly title: string };

const pageTitle = (id: PageId): string => {
  if ("title" in id) return id.title;
  const entry =
    "page" in id
      ? SETTINGS_PAGES.find(({ page }) => page === id.page)
      : LAYOUT_PAGES.find(({ page }) => page === id.layoutPage);
  return entry?.title ?? "";
};

/**
 * A Settings page: back, its title, then its sections (each one element) with
 * room between them, scrolling.
 */
export function SettingsPageScreen({ children, ...id }: PageId & { children: ReactNode }) {
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={pageTitle(id)} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: grid.margin,
          paddingBottom: SECTION_GAP,
          gap: SECTION_GAP,
        }}
      >
        {children}
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
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={pageTitle(id)} />
      {children}
    </View>
  );
}

/**
 * A row in Settings opening one of its pages, with a line on what's there when
 * it has one. Settings' own rows lead with their page's tile; the rows inside
 * a page (Layout's) have none.
 */
export function SettingsPageRow({
  title,
  summary,
  tile,
  onPress,
}: {
  title: string;
  summary: string | null;
  tile?: { icon: SettingsIcon; colour: SettingsTileColour };
  onPress: () => void;
}) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={summary === null ? title : `${title}, ${summary}`}
      onPress={onPress}
      haptic="selection"
    >
      <View className="flex-row items-center py-2" style={{ minHeight: grid.row, gap: CELL * 2 }}>
        {tile !== undefined && <SettingsTile icon={tile.icon} colour={tile.colour} />}
        <View className="flex-1 justify-center">
          <Text className="font-sans text-title3 font-normal text-foreground">{title}</Text>
          {summary !== null && (
            <Text numberOfLines={1} className="font-sans text-subheadline text-secondary">
              {summary}
            </Text>
          )}
        </View>
      </View>
      <Hairline />
    </Press>
  );
}
