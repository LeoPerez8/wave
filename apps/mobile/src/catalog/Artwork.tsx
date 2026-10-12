import { IconMusic } from "@tabler/icons-react-native";
import { Image } from "expo-image";
import { View } from "react-native";

import { useThemeColor } from "@/theme/useThemeColor";

type Props = {
  /** File URI of the cached artwork; absent for files without embedded art. */
  uri?: string | undefined;
  /** Solid field shown instead of an image (synthetic preview covers). */
  tint?: string | undefined;
  size: number;
  /** Corner radius, for art set inside a rounded container; square by default. */
  radius?: number | undefined;
};

/** Album art, treated as a photograph: square, no frame, no rounding unless asked. */
export function Artwork({ uri, tint, size, radius = 0 }: Props) {
  const tertiary = useThemeColor("tertiary");
  const fill = useThemeColor("fill");
  if (uri !== undefined) {
    return (
      <Image
        source={{ uri }}
        // List rows are recycled; the key stops the previous track's artwork flashing.
        recyclingKey={uri}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: fill }}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      className="items-center justify-center bg-fill"
      style={[
        { width: size, height: size, borderRadius: radius },
        tint !== undefined && { backgroundColor: tint },
      ]}
    >
      {tint === undefined && <IconMusic size={size / 4} color={tertiary} strokeWidth={1.25} />}
    </View>
  );
}
