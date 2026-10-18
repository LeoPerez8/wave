import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { useRecap } from "@/stats/hooks";
import { markRecapOpened } from "@/stats/openedRecaps";
import { RecapStories } from "@/stats/RecapStories";

/** A Recap's stories, opened from Home's Recap card or Stats' Recaps row (`openRecap`). */
export default function RecapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const recap = useRecap(typeof id === "string" ? id : "");
  const period = recap?.period;
  // Once its stories show, Home's card stops announcing it.
  useEffect(() => {
    if (period !== undefined) markRecapOpened(period);
  }, [period]);
  return <RecapStories recap={recap} onClose={() => router.back()} />;
}
