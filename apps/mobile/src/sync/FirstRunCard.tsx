import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { CardEntries } from "@/overlay/CardEntries";

/**
 * The frame every first-run card shares: its title over the body, scrolling where the card
 * can't fit it, and the buttons right-aligned under it.
 */
export function FirstRunCard({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <>
      <CardEntries>
        <View style={{ gap: CELL * 3, paddingTop: CELL, paddingBottom: CELL * 3 }}>
          <Text
            accessibilityRole="header"
            className="font-sans text-title2 font-light text-foreground"
            style={{ letterSpacing: -0.3 }}
          >
            {title}
          </Text>
          {children}
        </View>
      </CardEntries>
      <View className="flex-row flex-wrap items-center justify-end" style={{ columnGap: CELL * 3 }}>
        {actions}
      </View>
    </>
  );
}
