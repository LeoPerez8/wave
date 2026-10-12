import type { ReactNode } from "react";
import { View } from "react-native";

import { TextButton } from "@/components/TextButton";

import { CatalogLine } from "./CatalogLine";
import { CELL } from "./grid";

/** A section of a scrolling screen (Home, Stats, an artist): its catalog line, an optional action, then its content. */
export function TitledSection({
  title,
  action,
  first = false,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  /** The first section sits closer to the large title. */
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ marginTop: first ? CELL : CELL * 5, gap: CELL * 1.5 }}>
      <View className="flex-row items-center justify-between" style={{ minHeight: CELL * 6 }}>
        <View className="flex-1">
          <CatalogLine>{title}</CatalogLine>
        </View>
        {action !== undefined && <TextButton label={action.label} onPress={action.onPress} />}
      </View>
      {children}
    </View>
  );
}
