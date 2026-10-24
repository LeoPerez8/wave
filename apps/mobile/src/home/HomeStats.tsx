import { Fragment } from "react";
import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { TitledSection } from "@/catalog/TitledSection";
import { useListeningOverview } from "@/library/hooks";
import { openStats } from "@/library/routes";
import { HomeSectionSkeleton } from "./HomeSectionSkeleton";
import { StatsFactRow } from "./StatsFactRow";

/** Listening and library facts; only See all opens Library's Stats. */
export function HomeStats() {
  const facts = useListeningOverview();
  if (facts === undefined) return <HomeSectionSkeleton id="stats" />;
  return (
    <TitledSection title="Stats" action={{ label: "See all", onPress: openStats }}>
      <View>
        {facts.map(({ label, value }, index) => (
          <Fragment key={label}>
            {index > 0 && <Hairline />}
            <StatsFactRow>
              <Text className="max-w-full shrink font-sans text-body text-foreground">{label}</Text>
              <Text
                className="max-w-full shrink font-sans text-body text-secondary"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {value}
              </Text>
            </StatsFactRow>
          </Fragment>
        ))}
      </View>
    </TitledSection>
  );
}
