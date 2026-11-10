/**
 * Library › Playlists › Import Playlists › Export to YT Music (docs/spec.md,
 * "Exporting to YT Music"): the picker sheet From YT Music rises in, listing
 * the Wave playlists in the Playlists list's order, every one ticked but
 * those that came From YT Music (Core's `ytExportPicker`). Export sends the
 * ticked ones in the background (`exportToYtMusic`); Cancel, Back or
 * dragging the sheet down sends nothing.
 */
import {
  importProgressLine,
  planYtExport,
  pressYtExportSelectAll,
  toggleYtExportRow,
  ytExportPicker,
  ytExportPickerView,
  type YtExportPicker as Picker,
  type YtExportRow,
} from "@wave/core";
import { IconStar } from "@tabler/icons-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";

import { CheckCell } from "@/catalog/CheckCell";
import { CELL, grid } from "@/catalog/grid";
import { Mosaic } from "@/catalog/Mosaic";
import { useLocalisation } from "@/localisation/localisation";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { FAVORITES_EXPORT_ID, useImportProgress } from "./importProgress";
import type { PlaylistRow } from "./LibraryStore";
import { PickerSheetFrame } from "./PickerSheetFrame";
import { useSortedPlaylists } from "./playlistSort";
import { currentYtLibraryOrigins } from "./ytLibraryImport";
import { exportToYtMusic } from "./ytExportRun";

const COVER = CELL * 6;

/** The Export to YT Music sheet (`YtLibraryPickerHost` mounts it while it's up). */
export function ExportSheet({ onClosed }: { onClosed: () => void }) {
  const { strings, language } = useLocalisation();
  const accent = useThemeColor("accent");
  const playlists = useSortedPlaylists();
  const [picker, setPicker] = useState<Picker<PlaylistRow> | null>(null);

  // Made once, from the playlists as the sheet opens; the ticks are the owner's from then on.
  useEffect(() => {
    let current = true;
    void currentYtLibraryOrigins().then((origins) => {
      if (current) setPicker((made) => made ?? ytExportPicker(playlists, origins, language));
    });
    return () => {
      current = false;
    };
  }, [playlists, language]);

  const view = picker === null ? null : ytExportPickerView(picker);
  const change = (next: (picker: Picker<PlaylistRow>) => Picker<PlaylistRow>) =>
    setPicker((last) => (last === null ? last : next(last)));

  return (
    <PickerSheetFrame
      title={strings.imports.exportToYtMusic}
      selectAll={
        view?.selectAll == null
          ? null
          : view.selectAll === "Select All"
            ? strings.imports.selectAll
            : strings.imports.deselectAll
      }
      onSelectAll={() => change(pressYtExportSelectAll)}
      onClosed={onClosed}
      actions={[
        {
          label: strings.imports.export,
          // Export does nothing while no row is ticked.
          disabled: view?.canExport !== true,
          afterwards: () => {
            if (picker !== null) void exportToYtMusic(planYtExport(picker));
          },
        },
      ]}
    >
      {picker === null ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator
            size="large"
            color={accent}
            accessibilityLabel={strings.imports.reading}
          />
        </View>
      ) : (
        <FlatList
          data={picker.rows}
          extraData={picker}
          keyExtractor={(row) => row.key}
          renderItem={({ item }) => (
            <ExportRow
              row={item}
              toggle={() => change((last) => toggleYtExportRow(last, item.key))}
            />
          )}
          contentContainerStyle={{ paddingVertical: CELL }}
        />
      )}
    </PickerSheetFrame>
  );
}

/**
 * A playlist the export picker lists: its tick, cover, name, "N songs" and,
 * when it came From YT Music, From YT Music. A tap ticks or unticks it.
 */
function ExportRow({ row, toggle }: { row: YtExportRow<PlaylistRow>; toggle: () => void }) {
  const { strings, language } = useLocalisation();
  const accent = useThemeColor("accent");
  const progress = useImportProgress(
    row.kind === "favorites" ? FAVORITES_EXPORT_ID : row.playlist.id,
  );
  const name = row.kind === "favorites" ? strings.home.sections.favorites : row.playlist.name;
  const line =
    progress === null
      ? row.kind === "playlist"
        ? row.line
        : null
      : importProgressLine(progress, language);
  const fromYtMusic = row.kind === "playlist" && row.fromYtMusic;
  const label = [name, line, fromYtMusic ? strings.imports.fromYtMusic : null]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <Press
      accessibilityRole="checkbox"
      accessibilityState={{ checked: row.ticked }}
      accessibilityLabel={label}
      onPress={toggle}
      haptic="selection"
    >
      <View
        className="flex-row items-center"
        style={{
          minHeight: grid.row + CELL,
          paddingLeft: grid.margin - CELL,
          paddingRight: grid.margin,
          gap: CELL * 1.5,
        }}
      >
        <CheckCell checked={row.ticked} />
        {row.kind === "playlist" ? (
          <Mosaic paths={row.playlist.thumbPaths} size={COVER} radius={CELL / 2} />
        ) : (
          <View
            className="items-center justify-center bg-surface"
            style={{ width: COVER, height: COVER, borderRadius: CELL / 2 }}
          >
            <IconStar size={CELL * 3} color={accent} />
          </View>
        )}
        <View className="flex-1" style={{ gap: CELL / 4 }}>
          <Text numberOfLines={1} className="font-sans text-body text-foreground">
            {name}
          </Text>
          <Text numberOfLines={1} className="font-sans text-subheadline text-secondary">
            {line}
          </Text>
        </View>
        {fromYtMusic && (
          <Text className="font-sans text-subheadline text-secondary">
            {strings.imports.fromYtMusic}
          </Text>
        )}
      </View>
    </Press>
  );
}
