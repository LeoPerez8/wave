import { StyleSheet } from "react-native";

import { useThemeColor } from "@/theme/useThemeColor";

import { NativeGlassView } from "./waveGlass";

/**
 * The glass technique for the tab bar and mini player (see docs/glass-spike.md):
 * technique A, a live RenderEffect blur of the views behind plus an AGSL edge
 * refraction and specular rim, all on the RenderThread. Chosen pending
 * on-device numbers; `refraction: 0` switches to the blur + tint + rim fallback.
 * Below API 33 the native view drops the refraction shader by itself.
 */
export const GLASS = { blur: 24, refraction: 12 } as const;

/** How much of the surface tone lies over the blur (hex alpha), so text stays legible. */
const TINT_ALPHA = "B8";

type Props = {
  /** `nativeID` of the view the glass shows through; it must not contain the glass. */
  backdropId: string;
  cornerRadius: number;
};

/** A glass layer filling its parent; put the parent's content after it. */
export function Glass({ backdropId, cornerRadius }: Props) {
  const surface = useThemeColor("surface");
  return (
    <NativeGlassView
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      backdropNativeId={backdropId}
      blurRadius={GLASS.blur}
      refraction={GLASS.refraction}
      cornerRadius={cornerRadius}
      tintColor={surface.startsWith("#") ? `${surface}${TINT_ALPHA}` : surface}
      rim
    />
  );
}
