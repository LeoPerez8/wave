import { IconPlus } from "@tabler/icons-react-native";
import {
  checkPlaylistName,
  confirmPlaylistDeletion,
  describePlaylistAdd,
  keepAddToPlaylistOrder,
  nextPlaylistName,
  type Catalogue,
  type PlaylistNameCheck,
  type PlaylistSong,
} from "@wave/core";
import { Fragment, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { PlaylistEntry } from "@/catalog/PlaylistEntry";
import { TextButton } from "@/components/TextButton";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { confirmAction } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { followUp, openOverlay, presentOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import { useThemeColor } from "@/theme/useThemeColor";

import { usePlaylists } from "./hooks";
import type { PlaylistRow } from "./LibraryStore";
import { cancelPlaylistImport } from "./playlistImports";
import { PlaylistPickerHeading, usePlaylistPickerSearch } from "./PlaylistPickerSearch";
import { framePhoto } from "./PhotoCropperHost";
import {
  addToPlaylist,
  adjustPlaylistImage,
  createPlaylist,
  currentPlaylists,
  deletePlaylist,
  knownPlaylists,
  pickPlaylistImage,
  playlistNames,
  removePlaylistImage,
  renamePlaylist,
} from "./playlists";
import { forgetDeletedYtLibraryPlaylists } from "./ytLibraryImport";

const toast = (message: string): void => void showToast(message);

/** A toast for an edit that failed, the text read when it fails. */
const failed = (text: () => string) => (): void => toast(text());

/** The playlists text in the language Wave reads in now. */
const text = () => currentLocalisation().strings.playlists;

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

/**
 * New Playlist's name prompt, the first free "New Playlist" filled in and the
 * playlists' [names] refused. Resolves with the name, or null when cancelled.
 */
const askNewPlaylistName = (names: readonly string[]): Promise<string | null> => {
  const { language, strings } = currentLocalisation();
  return askName({
    title: strings.playlists.newPlaylistTitle,
    confirmLabel: strings.playlists.create,
    initial: nextPlaylistName(names, language),
    otherNames: names,
  });
};

const problemText = (
  problem: Exclude<PlaylistNameCheck, { ok: true }>["problem"],
  { playlists }: Catalogue,
): string =>
  problem === "empty"
    ? playlists.nameEmpty
    : problem === "taken"
      ? playlists.nameTaken
      : playlists.nameTooLong;

function NameCard({
  request,
  finish,
}: {
  request: NameRequest;
  finish: (name: string | null) => void;
}) {
  const [accent, secondary] = useThemeColor(["accent", "secondary"]);
  const [value, setValue] = useState(request.initial);
  const { strings } = useLocalisation();
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
        accessibilityLabel={strings.playlists.playlistName}
        placeholder={strings.playlists.playlistName}
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
        {check.ok || check.problem === "empty" ? "" : problemText(check.problem, strings)}
      </Text>
      <View className="flex-row justify-end" style={{ gap: CELL * 3 }}>
        <TextButton label={strings.playlists.cancel} onPress={() => finish(null)} />
        <TextButton label={request.confirmLabel} onPress={confirm} disabled={!check.ok} />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Add to Playlist card

/**
 * What is being added: a heading for the card and the songs, fetched on
 * demand: Library tracks, and YT Music songs the Library doesn't have (Core's
 * `PlaylistSong`).
 */
export interface AddSubject {
  readonly title: string;
  readonly songs: () => Promise<readonly PlaylistSong[]>;
}

/**
 * Opens the playlist picker for a track, an album, an artist's songs or a
 * playlist, with its playlists listed from the start (so it never grows once
 * shown): at once when they are remembered, else as soon as they are read.
 */
export const openAddToPlaylist = (subject: AddSubject): void => {
  const open = (): void => {
    openOverlay({
      label: text().addToPlaylist,
      render: (close) => <AddCard subject={subject} close={close} />,
    });
  };
  if (knownPlaylists() !== undefined) open();
  else
    void followUp(() =>
      currentPlaylists().then(
        open,
        failed(() => text().couldntList),
      ),
    );
};

const addSongs = (playlistId: number, songs: () => Promise<readonly PlaylistSong[]>): void => {
  void songs()
    .then((rows) => addToPlaylist(playlistId, rows))
    .then((result) =>
      toast(
        describePlaylistAdd(
          result.name,
          result.added,
          result.alreadyIn,
          currentLocalisation().language,
        ),
      ),
    )
    .catch(failed(() => text().couldntAdd));
};

function AddCard({ subject, close }: { subject: AddSubject; close: () => void }) {
  const allPlaylists = usePlaylists();
  const [choices, setChoices] = useState(() => ({
    source: allPlaylists,
    rows: keepAddToPlaylistOrder(allPlaylists, []),
  }));
  if (choices.source !== allPlaylists) {
    setChoices({ source: allPlaylists, rows: keepAddToPlaylistOrder(allPlaylists, choices.rows) });
  }
  const search = usePlaylistPickerSearch(choices.rows);
  const { strings } = useLocalisation();
  const creationRow = (
    <TextButton
      label={strings.playlists.newPlaylist}
      accessibilityRole="button"
      accessibilityLabel={strings.playlists.newPlaylist}
      onPress={() => {
        close();
        void newPlaylist(subject.songs);
      }}
      className="flex-row items-center"
      style={{ height: grid.row, gap: CELL * 1.5, justifyContent: "flex-start" }}
    >
      {(accent) => (
        <>
          <View className="items-center justify-center" style={{ width: CELL * 5 }}>
            <IconPlus size={24} color={accent} strokeWidth={1.5} />
          </View>
          <Text className="font-sans text-body font-medium text-accent">
            {strings.playlists.newPlaylist}
          </Text>
        </>
      )}
    </TextButton>
  );

  return (
    <>
      <View style={{ paddingBottom: CELL * 2, gap: CELL / 2 }}>
        <PlaylistPickerHeading search={search} />
        <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
          {subject.title}
        </Text>
      </View>
      <Hairline />
      {search.newPlaylistPlacement === "pinned" && creationRow}
      {/* Searching lets every choice scroll above a landscape keyboard. */}
      <CardEntries onOverflowChange={search.onOverflowChange}>
        {search.newPlaylistPlacement === "scroll" && creationRow}
        {search.noMatch && (
          <Text
            accessibilityLiveRegion="polite"
            className="font-sans text-body text-secondary"
            style={{ paddingVertical: CELL * 2 }}
          >
            {strings.library.noMatch.playlists}
          </Text>
        )}
        {search.playlists.map((playlist, index) => (
          <Fragment key={playlist.id}>
            {(index > 0 || search.showNewPlaylist) && <Hairline />}
            <PlaylistEntry
              name={playlist.name}
              detail={strings.playlists.songs(playlist.trackCount)}
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
 * Resolves with the new playlist (its id and stored name), or null when
 * cancelled or not created.
 */
export const newPlaylist = (
  songs?: () => Promise<readonly PlaylistSong[]>,
): Promise<NamedPlaylist | null> =>
  // Remembered names open the prompt at once. The songs (every song, from
  // Library › Songs) are read only once a name is chosen, so they never hold it up.
  promptNewPlaylist(playlistNames, (name) => createNamedPlaylist(name, songs));

/**
 * New Playlist's flow, from the press that starts it (call it before anything
 * awaits): reads the playlists' [names], asks for a name (the first free "New
 * Playlist" filled in, [names] refused), then hands it to [named]. The prompt
 * and any card [named] opens highlight what the press was on. Resolves with
 * what [named] does, or null when cancelled. The Design preview runs it too,
 * with synthetic names and a [named] that does nothing.
 */
export const promptNewPlaylist = <T,>(
  names: () => Promise<readonly string[]>,
  named: (name: string) => Promise<T | null>,
): Promise<T | null> =>
  followUp(async () => {
    const name = await askNewPlaylistName(await names());
    return name === null ? null : named(name);
  });

const createNamedPlaylist = async (
  name: string,
  songs?: () => Promise<readonly PlaylistSong[]>,
): Promise<NamedPlaylist | null> => {
  try {
    const rows = songs === undefined ? [] : await songs();
    if (songs !== undefined && rows.length === 0) {
      toast(describePlaylistAdd(name, 0, 0, currentLocalisation().language));
      return null;
    }
    const result = await createPlaylist(name, rows);
    toast(
      songs === undefined
        ? text().created(result.name)
        : describePlaylistAdd(
            result.name,
            result.added,
            result.alreadyIn,
            currentLocalisation().language,
          ),
    );
    return { id: result.playlistId, name: result.name };
  } catch {
    failed(() => text().couldntCreate)();
    return null;
  }
};

/** What renaming or deleting a playlist needs to know about it (any `PlaylistRow` will do). */
export type NamedPlaylist = Pick<PlaylistRow, "id" | "name">;

export const renamePlaylistFlow = (playlist: NamedPlaylist): Promise<void> =>
  followUp(() => renameNamedPlaylist(playlist));

const renameNamedPlaylist = async (playlist: NamedPlaylist): Promise<void> => {
  const names = await playlistNames();
  const name = await askName({
    title: text().renamePlaylist,
    confirmLabel: text().rename,
    initial: playlist.name,
    // Keeping the current name is fine.
    otherNames: names.filter((other) => other !== playlist.name),
  });
  if (name === null || name === playlist.name) return;
  await renamePlaylist(playlist.id, name).catch(failed(() => text().couldntRename));
};

/**
 * Change Image: Android's photo picker, then the crop screen on the picked
 * photo, then that square of it in place of the mosaic.
 */
export const changePlaylistImageFlow = (playlist: NamedPlaylist): Promise<void> =>
  pickPlaylistImage(playlist.id, framePhoto).then(
    () => {},
    failed(() => text().couldntChangeImage),
  );

/** Adjust Image: the crop screen on the original photo, at the last framing. */
export const adjustPlaylistImageFlow = (playlist: NamedPlaylist): Promise<void> =>
  adjustPlaylistImage(playlist.id, framePhoto).then(
    () => {},
    failed(() => text().couldntAdjustImage),
  );

/** Remove Image: the playlist's mosaic shows again. */
export const removePlaylistImageFlow = (playlist: NamedPlaylist): Promise<void> =>
  removePlaylistImage(playlist.id).catch(failed(() => text().couldntRemoveImage));

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
  void confirmAction(confirmPlaylistDeletion(playlists, currentLocalisation().language)).then(
    async (confirmed) => {
      if (!confirmed) return;
      onConfirm?.();
      try {
        for (const playlist of playlists) {
          cancelPlaylistImport(playlist.id);
          await deletePlaylist(playlist.id);
        }
        await forgetDeletedYtLibraryPlaylists(playlists.map((playlist) => playlist.id));
        onDeleted?.();
      } catch {
        failed(() => text().couldntDelete(playlists.length))();
      }
    },
  );
};
