import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

/**
 * A screen's main list scroll, for its page-top gradient to move with
 * (`PageGradientScope` provides it, `useListScroll` writes it).
 */
export const PageScroll = createContext<SharedValue<number> | null>(null);

/** The scope's scroll, for the page's main list to write (`useListScroll`); null outside one. */
export const usePageScroll = (): SharedValue<number> | null => useContext(PageScroll);
