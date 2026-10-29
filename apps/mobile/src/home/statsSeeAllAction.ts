import { currentLocalisation } from "@/localisation/localisation";
import { openStats } from "@/library/routes";

/** Loaded Stats and its placeholder offer the same navigation. */
export const statsSeeAllAction = { get label() { return currentLocalisation().strings.home.seeAll; }, onPress: openStats };
