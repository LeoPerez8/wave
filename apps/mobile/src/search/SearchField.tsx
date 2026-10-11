import { IconSearch, IconX } from "@tabler/icons-react-native";
import type { ComponentRef, Ref } from "react";
import { TextInput, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

type Props = {
  ref?: Ref<ComponentRef<typeof TextInput>>;
  value: string;
  onChange: (text: string) => void;
  /** The keyboard's search key. */
  onSubmit: () => void;
};

/**
 * The search field: a square field-tone well with the search glyph, the query
 * in Body ink, and a clear button once there is something to clear.
 */
export function SearchField({ ref, value, onChange, onSubmit }: Props) {
  const secondary = useThemeColor("secondary");
  const accent = useThemeColor("accent");
  return (
    <View
      className="flex-row items-center bg-fill"
      style={{ height: CELL * 6, paddingLeft: CELL * 1.5, gap: CELL }}
    >
      <IconSearch size={20} color={secondary} strokeWidth={1.5} />
      <TextInput
        ref={ref}
        className="flex-1 font-sans text-body text-foreground"
        style={{ height: CELL * 6, paddingVertical: 0 }}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        placeholder="Songs, albums, artists, genres"
        placeholderTextColor={secondary}
        selectionColor={accent}
        cursorColor={accent}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search your library"
      />
      {value.length > 0 ? (
        <Press
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChange("")}
          haptic="selection"
          depth={0.1}
          className="items-center justify-center"
          style={{ width: CELL * 6, height: CELL * 6 }}
        >
          <IconX size={20} color={secondary} strokeWidth={1.5} />
        </Press>
      ) : (
        <View style={{ width: CELL * 0.5 }} />
      )}
    </View>
  );
}
