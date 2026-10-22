import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { TextButton } from "@/components/TextButton";

import { CatalogLine } from "./CatalogLine";
import { CELL } from "./grid";

/** A section of a scrolling screen (Home, Stats, an artist): its catalog line, an optional action, then its content. */
export function TitledSection({
  title,
  action,
  control,
  status,
  first = false,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  /** A control of its own in the action's place (Discover's settings icon), when it has no action. */
  control?: ReactNode;
  /**
   * A quiet line after the title for what the section is doing ("Updating…"
   * while mixes rebuild), read out as it changes; absent for none.
   */
  status?: string | undefined;
  /** The first section sits closer to the large title. */
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ marginTop: first ? CELL : CELL * 5, gap: CELL * 1.5 }}>
      <View className="flex-row items-center justify-between" style={{ minHeight: CELL * 6 }}>
        <View className="flex-1 flex-row items-center" style={{ gap: CELL }}>
          <CatalogLine className="shrink">{title}</CatalogLine>
          {status !== undefined && (
            <Text
              numberOfLines={1}
              accessibilityLiveRegion="polite"
              className="font-sans text-footnote text-secondary"
            >
              {status}
            </Text>
          )}
        </View>
        {action !== undefined ? (
          <TextButton label={action.label} onPress={action.onPress} />
        ) : (
          control
        )}
      </View>
      {children}
    </View>
  );
}
