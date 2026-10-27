import { crossfadeGround, type Gradient, type GroundLayers } from "@wave/core";
import { useEffect, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/** Long enough to read as a change of mood, not a flash. */
const CROSSFADE_MS = 700;
const CROSSFADE_EASING = Easing.inOut(Easing.quad);

/**
 * The Now Playing ground's colours as drawn (Core's `GroundLayers`): the base
 * gradient and the one fading in over it at [fade]'s opacity. Each change
 * makes a new [fade] that starts at 0 in the same commit as its layers, so a
 * layer never shows new colours at an old opacity.
 */
export interface GroundColors {
  readonly layers: GroundLayers;
  readonly fade: SharedValue<number>;
  /** The colours the ground settles on. */
  readonly target: Gradient;
  /** When [fade] started (ms), to know where it is without reading it during a render. */
  readonly fadeStartedAt: { at: number | null };
  /** Counts the changes: the incoming layer mounts anew with each, at its new fade's 0. */
  readonly change: number;
}

const settled = (gradient: Gradient, change: number): GroundColors => ({
  layers: { base: gradient, incoming: null },
  fade: makeMutable(1),
  target: gradient,
  fadeStartedAt: { at: null },
  change,
});

/** Where a fade started at [startedAt] is now, from 0 to 1, along its easing. */
const fadeProgress = (startedAt: number | null): number => {
  if (startedAt === null) return 0;
  return CROSSFADE_EASING(Math.min(1, (Date.now() - startedAt) / CROSSFADE_MS));
};

/**
 * The Now Playing ground's colours: a top-to-bottom gradient from the
 * artwork's palette (already toned for legibility by Core's
 * `paletteGradient`). On a track change they crossfade from wherever they are
 * to the new colours, even mid-fade (Core's `crossfadeGround`); out of sight
 * (`animate` off) they change straight away, so the sheet opens on the right
 * colours.
 */
export function useBackgroundColors(gradient: Gradient, animate: boolean): GroundColors {
  const reduceMotion = useReducedMotion();
  const [ground, setGround] = useState(() => settled(gradient, 0));
  if (ground.target.top !== gradient.top || ground.target.bottom !== gradient.bottom) {
    // Adjusted while rendering, so the new layers commit with the render that brought the colours.
    const instant = reduceMotion || !animate;
    const progress = ground.layers.incoming === null ? 1 : fadeProgress(ground.fadeStartedAt.at);
    const layers = crossfadeGround(ground.layers, gradient, progress, instant);
    setGround(
      layers.incoming === null
        ? settled(gradient, ground.change + 1)
        : {
            layers,
            fade: makeMutable(0),
            target: gradient,
            fadeStartedAt: { at: null },
            change: ground.change + 1,
          },
    );
  }

  const { layers, fade, fadeStartedAt } = ground;
  useEffect(() => {
    if (layers.incoming === null) return undefined;
    fadeStartedAt.at = Date.now();
    fade.set(withTiming(1, { duration: CROSSFADE_MS, easing: CROSSFADE_EASING }));
    return () => cancelAnimation(fade);
  }, [layers, fade, fadeStartedAt]);
  return ground;
}

/** One layer's two-stop gradient, top to bottom. */
const gradientStyle = ({ top, bottom }: Gradient) => ({
  backgroundImage: [
    {
      type: "linear-gradient" as const,
      direction: "to bottom",
      colorStops: [{ color: top }, { color: bottom }],
    },
  ],
});

function IncomingLayer({
  gradient,
  fade,
  height,
}: {
  gradient: Gradient;
  fade: SharedValue<number>;
  height: number;
}) {
  const style = useAnimatedStyle(() => ({ opacity: fade.get() }));
  return <Animated.View style={[styles.layer, { height }, gradientStyle(gradient), style]} />;
}

/**
 * The Now Playing ground, drawn window-tall from its colours
 * (`useBackgroundColors`): the base gradient with the incoming one fading in
 * over it, as plain views. The Queue's sticky bar draws its slice of it too.
 */
export function Background({ colors }: { colors: GroundColors }) {
  const { height } = useWindowDimensions();
  const { layers, fade, change } = colors;
  return (
    <View style={styles.ground} pointerEvents="none">
      <View style={[styles.layer, { height }, gradientStyle(layers.base)]} />
      {layers.incoming === null ? null : (
        <IncomingLayer key={change} gradient={layers.incoming} fade={fade} height={height} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Clipped to its place as the canvas it replaces was; the gradient spans the window's height.
  ground: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" },
  layer: { position: "absolute", top: 0, left: 0, right: 0 },
});
