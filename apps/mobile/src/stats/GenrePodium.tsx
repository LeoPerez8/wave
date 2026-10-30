import { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useThemeColor } from "@/theme/useThemeColor";
import { statsGenrePodium, type RecapGenre } from "@wave/core";

import { CELL } from "@/catalog/grid";
import { useLocalisation } from "@/localisation/localisation";

/** The rank number's line (`text-title2`) and the edge in the background colour between bars. */
const RANK_LINE = 28;
const EDGE = 2;

/** The top genres on an overlapping podium, read as one summary in rank order. */
export function GenrePodium({ genres }: { genres: readonly RecapGenre[] }) {
  const { strings } = useLocalisation();
  const { fontScale } = useWindowDimensions();
  const [accent, background] = useThemeColor(["accent", "background"]);
  const [width, setWidth] = useState(0);
  // The smallest bar still holds its rank number between its top edge and padding.
  const floor = EDGE + CELL + RANK_LINE * fontScale + CELL;
  const bars = statsGenrePodium(genres, width, floor, { accent, background });
  const summary = [...bars]
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
    .sort((a, b) => a.rank - b.rank)
    .map((bar) =>
      strings.stats.genreBarLabel(bar.rank, bar.family.name, strings.stats.genrePercent(bar.share)),
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
                    paddingTop: CELL,
                    // The rank centres on the part its neighbours leave showing.
                    paddingLeft: bar.visibleLeft - bar.left,
                    paddingRight: bar.left + bar.width - (bar.visibleLeft + bar.visibleWidth),
                    backgroundColor: bar.fill,
                    borderColor: background,
                    borderWidth: EDGE,
                    borderBottomWidth: 0,
                    borderTopLeftRadius: CELL,
                    borderTopRightRadius: CELL,
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
          <View
            style={{ flexDirection: "row", marginTop: CELL, marginLeft: bars[0]?.visibleLeft ?? 0 }}
          >
            {bars.map((bar) => (
              <View
                key={bar.family.key}
                style={{
                  width: bar.visibleWidth,
                  paddingHorizontal: CELL / 4,
                  alignItems: "center",
                }}
              >
                <Text
                  android_hyphenationFrequency="normal"
                  className="text-center font-sans text-footnote font-semibold text-foreground"
                >
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
