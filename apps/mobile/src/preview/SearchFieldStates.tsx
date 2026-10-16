import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { SearchField } from "@/search/SearchField";

import { LONG_TITLE_TRACK_ID, SYNTHETIC_TRACKS } from "./syntheticLibrary";

/** A query too long for the field, so the focused one shows where the cursor ends up. */
const LONG_QUERY =
  SYNTHETIC_TRACKS.find(({ track }) => track.id === LONG_TITLE_TRACK_ID)?.track.title ?? "";

/** One of the field's states under its catalog line; typing and clearing work. */
function FieldState({
  label,
  initial,
  autoFocus = false,
}: {
  label: string;
  initial: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <View style={{ paddingTop: CELL * 3 }}>
      <CatalogLine>{label}</CatalogLine>
      <SearchField
        value={value}
        onChange={setValue}
        onSubmit={() => undefined}
        autoFocus={autoFocus}
      />
    </View>
  );
}

/** The Design preview's Search shelf: Search's field empty, filled and focused. */
export function SearchFieldStates() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: insets.bottom + 48 }}
    >
      <FieldState label="Empty" initial="" />
      <FieldState label="Filled" initial="northern harbour" />
      <FieldState label="Focused" initial={LONG_QUERY} autoFocus />
    </ScrollView>
  );
}
