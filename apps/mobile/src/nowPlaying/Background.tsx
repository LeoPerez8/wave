import { crossfadeGround, sameGround, type GroundGradient, type GroundLayers } from "@wave/core";
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

import { usePhoneEffects } from "@/glass/phoneEffects";

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
  readonly target: GroundGradient;
  /** Counts the changes: the incoming layer mounts anew with each, at its new fade's 0. */
  readonly change: number;
}

const settled = (gradient: GroundGradient, change: number): GroundColors => ({
  layers: { base: gradient, incoming: null },
  fade: makeMutable(1),
  target: gradient,
  change,
});

/** When each fade started (ms): where it is, known without reading it during a render. */
const fadeStarts = new WeakMap<SharedValue<number>, number>();

/** Where [fade] is now, from 0 to 1, along its easing. */
const fadeProgress = (fade: SharedValue<number>): number => {
  const startedAt = fadeStarts.get(fade);
  if (startedAt === undefined) return 0;
  return CROSSFADE_EASING(Math.min(1, (Date.now() - startedAt) / CROSSFADE_MS));
};

/**
 * The Now Playing ground's colours: a top-to-bottom gradient from the
 * artwork's palette into the theme's ground, its stops already toned for
 * legibility by Core's `groundGradient`. On a track change they crossfade from wherever they are
 * to the new colours, even mid-fade (Core's `crossfadeGround`); out of sight
 * (`animate` off) they change straight away, so the sheet opens on the right
 * colours. A phone drawing the simple effects (`@/glass/phoneEffects`) always
 * changes them straight away; Full glass (#1538) brings the crossfade back at once.
 */
export function useBackgroundColors(gradient: GroundGradient, animate: boolean): GroundColors {
  const reduceMotion = useReducedMotion();
  const effects = usePhoneEffects();
  const [ground, setGround] = useState(() => settled(gradient, 0));
  if (!sameGround(ground.target, gradient)) {
    // Adjusted while rendering, so the new layers commit with the render that brought the colours.
    // A phone measured weak (#1357) changes colours without the crossfade, as with reduced motion.
    const instant = reduceMotion || !animate || effects === "simple";
    const progress = ground.layers.incoming === null ? 1 : fadeProgress(ground.fade);
    const layers = crossfadeGround(ground.layers, gradient, progress, instant);
    setGround(
      layers.incoming === null
        ? settled(gradient, ground.change + 1)
        : {
            layers,
            fade: makeMutable(0),
            target: gradient,
            change: ground.change + 1,
          },
    );
  }

  const { layers, fade } = ground;
  useEffect(() => {
    if (layers.incoming === null) return undefined;
    fadeStarts.set(fade, Date.now());
    fade.set(withTiming(1, { duration: CROSSFADE_MS, easing: CROSSFADE_EASING }));
    return () => cancelAnimation(fade);
  }, [layers, fade]);
  return ground;
}

/** One layer's gradient, top to bottom, each colour at its stop. */
const gradientStyle = (gradient: GroundGradient) => ({
  backgroundImage: [
    {
      type: "linear-gradient" as const,
      direction: "to bottom",
      colorStops: gradient.map(({ color, at }) => ({ color, positions: [`${at * 100}%`] })),
    },
  ],
});

function IncomingLayer({
  gradient,
  fade,
  height,
}: {
  gradient: GroundGradient;
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
