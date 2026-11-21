import type { Href } from "expo-router";

import { router } from "@/lib/timingRouter";

/** Opens DJ over the tabs: it covers the mini player until Done or Close. */
export const openDj = (): void => router.push("/dj" as Href);
