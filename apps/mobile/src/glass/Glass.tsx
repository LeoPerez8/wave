import { glassLayers, glassTintAlpha } from "@wave/core";
import { Platform, StyleSheet, View } from "react-native";

import { useGlassSettings } from "@/settings/glass";
import { useThemeColor } from "@/theme/useThemeColor";

import { glassProbe } from "./glassProbe";
import { NativeGlassView } from "./waveGlass";

/**
 * The glass technique for the tab bar, mini player and overlay cards (see
 * docs/glass-spike.md): technique A, a live RenderEffect blur of the views
 * behind plus an AGSL edge refraction and specular rim, all on the RenderThread.
 * Blur, refraction, tint and rim come from Settings (`@/settings/glass`);
 * refraction 0 is the blur + tint + rim fallback. Below API 33 the native view
 * drops the refraction shader by itself. A perf build launched with a glass
 * probe drops the layers the probe names (Core `glassLayers`, issue #316).
 */

type Props = {
  /** `nativeID` of the view the glass shows through; it must not contain the glass. */
  backdropId: string;
  cornerRadius: number;
};

/** RenderEffect blur arrived in Android 12 (API 31); below it glass is an opaque surface. */
const CAN_BLUR = Platform.OS !== "android" || Number(Platform.Version) >= 31;

/** A glass layer filling its parent; put the parent's content after it. */
export function Glass({ backdropId, cornerRadius }: Props) {
  const surface = useThemeColor("surface");
  const glass = useGlassSettings();
  if (!CAN_BLUR) {
    return (
      <View
        pointerEvents="none"
        className="bg-surface"
        style={[StyleSheet.absoluteFill, { borderRadius: cornerRadius }]}
      />
    );
  }
  const layers = glassLayers(glass, glassProbe());
  return (
    <NativeGlassView
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      backdropNativeId={layers.backdrop ? backdropId : null}
      blurRadius={layers.blur}
      refraction={layers.refraction}
      cornerRadius={cornerRadius}
      tintColor={surface.startsWith("#") ? `${surface}${glassTintAlpha(glass.tint)}` : surface}
      rim={glass.rim}
      coalesce={layers.coalesce}
    />
  );
}
