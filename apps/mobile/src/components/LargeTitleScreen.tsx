import {
  TITLE_MARK_TOKENS,
  titleMarkFontScale,
  titleMarkPlacement,
  type TitleLine,
  type TitleMarkLayout,
} from "@wave/core";
import { useScrollToTop } from "expo-router";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  ScrollView,
  type ScrollViewInstance,
  Text,
  type TextLayoutEvent,
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
const LARGE_TITLE = { fontSize: 26, lineHeight: 32 } as const;

/** The large title's classes and tracking, the same with and without the waves. */
const TITLE_CLASS = "font-sans text-large-title font-light text-foreground";
const TITLE_STYLE = { letterSpacing: -0.6 } as const;

/** The width a title line's trailing control takes: an `IconButton`'s 48dp target. */
const ACTION_WIDTH = 48;

/**
 * Wave's two waves before a large title's word, the top one in the primary and
 * the bottom one in the secondary: 60% as tall as the word's capitals, on its
 * baseline, where [placement] puts them beside the word as drawn.
 */
function TitleWaves({ placement }: { placement: TitleMarkLayout }) {
  const [top, bottom] = useThemeColor([TITLE_MARK_TOKENS.top, TITLE_MARK_TOKENS.bottom]);
  const { width, height, gap, baseline } = placement;
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
 * Home's title: Wave's two waves, then the word. The waves take their size
 * from the word's line as the phone drew it, since Android scales large text
 * by less than the font scale, and the pair stops growing with the font scale
 * where it fills the line ([room], in dp). Until the line is measured at a
 * font scale other than the standard one, the title stays unseen, so the word
 * never shows alone and then moves aside.
 */
function WavesTitle({ title, room }: { title: string; room: number }) {
  const { fontScale } = useWindowDimensions();
  const [line, setLine] = useState<TitleLine>();
  const placement = titleMarkPlacement({ line, fontScale, type: LARGE_TITLE });
  const onTextLayout = ({ nativeEvent }: TextLayoutEvent) => {
    const drawn = nativeEvent.lines[0];
    if (drawn === undefined) return;
    // The line's ascender is the way from its top down to its baseline.
    setLine((last) =>
      last?.capHeight === drawn.capHeight &&
      last.height === drawn.height &&
      last.baseline === drawn.ascender
        ? last
        : { capHeight: drawn.capHeight, height: drawn.height, baseline: drawn.ascender },
    );
  };
  return (
    <View className="flex-row items-end" style={{ opacity: placement === undefined ? 0 : 1 }}>
      {placement === undefined ? null : <TitleWaves placement={placement} />}
      <Text
        accessibilityRole="header"
        className={TITLE_CLASS}
        style={TITLE_STYLE}
        maxFontSizeMultiplier={titleMarkFontScale({
          fontScale,
          fontSize: LARGE_TITLE.fontSize,
          room,
        })}
        onTextLayout={onTextLayout}
      >
        {title}
      </Text>
    </View>
  );
}

/**
 * A tab screen's quiet large title, with at most one trailing control on its
 * line. Given [titleLongPress], a long press on the title opens the screen's
 * options next to it. With [waves], Wave's two waves lead the title.
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
  return (
    <View
      className="flex-row items-end justify-between pb-4"
      style={{ paddingHorizontal: grid.margin }}
    >
      <TitlePress titleLongPress={titleLongPress}>
        {waves ? (
          <WavesTitle
            title={title}
            room={window.width - 2 * grid.margin - (action === undefined ? 0 : ACTION_WIDTH)}
          />
        ) : (
          <Text accessibilityRole="header" className={TITLE_CLASS} style={TITLE_STYLE}>
            {title}
          </Text>
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
