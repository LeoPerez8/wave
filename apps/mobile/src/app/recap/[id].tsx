import { router, useLocalSearchParams } from "expo-router";

import { useRecap } from "@/stats/hooks";
import { RecapStories } from "@/stats/RecapStories";

/** A Recap's stories, opened from Stats' Recaps row (`openRecap`). */
export default function RecapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const recap = useRecap(typeof id === "string" ? id : "");
  return <RecapStories recap={recap} onClose={() => router.back()} />;
}
