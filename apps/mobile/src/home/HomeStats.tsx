import { useLocalisation } from "@/localisation/localisation";
import { Fragment } from "react";
import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { TitledSection } from "@/catalog/TitledSection";
import { useStatsFacts } from "@/library/hooks";
import { HomeSectionSkeleton } from "./HomeSectionSkeleton";
import { StatsFactRow } from "./StatsFactRow";
import { statsSeeAllAction } from "./statsSeeAllAction";

/** Listening and library facts; only See all opens Library's Stats. */
export function HomeStats() {
  const { strings } = useLocalisation();
  const facts = useStatsFacts();
  if (facts === undefined) return <HomeSectionSkeleton id="stats" />;
  return (
    <TitledSection title={strings.home.sections.stats} action={statsSeeAllAction(strings)}>
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
