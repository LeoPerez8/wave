import {
  confirmImportReplace,
  importNameClash,
  isM3uFileName,
  keepBothName,
  libraryPathIndex,
  planM3uImport,
  summarizeM3uImport,
  type LibraryPathIndex,
  type M3uImportOutcome,
  type M3uImportSummary,
  type PlaylistSong,
} from "@wave/core";
import { ScrollView, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { WaveNative, type PickedPlaylistFile } from "@/native/waveNative";
import { confirmAction, showError } from "@/overlay/alert";
import { presentOverlay } from "@/overlay/overlay";

import { LibraryStore } from "./LibraryStore";
import { cancelPlaylistImport } from "./playlistImports";
import {
  createPlaylist,
  currentPlaylists,
  libraryPlaylistSongs,
  replacePlaylistSongs,
} from "./playlists";
import { appRuntime } from "./runtime";

/** Imports one picked file: a new playlist, or a playlist of that name replaced, as the owner chooses. */
const importFile = async (
  file: PickedPlaylistFile,
  library: LibraryPathIndex<number>,
): Promise<M3uImportOutcome> => {
  if (!isM3uFileName(file.name)) return { kind: "notPlaylist", file: file.name };
  if (file.text === null) return { kind: "unreadable", file: file.name };
  const plan = planM3uImport({ name: file.name, path: file.path, text: file.text }, library);
  if (plan.trackIds.length === 0)
    return { kind: "nothingFound", file: file.name, missing: plan.missing };

  const saved = await saveImportedPlaylist(plan.name, libraryPlaylistSongs(plan.trackIds));
  return {
    kind: "imported",
    songs: plan.trackIds.length,
    missing: plan.missing,
    name: saved.name,
    replaced: saved.replaced,
  };
};

/** The playlist an import made or replaced. */
export interface ImportedPlaylist {
  readonly playlistId: number;
  readonly name: string;
  /** It replaced the songs of a playlist that had its name. */
  readonly replaced: boolean;
}

/**
 * Saves an imported playlist named [name] holding [songs]. When a playlist
 * already has the name, asks Replace (that playlist gets these songs) or Keep
 * Both (a new playlist with the name numbered, Core's `keepBothName`).
 */
export const saveImportedPlaylist = async (
  name: string,
  songs: readonly PlaylistSong[],
): Promise<ImportedPlaylist> => {
  const playlists = await currentPlaylists();
  const clash = importNameClash(name, playlists);
  if (clash !== undefined && (await confirmAction(confirmImportReplace(clash.name, currentLocalisation().language)))) {
    // A link import still filling it would add its songs to the new ones.
    cancelPlaylistImport(clash.id);
    await replacePlaylistSongs(clash.id, songs);
    return { playlistId: clash.id, name: clash.name, replaced: true };
  }
  const created = await createPlaylist(
    clash === undefined
      ? name
      : keepBothName(
          name,
          playlists.map((playlist) => playlist.name),
        ),
    songs,
  );
  return { playlistId: created.playlistId, name: created.name, replaced: false };
};

/**
 * Library › Playlists › Import › From Files (Import itself with YT Music
 * off, `openPlaylistImport`): opens the system file picker for
 * M3U files, makes a playlist of each (Core's `planM3uImport`), asking before
 * replacing one with the same name, then shows what was imported and skipped.
 */
export const importPlaylists = async (): Promise<void> => {
  try {
    const files = await WaveNative.pickPlaylistFiles();
    if (files.length === 0) return;
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    const tracks = await appRuntime.runPromise(LibraryStore.use((store) => store.trackPaths));
    const library = libraryPathIndex(tracks);
    const outcomes: M3uImportOutcome[] = [];
    // One at a time: each may ask about a name clash, and sees the playlists made before it.
    for (const file of files) outcomes.push(await importFile(file, library));
    await showImportSummary(summarizeM3uImport(outcomes, currentLocalisation().language));
  } catch (error) {
    await showError(currentLocalisation().strings.imports.couldntImportPlaylists, error);
  }
};

/**
 * The summary card: what each file became, and the entries left out,
 * scrolling when long. The BlackPlayer stats import shows its summary in it too.
 */
export const showImportSummary = (summary: M3uImportSummary): Promise<void> =>
  presentOverlay<void>({
    label: summary.title,
    dismissed: undefined,
    render: (finish) => <ImportSummaryCard summary={summary} finish={finish} />,
  });

function ImportSummaryCard({ summary, finish }: { summary: M3uImportSummary; finish: () => void }) {
  const { strings } = useLocalisation();
  return (
    <>
      <Text
        className="font-sans text-title3 font-normal text-foreground"
        style={{ paddingTop: CELL, paddingBottom: CELL }}
      >
        {summary.title}
      </Text>
      <View style={{ flexShrink: 1 }}>
        <ScrollView bounces={false} overScrollMode="never">
          <View style={{ gap: CELL * 2, paddingBottom: CELL * 2 }}>
            {summary.sections.map((section, i) => (
              <View key={i} style={{ gap: CELL / 2 }}>
                <Text className="font-sans text-body font-medium text-foreground">
                  {section.heading}
                </Text>
                <Text className="font-sans text-subheadline text-secondary">{section.detail}</Text>
                {section.missing.map((entry, j) => (
                  <Text key={j} className="font-sans text-footnote text-secondary">
                    {entry}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
      <View className="flex-row items-center justify-end">
        <TextButton label={strings.imports.ok} onPress={finish} />
      </View>
    </>
  );
}
