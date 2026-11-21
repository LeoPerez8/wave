import { useLocalisation } from "@/localisation/localisation";
import { homeSectionTitle, type HomeSectionId } from "@wave/core";
import { View, useWindowDimensions } from "react-native";

import { grid } from "@/catalog/grid";
import { TitledSection } from "@/catalog/TitledSection";

import { homePlaceholderHeight } from "./homeOpening";
import { statsSeeAllAction } from "./statsSeeAllAction";

/**
 * A local section before its first read answers with no snapshot to draw
 * (the first start, or a snapshot that couldn't be read): its heading over
 * the room its content takes, empty, so the content takes its place without
 * moving what's below. No skeleton: local reads answer within a frame or
 * two (#1353).
 */
export function HomeSectionSpace({ id }: { id: HomeSectionId }) {
  const { strings } = useLocalisation();
  const { fontScale, width } = useWindowDimensions();
  return (
    <TitledSection
      title={homeSectionTitle(id, strings)}
      {...(id === "stats" ? { action: statsSeeAllAction(strings) } : {})}
    >
      <View style={{ minHeight: homePlaceholderHeight(id, fontScale, width - grid.margin * 2) }} />
    </TitledSection>
  );
}
