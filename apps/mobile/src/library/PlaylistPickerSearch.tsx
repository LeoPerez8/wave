import { IconSearch, IconX } from "@tabler/icons-react-native";
import { TextInput, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { useLocalisation } from "@/localisation/localisation";
import { useThemeColor } from "@/theme/useThemeColor";

import { usePlaylistPickerSearch } from "./usePlaylistPickerSearch";

export { usePlaylistPickerSearch };

type Search = ReturnType<typeof usePlaylistPickerSearch>;

/** Search replaces the heading in the same line. */
export function PlaylistPickerHeading({ search }: { search: Search }) {
  const { strings } = useLocalisation();
  const [accent, secondary] = useThemeColor(["accent", "secondary"]);
  return (
    <View className="flex-row items-center">
      {search.searching ? (
        <TextInput
          autoFocus
          disableFullscreenUI
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
