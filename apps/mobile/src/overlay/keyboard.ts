import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

/**
 * How tall the on-screen keyboard is, in dp, above the navigation bar; 0 when
 * it's closed. Wave draws edge to edge, so the keyboard covers the window
 * rather than shrinking it, and cards move clear of it themselves.
 */
export const useKeyboardHeight = (): number => {
  const [height, setHeight] = useState(() => Keyboard.metrics()?.height ?? 0);
  useEffect(() => {
    // Android only sends the "did" events; it re-sends Show when the height changes.
    const show = Keyboard.addListener("keyboardDidShow", (event) =>
      setHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
};
