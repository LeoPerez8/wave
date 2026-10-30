import { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useThemeColor } from "@/theme/useThemeColor";
import { statsGenrePodium, type RecapGenre } from "@wave/core";

import { CELL } from "@/catalog/grid";
import { useLocalisation } from "@/localisation/localisation";

/** The top genres on an overlapping podium, read as one summary in rank order. */
export function GenrePodium({ genres }: { genres: readonly RecapGenre[] }) {
  const { strings } = useLocalisation();
  const { fontScale } = useWindowDimensions();
  const [accent, background] = useThemeColor(["accent", "background"]);
  const [width, setWidth] = useState(0);
  const bars = statsGenrePodium(genres, width, fontScale, { accent, background });
  const summary = [...bars]
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
    .sort((a, b) => a.rank - b.rank)
    .map((bar) =>
      strings.stats.genreBlockLabel(
        bar.rank,
        bar.family.name,
        strings.stats.genrePercent(bar.share),
      ),
    )
    .join("; ");

  return (
    <View
      accessible
      accessibilityLabel={summary}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <>
          <View style={{ height: Math.max(0, ...bars.map((bar) => bar.height)) }}>
            {/* Drawn back to front, so #1 covers its neighbours' inner edges. */}
            {[...bars]
              // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
              .sort((a, b) => a.layer - b.layer)
              .map((bar) => (
                <View
                  key={bar.family.key}
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: bar.left,
                    width: bar.width,
                    height: bar.height,
                    alignItems: "center",
                    paddingTop: CELL * 2,
                    backgroundColor: bar.fill,
                    borderColor: background,
                    borderWidth: 2,
                    borderBottomWidth: 0,
                    borderTopLeftRadius: CELL * 2.5,
                    borderTopRightRadius: CELL * 2.5,
                  }}
                >
                  <Text
                    className="font-sans text-title2 font-bold"
                    style={{ color: bar.ink, fontVariant: ["tabular-nums"] }}
                  >
                    {bar.rank}
                  </Text>
                </View>
              ))}
          </View>
          <View style={{ flexDirection: "row", marginTop: CELL * 2 }}>
            {bars.map((bar, index) => (
              <View
                key={bar.family.key}
                style={{
                  marginLeft: index === 0 ? bar.labelLeft : 0,
                  width: bar.labelWidth,
                  paddingHorizontal: CELL / 2,
                  alignItems: "center",
                }}
              >
                <Text className="text-center font-sans text-footnote font-semibold text-foreground">
                  {bar.family.name}
                </Text>
                <Text
                  className="font-sans text-caption text-secondary"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {strings.stats.genrePercent(bar.share)}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
