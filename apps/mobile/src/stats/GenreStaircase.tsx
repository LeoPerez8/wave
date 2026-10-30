import { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useThemeColor } from "@/theme/useThemeColor";
import { statsGenreBlocks, type RecapGenre } from "@wave/core";

import { CELL } from "@/catalog/grid";
import { useLocalisation } from "@/localisation/localisation";

/** Five flat teal fields, read in rank order. Only their empty margins overlap. */
export function GenreStaircase({ genres }: { genres: readonly RecapGenre[] }) {
  const { strings } = useLocalisation();
  const { fontScale } = useWindowDimensions();
  const [accent, background] = useThemeColor(["accent", "background"]);
  const [width, setWidth] = useState(0);
  // A new set of labels (or text/width change) gets its own measurements, so it can shrink.
  const layoutKey = JSON.stringify([width, fontScale, genres, strings.stats.genrePercent(0.123)]);
  return (
    <MeasuredStaircase
      key={layoutKey}
      {...{ genres, width, setWidth, fontScale, accent, background }}
    />
  );
}

function MeasuredStaircase({
  genres,
  width,
  setWidth,
  fontScale,
  accent,
  background,
}: {
  genres: readonly RecapGenre[];
  width: number;
  setWidth: (width: number) => void;
  fontScale: number;
  accent: string;
  background: string;
}) {
  const { strings } = useLocalisation();
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({});
  const labelHeight = Math.max(0, ...Object.values(heights));
  const measured = genres.every(({ family }) => heights[family.key] !== undefined);
  const blocks = statsGenreBlocks(genres, width, fontScale, labelHeight, { accent, background });

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 &&
        !measured &&
        blocks.map((block) => (
          <View
            key={block.family.key}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ position: "absolute", opacity: 0, width: block.width - CELL * 4 }}
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              setHeights((current) =>
                current[block.family.key] === height
                  ? current
                  : { ...current, [block.family.key]: height },
              );
            }}
          >
            {label(block.family.name, strings.stats.genrePercent(block.share), block.ink)}
          </View>
        ))}
      {width > 0 &&
        measured &&
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
              {label(block.family.name, percent, block.ink)}
            </View>
          );
        })}
    </View>
  );
}

// The measuring pass and visible cards use the same intrinsic label layout.
function label(name: string, percent: string, ink: string) {
  return (
    <View style={{ gap: CELL / 2 }}>
      <Text className="font-sans text-body font-medium" style={{ color: ink }}>
        {name}
      </Text>
      <Text
        className="font-sans text-footnote"
        style={{ color: ink, fontVariant: ["tabular-nums"] }}
      >
        {percent}
      </Text>
    </View>
  );
}
