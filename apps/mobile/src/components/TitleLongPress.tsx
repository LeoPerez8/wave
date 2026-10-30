import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";

import { useLocalisation } from "@/localisation/localisation";
import { Press } from "@/motion/Press";

/**
 * What a long press on a screen's title opens: that screen's options. Give it
 * to `LargeTitle`, `LargeTitleScreen` or `ScreenHeader` as `titleLongPress`.
 */
export interface TitleLongPress {
  /** What the long press does, for screen readers, e.g. "Choose how playlists show". */
  readonly label: string;
  /**
   * Opens the options. A card it opens with `openTitleChoices`, or with
   * `anchor: pressedRect()`, floats next to the title and keeps it highlighted;
   * a choice card from `openTitleChoices` also takes slide to choose.
   */
  readonly open: () => void;
}

/**
 * A screen title, made to take [titleLongPress] when it has one (and drawn as
 * it is when it hasn't). A tap does nothing, so scrolling from the title
 * never opens anything.
 */
export function TitlePress({
  titleLongPress,
  children,
}: {
  titleLongPress: TitleLongPress | undefined;
  children: ReactNode;
}) {
  const { strings } = useLocalisation();
  if (titleLongPress === undefined) return children;
  return (
    <Press
      accessibilityRole="header"
      accessibilityHint={strings.settings.titleLongPressHint(titleLongPress.label)}
      accessibilityActions={[{ name: "activate", label: titleLongPress.label }]}
      onAccessibilityAction={({ nativeEvent: { actionName } }) => {
        if (actionName === "activate") titleLongPress.open();
      }}
      onLongPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        titleLongPress.open();
      }}
      depth={0.02}
    >
      {children}
    </Press>
  );
}
