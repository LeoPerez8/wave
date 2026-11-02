import { createPlaylistPickerSearch, stepPlaylistPickerSearch } from "@wave/core";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Keyboard } from "react-native";

import { OverlayId, setOverlaySearch } from "@/overlay/overlay";

/** The picker only measures overflow while it shows its full, centred list. */
export function usePlaylistPickerSearch<T extends { readonly name: string }>(
  playlists: readonly T[],
) {
  const id = useContext(OverlayId);
  const [query, setQuery] = useState<string | null>(null);
  const [overflows, setOverflow] = useState(false);
  const finder = useMemo(() => createPlaylistPickerSearch(playlists), [playlists]);
  const searching = query !== null;
  const closing = useRef(false);
  const dismissKeyboard = useCallback(() => {
    closing.current = true;
    Keyboard.dismiss();
  }, []);
  const closeSearch = useCallback(() => {
    if (closing.current) return;
    setQuery((current) => stepPlaylistPickerSearch(current, "back").query);
    Keyboard.dismiss();
  }, []);

  useLayoutEffect(() => {
    if (id === undefined || !searching) return;
    setOverlaySearch(id, { close: closeSearch, dismissKeyboard });
    return () => setOverlaySearch(id, undefined);
  }, [id, searching, closeSearch, dismissKeyboard]);

  useEffect(() => {
    if (!searching) return;
    let shown = false;
    const show = Keyboard.addListener("keyboardDidShow", () => {
      shown = true;
    });
    // Android can consume Back to hide the IME before BackHandler hears it.
    // A hide already in progress when search opened belongs to the previous field.
    const hidden = Keyboard.addListener("keyboardDidHide", () => {
      if (shown) closeSearch();
    });
    return () => {
      show.remove();
      hidden.remove();
    };
  }, [searching, closeSearch]);

  return {
    ...finder.show(query),
    query,
    searching,
    overflows,
    setQuery,
    onOverflowChange: searching ? undefined : setOverflow,
    open: () => {
      closing.current = false;
      setQuery(stepPlaylistPickerSearch(query, "open").query);
    },
    clear: () => {
      const next = stepPlaylistPickerSearch(query, "clear");
      setQuery(next.query);
      if (next.query === null) Keyboard.dismiss();
    },
  };
}
