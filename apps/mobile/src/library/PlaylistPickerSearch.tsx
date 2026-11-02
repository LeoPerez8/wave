import { IconSearch, IconX } from "@tabler/icons-react-native";
import { createPlaylistPickerSearch, stepPlaylistPickerSearch } from "@wave/core";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Keyboard, TextInput, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { useLocalisation } from "@/localisation/localisation";
import { OverlayId, setOverlaySearch } from "@/overlay/overlay";
import { useThemeColor } from "@/theme/useThemeColor";

/** The picker only measures overflow while it shows its full, centred list. */
export function usePlaylistPickerSearch<T extends { readonly name: string }>(
  playlists: readonly T[],
) {
  const id = useContext(OverlayId);
  const [query, setQuery] = useState<string | null>(null);
  const [overflows, setOverflow] = useState(false);
  const finder = useMemo(() => createPlaylistPickerSearch(playlists), [playlists]);
  const shown = useMemo(() => finder.show(query), [finder, query]);
  const searching = query !== null;
  const closeSearch = useCallback(() => {
    setQuery((current) => stepPlaylistPickerSearch(current, "back").query);
    Keyboard.dismiss();
  }, []);

  useLayoutEffect(() => {
    if (id === undefined || !searching) return;
    setOverlaySearch(id, { close: closeSearch });
    return () => setOverlaySearch(id, undefined);
  }, [id, searching, closeSearch]);

  useEffect(() => {
    if (!searching) return;
    // Android can consume Back to hide the IME before BackHandler hears it.
    const hidden = Keyboard.addListener("keyboardDidHide", closeSearch);
    return () => hidden.remove();
  }, [searching, closeSearch]);

  return {
    ...shown,
    query,
    searching,
    overflows,
    setQuery,
    onOverflowChange: searching ? undefined : setOverflow,
    open: () => setQuery(stepPlaylistPickerSearch(query, "open").query),
    clear: () => {
      const next = stepPlaylistPickerSearch(query, "clear");
      setQuery(next.query);
      if (next.query === null) Keyboard.dismiss();
    },
  };
}

type Search = ReturnType<typeof usePlaylistPickerSearch>;

/** Search replaces the heading in the same line; the subject stays below it. */
export function PlaylistPickerHeading({ search }: { search: Search }) {
  const { strings } = useLocalisation();
  const [accent, secondary] = useThemeColor(["accent", "secondary"]);
  return (
    <View className="flex-row items-center">
      {search.searching ? (
        <TextInput
          autoFocus
          value={search.query ?? ""}
          onChangeText={search.setQuery}
          placeholder={strings.library.find.playlists}
          accessibilityLabel={strings.library.find.playlists}
          placeholderTextColor={secondary}
          selectionColor={accent}
          cursorColor={accent}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          submitBehavior="submit"
          className="flex-1 font-sans text-body text-foreground"
          style={{ padding: 0, minWidth: 0 }}
        />
      ) : (
        <CatalogLine className="flex-1">{strings.playlists.addToPlaylist}</CatalogLine>
      )}
      {(search.searching || search.overflows) && (
        <IconButton
          icon={search.searching ? IconX : IconSearch}
          label={
            search.searching
              ? search.query === ""
                ? strings.settings.close
                : strings.playbackText.clearSearch
              : strings.library.find.playlists
          }
          onPress={search.searching ? search.clear : search.open}
          tone="secondary"
          size={CELL * 6}
          style={{ marginVertical: -CELL * 2, marginRight: -CELL * 1.5 }}
        />
      )}
    </View>
  );
}
