import { View } from "react-native";

/**
 * A text line's placeholder in a skeleton: a still fill bar [width] wide (a
 * share of its container) and half the line's height, centred in a box as
 * tall as the line it stands for ([lineHeight], global.css's line height for
 * its type), so the skeleton keeps the real layout's height.
 */
export function SkeletonLine({ lineHeight, width }: { lineHeight: number; width: `${number}%` }) {
  return (
    <View className="justify-center" style={{ height: lineHeight }}>
      <View className="bg-fill" style={{ width, height: lineHeight / 2 }} />
    </View>
  );
}
