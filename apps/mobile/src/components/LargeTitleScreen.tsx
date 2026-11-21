import { TITLE_MARK_TOKENS, titleMarkFontScale, titleMarkLayout } from "@wave/core";
import { useScrollToTop } from "expo-router";
import { useRef, type ReactElement, type ReactNode } from "react";
import {
  ScrollView,
  type ScrollViewInstance,
  Text,
  View,
  type RefreshControlProps,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { grid } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { useListScrollable } from "@/motion/heldTouch";
import { useRenderCount } from "@/perf/perf";
import { useThemeColor } from "@/theme/useThemeColor";

import { WaveMark } from "./WaveMark";
import { TitlePress, type TitleLongPress } from "./TitleLongPress";

type Props = {
  title: string;
  /** Draws Wave's two waves before the title (Home's). */
  waves?: boolean | undefined;
  /** A single trailing control on the title line (e.g. Settings). */
  action?: ReactNode;
  /** What a long press on the title opens: the screen's options. */
  titleLongPress?: TitleLongPress | undefined;
  children?: ReactNode;
  /** Pull to refresh (a `RefreshControl`). */
  refreshControl?: ReactElement<RefreshControlProps>;
};

/** The large title's type (`--text-large-title` in global.css), in dp at the standard font scale. */
const LARGE_TITLE = { fontSize: 36, lineHeight: 44 } as const;

/** The width a title line's trailing control takes: an `IconButton`'s 48dp target. */
const ACTION_WIDTH = 48;

/**
 * Wave's two waves before a large title's word, the top one in the primary and
 * the bottom one in the secondary: as tall as the word's capitals, on its
 * baseline, at the font scale the word is drawn at ([fontScale]).
 */
function TitleWaves({ fontScale }: { fontScale: number }) {
  const [top, bottom] = useThemeColor([TITLE_MARK_TOKENS.top, TITLE_MARK_TOKENS.bottom]);
  const { width, height, gap, baseline } = titleMarkLayout({
    fontSize: LARGE_TITLE.fontSize * fontScale,
    lineHeight: LARGE_TITLE.lineHeight * fontScale,
  });
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ marginRight: gap, marginBottom: baseline }}
    >
      <WaveMark size={width} height={height} colour={top} bottom={bottom} />
    </View>
  );
}

/**
 * A tab screen's quiet large title, with at most one trailing control on its
 * line. Given [titleLongPress], a long press on the title opens the screen's
 * options next to it. With [waves], Wave's two waves lead the title, and the
 * pair stops growing with the font scale where it fills the line.
 */
export function LargeTitle({
  title,
  waves = false,
  action,
  titleLongPress,
}: {
  title: string;
  waves?: boolean | undefined;
  action?: ReactNode;
  titleLongPress?: TitleLongPress | undefined;
}) {
  const window = useWindowDimensions();
  const fontScale = titleMarkFontScale({
    fontScale: window.fontScale,
    fontSize: LARGE_TITLE.fontSize,
    room: window.width - 2 * grid.margin - (action === undefined ? 0 : ACTION_WIDTH),
  });
  const text = (
    <Text
      accessibilityRole="header"
      className="font-sans text-large-title font-light text-foreground"
      style={{ letterSpacing: -0.6 }}
      {...(waves ? { maxFontSizeMultiplier: fontScale } : {})}
    >
      {title}
    </Text>
  );
  return (
    <View
      className="flex-row items-end justify-between pb-4"
      style={{ paddingHorizontal: grid.margin }}
    >
      <TitlePress titleLongPress={titleLongPress}>
        {waves ? (
          <View className="flex-row items-end">
            <TitleWaves fontScale={fontScale} />
            {text}
          </View>
        ) : (
          text
        )}
      </TitlePress>
      {action}
    </View>
  );
}

/** Space above a large title: the status bar, then two cells. */
export const useLargeTitleTop = (): number => useSafeAreaInsets().top + 16;

/**
 * A screen with a quiet large title that scrolls with the content, under the
 * floating chrome. Tapping its tab while it is current scrolls back to the top.
 */
export function LargeTitleScreen({
  title,
  waves,
  action,
  titleLongPress,
  children,
  refreshControl,
}: Props) {
  useRenderCount("LargeTitleScreen");
  const scrollable = useListScrollable();
  const top = useLargeTitleTop();
  const bottom = useChromeInset();
  const scroll = useRef<ScrollViewInstance>(null);
  useScrollToTop(scroll);
  return (
    <ScrollView
      ref={scroll}
      scrollEnabled={scrollable}
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: top, paddingBottom: bottom }}
      contentInsetAdjustmentBehavior="never"
      refreshControl={refreshControl}
    >
      <LargeTitle title={title} waves={waves} action={action} titleLongPress={titleLongPress} />
      <View style={{ paddingHorizontal: grid.margin }}>{children}</View>
    </ScrollView>
  );
}
