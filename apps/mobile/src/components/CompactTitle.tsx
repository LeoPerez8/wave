import type { LegendListRef } from "@legendapp/list/react-native";
import { compactTitleScroll, compactTitleShown } from "@wave/core";
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
  type RefObject,
} from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { grid } from "@/catalog/grid";
import { afterPaint } from "@/lib/afterPaint";
import { useLocalisation } from "@/localisation/localisation";
import { Press } from "@/motion/Press";

/** The compact title's fade. Like every `withTiming`, it jumps under reduce motion. */
const FADE = { duration: 160 };

type ViewHandle = ComponentRef<typeof View>;

/** What the page's header and its list share. */
interface CompactTitleState {
  /** The title, undefined until the page knows it (nothing shows). */
  readonly title: string | undefined;
  readonly shown: SharedValue<boolean>;
  /** The large title's bottom in the list's content. */
  readonly titleBottom: SharedValue<number>;
  readonly head: RefObject<ViewHandle | null>;
  readonly mark: RefObject<ViewHandle | null>;
  /** Reads [titleBottom] again. */
  readonly measure: () => void;
  /** Takes the list back to the top. */
  readonly goUp: () => void;
  /** The mounted list hands its way back to the top here. */
  readonly setGoUp: (run: (() => void) | null) => void;
}

const CompactTitleContext = createContext<CompactTitleState | null>(null);

/**
 * A pushed page whose title scrolls with its content, around its `ScreenHeader`
 * and its list. Inside it, the list runs `useCompactTitleList` and puts its
 * head in `CompactTitleHead`, the large title sits in `CompactTitleMark`, and
 * the header shows [title] beside Back (docs/spec.md "Compact title").
 * `DetailFrame`'s `compactTitle` is this for a Library page.
 */
export function CompactTitleFrame({
  title,
  children,
}: {
  title: string | undefined;
  children: ReactNode;
}) {
  const shown = useSharedValue(false);
  const titleBottom = useSharedValue(Number.POSITIVE_INFINITY);
  const head = useRef<ViewHandle>(null);
  const mark = useRef<ViewHandle>(null);
  const goUpRun = useRef<(() => void) | null>(null);
  const goUp = useCallback(() => goUpRun.current?.(), []);
  const setGoUp = useCallback((run: (() => void) | null) => {
    goUpRun.current = run;
  }, []);
  const measure = useCallback(() => {
    if (mark.current === null || head.current === null) return;
    mark.current.measureLayout(
      head.current,
      (_x, y, _width, height) => titleBottom.set(y + height),
      () => {},
    );
  }, [titleBottom]);
  const state = useMemo(
    (): CompactTitleState => ({ title, shown, titleBottom, head, mark, measure, goUp, setGoUp }),
    [title, shown, titleBottom, measure, goUp, setGoUp],
  );
  return <CompactTitleContext value={state}>{children}</CompactTitleContext>;
}

/**
 * Around everything a list holds above its first row (at the top of its
 * content): the large title is measured against it. [onLayout] is its own.
 */
export function CompactTitleHead({
  onLayout,
  children,
}: {
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}) {
  const state = use(CompactTitleContext);
  return (
    <View
      ref={state?.head}
      collapsable={false}
      onLayout={(event) => {
        onLayout?.(event);
        // What's over the title (a field pinned or let go) moves it without its own layout changing.
        state?.measure();
      }}
    >
      {children}
    </View>
  );
}

/** Around the large title, to know when it has scrolled away. */
export function CompactTitleMark({ children }: { children: ReactNode }) {
  const state = use(CompactTitleContext);
  return (
    <View ref={state?.mark} collapsable={false} onLayout={state?.measure}>
      {children}
    </View>
  );
}

/**
 * The list's side of the compact title, inside a `CompactTitleFrame`: follows
 * [scroll] (`useListScroll`, or `useRowDrag`'s) on the UI thread and takes the
 * title's tap to the list's opening place. [find] is the list's Find in
 * Playlist, null when it has no field. [onGoUp] hears the tap before the list moves.
 */
export function useCompactTitleList({
  list,
  find,
  scroll,
  onGoUp,
}: {
  list: RefObject<LegendListRef | null>;
  find: { readonly found: unknown; readonly openingOffset: number } | null;
  scroll: SharedValue<number>;
  onGoUp?: () => void;
}): void {
  const state = use(CompactTitleContext);
  // A list rendered outside a frame has nothing to show its title in.
  if (state === null) throw new Error("useCompactTitleList needs a CompactTitleFrame");
  const { shown, titleBottom, setGoUp } = state;
  const reduceMotion = useReducedMotion();
  const querying = find !== null && find.found !== null;
  const openingOffset = find?.openingOffset ?? 0;
  const narrowed = useSharedValue(querying);
  useLayoutEffect(() => {
    narrowed.set(querying);
  }, [narrowed, querying]);
  useAnimatedReaction(
    () =>
      compactTitleShown({
        scroll: scroll.get(),
        titleBottom: titleBottom.get(),
        querying: narrowed.get(),
      }),
    (now) => shown.set(now),
    [scroll, titleBottom, narrowed, shown],
  );
  useLayoutEffect(() => {
    setGoUp(() => {
      const handle = list.current;
      if (handle === null) return;
      onGoUp?.();
      const { scroll: from, scrollLength } = handle.getState();
      const { jumpTo, offset, animated } = compactTitleScroll({
        scroll: from,
        openingOffset,
        querying,
        listHeight: scrollLength,
        reduceMotion,
      });
      if (jumpTo === null) {
        void handle.scrollToOffset({ offset, animated });
        return;
      }
      void handle.scrollToOffset({ offset: jumpTo, animated: false });
      // The rows at the jump's end first, so the last stretch has rows to slide.
      void afterPaint().then(() => list.current?.scrollToOffset({ offset, animated }));
    });
    return () => setGoUp(null);
  }, [setGoUp, list, openingOffset, querying, reduceMotion, onGoUp]);
}

/** The header's side, beside Back: nothing outside a `CompactTitleFrame`. */
export function CompactTitle() {
  const state = use(CompactTitleContext);
  if (state === null || state.title === undefined) return null;
  return <CompactTitleLine title={state.title} shown={state.shown} goUp={state.goUp} />;
}

/**
 * One line ending in an ellipsis, faded on the UI thread. JavaScript hears only
 * the change, for what screen readers and taps reach: this line renders again,
 * the list doesn't.
 */
function CompactTitleLine({
  title,
  shown,
  goUp,
}: {
  title: string;
  shown: SharedValue<boolean>;
  goUp: () => void;
}) {
  const { strings } = useLocalisation();
  const [visible, setVisible] = useState(false);
  useAnimatedReaction(
    () => shown.get(),
    (now, was) => {
      if (now !== (was ?? false)) scheduleOnRN(setVisible, now);
    },
    [shown],
  );
  const fade = useAnimatedStyle(() => ({ opacity: withTiming(shown.get() ? 1 : 0, FADE) }));
  return (
    <Animated.View
      className="mr-3 flex-1"
      pointerEvents={visible ? "auto" : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      // Back's glyph sits on the margin; the title stops at the page's other one.
      style={fade}
    >
      <Press
        className="justify-center"
        style={{ height: grid.row }}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={strings.library.compactTitleHint}
        onPress={goUp}
      >
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          className="font-sans text-body font-medium text-foreground"
        >
          {title}
        </Text>
      </Press>
    </Animated.View>
  );
}
