import { IconMicrophone, IconSearch, IconX } from "@tabler/icons-react-native";
import { type ComponentRef, type Ref, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { useThemeColor } from "@/theme/useThemeColor";

/** The drawn glyphs: Wave's 24dp line icons. */
const GLYPH = CELL * 3;
/** The clear (or Recognize Song) button's touch target. */
const TARGET = CELL * 6;
/**
 * How far the clear button's target reaches past the field's trailing edge, so
 * its glyph sits on the margin as the search glyph does on the other side (as
 * Back's sits on the margin of a pushed screen).
 */
const OVERHANG = (TARGET - GLYPH) / 2;

type Props = {
  ref?: Ref<ComponentRef<typeof TextInput>>;
  value: string;
  onChange: (text: string) => void;
  /** The keyboard's search key. */
  onSubmit?: () => void;
  /** What the empty field says (Search's own by default). */
  placeholder?: string;
  /** What a screen reader calls the field (Search's own by default). */
  accessibilityLabel?: string;
  /** Focus it on mount (the Design preview's focused state). */
  autoFocus?: boolean;
  /** The field was laid out: it is in the window, and can take the focus. */
  onLayout?: () => void;
  /** The field took or lost the focus. */
  onFocusChange?: (focused: boolean) => void;
  /** Search's own field: a Recognize Song button holds the clear button's cell while the field is empty. */
  onRecognize?: () => void;
};

/**
 * The search field, set like the app's other text fields: flat on the ground,
 * a row tall, over a hairline that turns teal while it has the keyboard. The
 * search glyph leads in a 32dp cell, the query reads in Body ink, and a clear
 * button's cell is kept at the end even when there is nothing to clear, so the
 * query never reflows as it appears. With [onRecognize], the empty field shows the
 * Recognize Song microphone in that cell.
 */
export function SearchField({
  ref,
  value,
  onChange,
  onSubmit,
  placeholder = "Songs, albums, artists, genres",
  accessibilityLabel = "Search your library",
  autoFocus = false,
  onLayout,
  onFocusChange,
  onRecognize,
}: Props) {
  const secondary = useThemeColor("secondary");
  const accent = useThemeColor("accent");
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <View className="flex-row items-center" style={{ height: grid.row }}>
        <View style={{ width: grid.stateCell }}>
          <IconSearch size={GLYPH} color={secondary} strokeWidth={1.5} />
        </View>
        <TextInput
          ref={ref}
          className="flex-1 font-sans text-body text-foreground"
          style={{ height: grid.row, padding: 0 }}
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          onLayout={onLayout}
          onFocus={() => {
            setFocused(true);
            onFocusChange?.(true);
          }}
          onBlur={() => {
            setFocused(false);
            onFocusChange?.(false);
          }}
          autoFocus={autoFocus}
          placeholder={placeholder}
          placeholderTextColor={secondary}
          selectionColor={accent}
          cursorColor={accent}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={accessibilityLabel}
        />
        <View style={{ width: TARGET, height: TARGET, marginRight: -OVERHANG }}>
          {value.length > 0 ? (
            <IconButton
              icon={IconX}
              label="Clear search"
              onPress={() => onChange("")}
              tone="secondary"
              size={TARGET}
              iconSize={GLYPH}
            />
          ) : (
            onRecognize !== undefined && (
              <IconButton
                icon={IconMicrophone}
                label="Recognize Song"
                onPress={onRecognize}
                tone="secondary"
                size={TARGET}
                iconSize={GLYPH}
              />
            )
          )}
        </View>
      </View>
      <View
        className={focused ? "bg-accent" : "bg-separator"}
        style={{ height: StyleSheet.hairlineWidth }}
      />
    </View>
  );
}
