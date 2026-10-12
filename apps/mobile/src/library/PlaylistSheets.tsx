import { IconPlus } from "@tabler/icons-react-native";
import {
  checkPlaylistName,
  describePlaylistAdd,
  nextPlaylistName,
  type PlaylistNameCheck,
} from "@wave/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  ToastAndroid,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { PlaylistEntry } from "@/catalog/PlaylistEntry";
import { TextButton } from "@/components/TextButton";
import { makeExternalStore } from "@/lib/externalStore";
import { Press } from "@/motion/Press";
import { confirmAction } from "@/overlay/alert";
import { useThemeColor } from "@/theme/useThemeColor";

import { usePlaylists } from "./hooks";
import type { SongRow } from "./LibraryStore";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  playlistNames,
  renamePlaylist,
} from "./playlists";

const toast = (message: string): void => ToastAndroid.show(message, ToastAndroid.SHORT);

const songCount = (count: number): string =>
  `${count.toLocaleString("en")} ${count === 1 ? "song" : "songs"}`;

const failed = (what: string) => (): void => toast(`Couldn't ${what}`);

// ---------------------------------------------------------------------------
// Name sheet: New Playlist / Rename Playlist

interface NameRequest {
  readonly title: string;
  readonly confirmLabel: string;
  readonly initial: string;
  /** The other playlists' names (Core refuses a name one of them has). */
  readonly otherNames: readonly string[];
  readonly resolve: (name: string | null) => void;
}

const nameRequest = makeExternalStore<NameRequest | null>(null);

const askName = (request: Omit<NameRequest, "resolve">): Promise<string | null> =>
  new Promise((resolve) => {
    nameRequest.get()?.resolve(null);
    nameRequest.set({ ...request, resolve });
  });

const PROBLEM: Record<Exclude<PlaylistNameCheck, { ok: true }>["problem"], string> = {
  empty: "Give the playlist a name.",
  taken: "Another playlist already has this name.",
  tooLong: "Names can be up to 100 characters.",
};

function NameSheet({ request }: { request: NameRequest }) {
  const insets = useSafeAreaInsets();
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const [value, setValue] = useState(request.initial);
  const check = checkPlaylistName(value, request.otherNames);

  const finish = (name: string | null) => {
    nameRequest.set(null);
    request.resolve(name);
  };
  const confirm = () => {
    if (check.ok) finish(check.name);
  };

  return (
    <View className="flex-1">
      <View
        className="bg-background"
        style={{
          paddingTop: insets.top + CELL * 2,
          paddingHorizontal: grid.margin,
          paddingBottom: CELL,
        }}
      >
        <CatalogLine>{request.title}</CatalogLine>
        <TextInput
          value={value}
          onChangeText={setValue}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={confirm}
          accessibilityLabel="Playlist name"
          placeholder="Playlist name"
          placeholderTextColor={secondary}
          selectionColor={accent}
          cursorColor={accent}
          className="font-sans text-title3 text-foreground"
          style={{ height: grid.row, padding: 0 }}
        />
        <Hairline />
        {/* The line is reserved so the actions don't jump when a problem appears. */}
        <Text
          accessibilityLiveRegion="polite"
          className="font-sans text-footnote text-secondary"
          style={{ minHeight: CELL * 3, paddingTop: CELL / 2 }}
        >
          {check.ok || check.problem === "empty" ? "" : PROBLEM[check.problem]}
        </Text>
        <View className="flex-row justify-end" style={{ gap: CELL * 3 }}>
          <TextButton label="Cancel" onPress={() => finish(null)} />
          <TextButton label={request.confirmLabel} onPress={confirm} disabled={!check.ok} />
        </View>
      </View>
      <Pressable
        className="flex-1 bg-background/90"
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        onPress={() => finish(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Add to Playlist sheet

/** What is being added: a heading for the sheet and the songs, fetched on demand. */
export interface AddSubject {
  readonly title: string;
  readonly songs: () => Promise<readonly SongRow[]>;
}

const addSubject = makeExternalStore<AddSubject | null>(null);

const close = (): void => addSubject.set(null);

/** Opens the playlist picker for a track, an album, an artist's songs or a playlist. */
export const openAddToPlaylist = (subject: AddSubject): void => addSubject.set(subject);

const trackIds = (songs: readonly SongRow[]): number[] => songs.map((song) => song.id);

const addSongs = (playlistId: number, songs: () => Promise<readonly SongRow[]>): void => {
  void songs()
    .then((rows) => addToPlaylist(playlistId, trackIds(rows)))
    .then((result) => toast(describePlaylistAdd(result.name, result.added, result.alreadyIn)))
    .catch(failed("add to the playlist"));
};

function AddSheet({ subject }: { subject: AddSubject }) {
  const insets = useSafeAreaInsets();
  const accent = useThemeColor("accent");
  const { height } = useWindowDimensions();
  const playlists = usePlaylists();

  return (
    <View className="flex-1">
      <Pressable
        className="flex-1 bg-background/90"
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={close}
      />
      <View
        className="bg-background"
        style={{ paddingHorizontal: grid.margin, paddingBottom: insets.bottom + CELL * 2 }}
      >
        <Hairline />
        <View className="justify-center" style={{ height: grid.row, gap: CELL / 4 }}>
          <CatalogLine>Add to playlist</CatalogLine>
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {subject.title}
          </Text>
        </View>
        <Hairline />
        <Press
          accessibilityRole="button"
          accessibilityLabel="New Playlist"
          onPress={() => {
            close();
            void newPlaylist(subject.songs);
          }}
          haptic="selection"
          className="flex-row items-center"
          style={{ height: grid.row, gap: CELL * 1.5 }}
        >
          <View className="items-center justify-center" style={{ width: CELL * 5 }}>
            <IconPlus size={24} color={accent} strokeWidth={1.5} />
          </View>
          <Text className="font-sans text-body font-medium text-accent">New Playlist</Text>
        </Press>
        <ScrollView style={{ maxHeight: height * 0.45 }}>
          {playlists.map((playlist) => (
            <PlaylistEntry
              key={playlist.id}
              name={playlist.name}
              detail={songCount(playlist.trackCount)}
              paths={playlist.thumbPaths}
              onPress={() => {
                close();
                addSongs(playlist.id, subject.songs);
              }}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Flows

/**
 * Asks for a name and creates a playlist, holding [songs] when given. Resolves
 * with the new playlist's id, or null when cancelled.
 */
export const newPlaylist = async (
  songs?: () => Promise<readonly SongRow[]>,
): Promise<number | null> => {
  const names = await playlistNames();
  const name = await askName({
    title: "New playlist",
    confirmLabel: "Create",
    initial: nextPlaylistName(names),
    otherNames: names,
  });
  if (name === null) return null;
  try {
    const rows = songs === undefined ? [] : await songs();
    const result = await createPlaylist(name, trackIds(rows));
    toast(
      songs === undefined
        ? `Created ${result.name}`
        : describePlaylistAdd(result.name, result.added, result.alreadyIn),
    );
    return result.playlistId;
  } catch {
    failed("create the playlist")();
    return null;
  }
};

export const renamePlaylistFlow = async (playlist: {
  readonly id: number;
  readonly name: string;
}): Promise<void> => {
  const names = await playlistNames();
  const name = await askName({
    title: "Rename playlist",
    confirmLabel: "Rename",
    initial: playlist.name,
    // Keeping the current name is fine.
    otherNames: names.filter((other) => other !== playlist.name),
  });
  if (name === null || name === playlist.name) return;
  await renamePlaylist(playlist.id, name).catch(failed("rename the playlist"));
};

/** Asks before deleting; `onDeleted` runs once it's gone (leave its screen). */
export const confirmDeletePlaylist = (
  playlist: { readonly id: number; readonly name: string },
  onDeleted?: () => void,
): void =>
  void confirmAction({
    title: `Delete ${playlist.name}?`,
    message: "Its songs stay in your library.",
    action: { label: "Delete", destructive: true },
  }).then((confirmed) =>
    confirmed
      ? deletePlaylist(playlist.id)
          .then(() => onDeleted?.())
          .catch(failed("delete the playlist"))
      : undefined,
  );

/** The playlist picker and the name prompt. Mounted once at the root. */
export function PlaylistSheets() {
  const request = useSyncExternalStore(nameRequest.subscribe, nameRequest.get);
  const subject = useSyncExternalStore(addSubject.subscribe, addSubject.get);

  // A pending name prompt is cancelled if the sheets unmount.
  useEffect(() => () => nameRequest.get()?.resolve(null), []);

  return (
    <>
      <Modal
        visible={subject !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => addSubject.set(null)}
      >
        {subject !== null && <AddSheet subject={subject} />}
      </Modal>
      <Modal
        visible={request !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => {
          request?.resolve(null);
          nameRequest.set(null);
        }}
      >
        {/* Keyed so a new prompt starts from its own initial name. */}
        {request !== null && <NameSheet key={request.initial + request.title} request={request} />}
      </Modal>
    </>
  );
}
