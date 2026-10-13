import { IconPlus } from "@tabler/icons-react-native";
import {
  checkPlaylistName,
  confirmPlaylistDeletion,
  counted,
  describePlaylistAdd,
  nextPlaylistName,
  type PlaylistNameCheck,
} from "@wave/core";
import { Fragment, useState } from "react";
import { Text, TextInput, ToastAndroid, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { PlaylistEntry } from "@/catalog/PlaylistEntry";
import { TextButton } from "@/components/TextButton";
import { Press } from "@/motion/Press";
import { confirmAction } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { followUp, openOverlay, presentOverlay } from "@/overlay/overlay";
import { useThemeColor } from "@/theme/useThemeColor";

import { usePlaylists } from "./hooks";
import type { PlaylistRow, SongRow } from "./LibraryStore";
import {
  addToPlaylist,
  createPlaylist,
  currentPlaylists,
  deletePlaylist,
  knownPlaylists,
  playlistNames,
  renamePlaylist,
} from "./playlists";

const toast = (message: string): void => ToastAndroid.show(message, ToastAndroid.SHORT);

const failed = (what: string) => (): void => toast(`Couldn't ${what}`);

// ---------------------------------------------------------------------------
// Name prompt: New Playlist / Rename Playlist

interface NameRequest {
  readonly title: string;
  readonly confirmLabel: string;
  readonly initial: string;
  /** The other playlists' names (Core refuses a name one of them has). */
  readonly otherNames: readonly string[];
}

/** A glass card near the top, clear of the keyboard. Resolves with the name, or null when cancelled. */
const askName = (request: NameRequest): Promise<string | null> =>
  presentOverlay<string | null>({
    label: request.title,
    align: "top",
    dismissed: null,
    render: (finish) => <NameCard request={request} finish={finish} />,
  });

const PROBLEM: Record<Exclude<PlaylistNameCheck, { ok: true }>["problem"], string> = {
  empty: "Give the playlist a name.",
  taken: "Another playlist already has this name.",
  tooLong: "Names can be up to 100 characters.",
};

function NameCard({
  request,
  finish,
}: {
  request: NameRequest;
  finish: (name: string | null) => void;
}) {
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const [value, setValue] = useState(request.initial);
  const check = checkPlaylistName(value, request.otherNames);

  const confirm = () => {
    if (check.ok) finish(check.name);
  };

  return (
    <>
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Add to Playlist card

/** What is being added: a heading for the card and the songs, fetched on demand. */
export interface AddSubject {
  readonly title: string;
  readonly songs: () => Promise<readonly SongRow[]>;
}

/**
 * Opens the playlist picker for a track, an album, an artist's songs or a
 * playlist, with its playlists listed from the start (so it never grows once
 * shown): at once when they are remembered, else as soon as they are read.
 */
export const openAddToPlaylist = (subject: AddSubject): void => {
  const open = (): void => {
    openOverlay({
      label: "Add to playlist",
      render: (close) => <AddCard subject={subject} close={close} />,
    });
  };
  if (knownPlaylists() !== undefined) open();
  else void followUp(() => currentPlaylists().then(open, failed("list the playlists")));
};

const trackIds = (songs: readonly SongRow[]): number[] => songs.map((song) => song.id);

const addSongs = (playlistId: number, songs: () => Promise<readonly SongRow[]>): void => {
  void songs()
    .then((rows) => addToPlaylist(playlistId, trackIds(rows)))
    .then((result) => toast(describePlaylistAdd(result.name, result.added, result.alreadyIn)))
    .catch(failed("add to the playlist"));
};

function AddCard({ subject, close }: { subject: AddSubject; close: () => void }) {
  const accent = useThemeColor("accent");
  const playlists = usePlaylists();

  return (
    <>
      <View style={{ paddingBottom: CELL * 2, gap: CELL / 2 }}>
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
      {/* The card stops short of the screen edges; a long list scrolls inside it.
          Each playlist follows a divider, so none trails the last. */}
      <CardEntries>
        {playlists.map((playlist) => (
          <Fragment key={playlist.id}>
            <Hairline />
            <PlaylistEntry
              name={playlist.name}
              detail={counted(playlist.trackCount, "song")}
              paths={playlist.thumbPaths}
              onPress={() => {
                close();
                addSongs(playlist.id, subject.songs);
              }}
            />
          </Fragment>
        ))}
      </CardEntries>
    </>
  );
}

// ---------------------------------------------------------------------------
// Flows

/**
 * Asks for a name and creates a playlist, holding [songs] when given. Given
 * songs that turn out to be none (an empty Favorites), it creates nothing.
 * Resolves with the new playlist's id, or null when cancelled or not created.
 */
export const newPlaylist = (songs?: () => Promise<readonly SongRow[]>): Promise<number | null> =>
  // The name prompt highlights what the flow was started from.
  followUp(() => createNamedPlaylist(songs));

const createNamedPlaylist = async (
  songs?: () => Promise<readonly SongRow[]>,
): Promise<number | null> => {
  // Remembered names open the prompt at once. The songs (every song, from
  // Library › Songs) are read only once a name is chosen, so they never hold it up.
  const names = knownPlaylists()?.map((playlist) => playlist.name) ?? (await playlistNames());
  const name = await askName({
    title: "New playlist",
    confirmLabel: "Create",
    initial: nextPlaylistName(names),
    otherNames: names,
  });
  if (name === null) return null;
  try {
    const rows = songs === undefined ? [] : await songs();
    if (songs !== undefined && rows.length === 0) {
      toast(describePlaylistAdd(name, 0, 0));
      return null;
    }
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

/** What renaming or deleting a playlist needs to know about it (any `PlaylistRow` will do). */
export type NamedPlaylist = Pick<PlaylistRow, "id" | "name">;

export const renamePlaylistFlow = (playlist: NamedPlaylist): Promise<void> =>
  followUp(() => renameNamedPlaylist(playlist));

const renameNamedPlaylist = async (playlist: NamedPlaylist): Promise<void> => {
  const names = knownPlaylists()?.map((other) => other.name) ?? (await playlistNames());
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

/**
 * Asks once before deleting [playlists] ("Delete 3 playlists?"). `onConfirm`
 * runs once confirmed, before they go (the selection bar ends selection mode
 * there, so Cancel keeps it); `onDeleted` once they're gone (leave a deleted
 * playlist's screen).
 */
export const confirmDeletePlaylists = (
  playlists: readonly NamedPlaylist[],
  {
    onConfirm,
    onDeleted,
  }: {
    readonly onConfirm?: (() => void) | undefined;
    readonly onDeleted?: (() => void) | undefined;
  } = {},
): void => {
  if (playlists.length === 0) return;
  void confirmAction(confirmPlaylistDeletion(playlists)).then(async (confirmed) => {
    if (!confirmed) return;
    onConfirm?.();
    try {
      for (const playlist of playlists) await deletePlaylist(playlist.id);
      onDeleted?.();
    } catch {
      failed(playlists.length === 1 ? "delete the playlist" : "delete the playlists")();
    }
  });
};
