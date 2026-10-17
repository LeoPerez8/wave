import { LAYOUT_PAGES, SETTINGS_PAGES, type LayoutPage, type SettingsPage } from "@wave/core";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Press } from "@/motion/Press";

/** Room between a page's sections. */
const SECTION_GAP = 48;

/** A page of Settings, or one of Settings › Layout's. */
type PageId = { readonly page: SettingsPage } | { readonly layoutPage: LayoutPage };

const pageTitle = (id: PageId): string =>
  ("page" in id
    ? SETTINGS_PAGES.find((entry) => entry.page === id.page)
    : LAYOUT_PAGES.find((entry) => entry.page === id.layoutPage)
  )?.title ?? "";

/**
 * A Settings page: back, its title, then its sections (each one element) with
 * room between them.
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

/** A row in Settings opening one of its pages, with a line on what's there when it has one. */
export function SettingsPageRow({
  title,
  summary,
  onPress,
}: {
  title: string;
  summary: string | null;
  onPress: () => void;
}) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={summary === null ? title : `${title}, ${summary}`}
      onPress={onPress}
      haptic="selection"
    >
      <View className="justify-center py-2" style={{ minHeight: grid.row }}>
        <Text className="font-sans text-title3 font-normal text-foreground">{title}</Text>
        {summary !== null && (
          <Text numberOfLines={1} className="font-sans text-subheadline text-secondary">
            {summary}
          </Text>
        )}
      </View>
      <Hairline />
    </Press>
  );
}
