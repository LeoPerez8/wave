import { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useUniwind } from "uniwind";
import { statsGenreBlocks, type RecapGenre } from "@wave/core";

import { CELL } from "@/catalog/grid";
import { useLocalisation } from "@/localisation/localisation";

/** Five flat teal fields, read in rank order. Only their empty margins overlap. */
export function GenreStaircase({ genres }: { genres: readonly RecapGenre[] }) {
  const { strings } = useLocalisation();
  const { fontScale } = useWindowDimensions();
  const { theme } = useUniwind();
  const [width, setWidth] = useState(0);
  const [labelHeight, setLabelHeight] = useState(0);
  const blocks = statsGenreBlocks(
    genres,
    width,
    fontScale,
    labelHeight,
    theme === "dark" ? "dark" : "light",
  );

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 &&
        blocks.map((block, index) => {
          const percent = strings.stats.genrePercent(block.share);
          return (
            <View
              key={block.family.key}
              accessible
              accessibilityLabel={strings.stats.genreBlockLabel(
                index + 1,
                block.family.name,
                percent,
              )}
              style={{
                width: block.width,
                minHeight: block.height,
                marginLeft: block.inset,
                marginTop: index === 0 ? 0 : -CELL,
                padding: CELL * 2,
                backgroundColor: block.fill,
              }}
            >
              <View
                onLayout={(event) => {
                  const height = event.nativeEvent.layout.height;
                  setLabelHeight((current) => Math.max(current, height));
                }}
                style={{ gap: CELL / 2 }}
              >
                <Text className="font-sans text-body font-medium" style={{ color: block.ink }}>
                  {block.family.name}
                </Text>
                <Text
                  className="font-sans text-footnote"
                  style={{ color: block.ink, fontVariant: ["tabular-nums"] }}
                >
                  {percent}
                </Text>
              </View>
            </View>
          );
        })}
    </View>
  );
}
