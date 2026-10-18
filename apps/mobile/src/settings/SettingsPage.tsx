import {
  LAYOUT_PAGES,
  SETTINGS_PAGES,
  type LayoutPage,
  type SettingsIcon,
  type SettingsPage,
  type SettingsTileColour,
} from "@wave/core";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Press } from "@/motion/Press";

import { SettingsTile } from "./SettingsTile";

/** Room between a page's sections. */
const SECTION_GAP = 48;

/** A page of Settings, or one of Settings › Layout's. */
type PageId = { readonly page: SettingsPage } | { readonly layoutPage: LayoutPage };

const pageTitle = (id: PageId): string =>
  ("page" in id
    ? SETTINGS_PAGES.find((entry) => entry.page === id.page)
    : LAYOUT_PAGES.find((entry) => entry.page === id.layoutPage)
  )?.title ?? "";

/** Holds a Settings page's scrolling still; returns how to let go. */
const HoldPageScroll = createContext<() => () => void>(() => () => undefined);

/**
 * Holds the Settings page's scrolling still while [held] (a row of it being
 * dragged), so the drag isn't taken for a scroll.
 */
export const useHoldPageScroll = (held: boolean): void => {
  const hold = useContext(HoldPageScroll);
  useEffect(() => (held ? hold() : undefined), [held, hold]);
};

/**
 * A Settings page: back, its title, then its sections (each one element) with
 * room between them. It scrolls, except while a section holds it still
 * (`useHoldPageScroll`).
 */
export function SettingsPageScreen({ children, ...id }: PageId & { children: ReactNode }) {
  const [holds, setHolds] = useState(0);
  const hold = useCallback(() => {
    setHolds((count) => count + 1);
    return () => setHolds((count) => count - 1);
  }, []);
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={pageTitle(id)} />
      <ScrollView
        scrollEnabled={holds === 0}
        contentContainerStyle={{
          paddingHorizontal: grid.margin,
          paddingBottom: SECTION_GAP,
          gap: SECTION_GAP,
        }}
      >
        <HoldPageScroll.Provider value={hold}>{children}</HoldPageScroll.Provider>
      </ScrollView>
    </View>
  );
}

/**
 * A Settings page whose content scrolls itself, filling the page under the
 * header: an arrangement editor, whose drag holds the scrolling still.
 */
export function SettingsEditorScreen({
  layoutPage,
  children,
}: {
  layoutPage: LayoutPage;
  children: ReactNode;
}) {
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={pageTitle({ layoutPage })} />
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
