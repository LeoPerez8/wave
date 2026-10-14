import { createContext } from "react";

/**
 * Whether what's inside sits on the floating chrome (tab bar, mini player,
 * selection bar): it floats above the content, so the chrome never hides it.
 */
export const OnFloatingChrome = createContext(false);
