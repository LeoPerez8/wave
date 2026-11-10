/**
 * Library › Playlists › Import Playlists › From YT Music and From Spotify
 * (docs/spec.md, "Importing playlists from a link"): signed out, it signs in
 * first (the sign-in Settings › Accounts uses), then a full-screen sheet
 * rises with the playlists in the account's YouTube Music or Spotify
 * library. Core decides the rows, the ticks, Select All and, From YT Music,
 * the Also add to Favorites switch under Liked Songs (`ytLibraryPicker`,
 * `spotifyLibraryPicker`); Import makes the playlists and reads them in
 * the background (`importYtLibrary`), and Import & Download beside it also
 * queues each playlist's downloads once it's read. Cancel, Back or dragging
 * the sheet down imports nothing.
 */
import {
  pressYtLibrarySelectAll,
  readSpotifyLibrary,
  spotifyLibraryFailure,
  spotifyLibraryPicker,
  toggleYtLibraryFavorites,
  toggleYtLibraryRow,
  YT_LIKED_SONGS_ID,
  ytLibraryFailure,
  ytLibraryPicker,
  ytLibraryPickerView,
  type YtLibraryFailureView,
  type YtLibraryPicker as Picker,
  type YtLibraryPickerView,
  type YtLibraryRow,
} from "@wave/core";
import * as Result from "effect/Result";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Switch, Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CheckCell } from "@/catalog/CheckCell";
import { CELL, grid } from "@/catalog/grid";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { TextButton } from "@/components/TextButton";
import { Press } from "@/motion/Press";
import { showError } from "@/overlay/alert";
import { signInToSpotify } from "@/settings/spotifyAccount";
import { signInToYtMusic } from "@/settings/ytAccount";
import { askSpotifyAccount } from "@/spotify/askSpotify";
import { useThemeColor } from "@/theme/useThemeColor";
import { askYtMusic } from "@/ytmusic/askYtMusic";

import { PickerSheetFrame } from "./PickerSheetFrame";
import type { LibraryService } from "./YtLibraryPickerHost";
import { currentYtLibraryOrigins, importYtLibrary } from "./ytLibraryImport";

// ---------------------------------------------------------------------------
// Reading the library

type LibraryRead =
  | { readonly status: "reading" }
  | { readonly status: "read"; readonly picker: Picker }
  | { readonly status: "failed"; readonly failure: YtLibraryFailureView };

const READING: LibraryRead = { status: "reading" };

const readYtLibrary = async (): Promise<LibraryRead> => {
  const answer = await askYtMusic((ytMusic) => ytMusic.libraryPlaylists);
  // Liked Songs is named in the language Wave reads in as it's read, and saved so.
  const { language } = currentLocalisation();
  return Result.isFailure(answer)
    ? { status: "failed", failure: ytLibraryFailure(answer.failure.reason, language) }
    : {
        status: "read",
        picker: ytLibraryPicker(answer.success, await currentYtLibraryOrigins(), language),
      };
};

const readSpotifyAccountLibrary = async (): Promise<LibraryRead> => {
  const answer = await readSpotifyLibrary((offset) =>
    askSpotifyAccount((spotify) => spotify.library(offset)),
  );
  const { language } = currentLocalisation();
  return answer.ok
    ? {
        status: "read",
        picker: spotifyLibraryPicker(answer.playlists, await currentYtLibraryOrigins(), language),
      }
    : { status: "failed", failure: spotifyLibraryFailure(answer.reason, language) };
};

/** What differs between the two pickers. */
const SERVICES: Record<
  LibraryService,
  {
    /** The imports catalogue's keys for its title and its reading line. */
    readonly titleKey: "fromYtMusic" | "fromSpotify";
    readonly readingKey: "readingYtMusicLibrary" | "readingSpotifyLibrary";
    readonly read: () => Promise<LibraryRead>;
    readonly signIn: () => Promise<boolean>;
  }
> = {
  ytMusic: {
    titleKey: "fromYtMusic",
    readingKey: "readingYtMusicLibrary",
    read: readYtLibrary,
    signIn: signInToYtMusic,
  },
  spotify: {
    titleKey: "fromSpotify",
    readingKey: "readingSpotifyLibrary",
    read: readSpotifyAccountLibrary,
    signIn: signInToSpotify,
  },
};

// ---------------------------------------------------------------------------
// The sheet

const COVER = CELL * 6;

/**
 * The picker sheet for [service]'s library (`YtLibraryPickerHost` mounts it
 * while it's up): it reads the library (again on Try Again), and goes back
 * down on Cancel, Back, a drag down or Import.
 */
export function PickerSheet({
  service,
  onClosed,
}: {
  service: LibraryService;
  onClosed: () => void;
}) {
  const config = SERVICES[service];
  const { strings } = useLocalisation();
  const accent = useThemeColor("accent");

  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ readonly attempt: number; readonly read: LibraryRead }>();
  const read: LibraryRead = answer?.attempt === attempt ? answer.read : READING;

  useEffect(() => {
    let current = true;
    void config.read().then((next) => {
      if (current) setAnswer({ attempt, read: next });
    });
    return () => {
      current = false;
    };
  }, [attempt, config]);

  const setPicker = (change: (picker: Picker) => Picker) =>
    setAnswer((last) =>
      last?.read.status === "read"
        ? { ...last, read: { status: "read", picker: change(last.read.picker) } }
        : last,
    );

  const view = read.status === "read" ? ytLibraryPickerView(read.picker) : null;

  /** Import, or Import & Download with [download], once the sheet has gone. */
  const importTicked = (download: boolean) => () => {
    if (read.status !== "read") return;
    void importYtLibrary(read.picker, { download }).catch((error: unknown) =>
      showError(strings.imports.couldntImportPlaylists, error),
    );
  };
  // Import and Import & Download do nothing while no row is ticked.
  const disabled = view?.canImport !== true;

  const signInAgain = () => {
    void config.signIn().then((signedIn) => {
      if (signedIn) setAttempt((n) => n + 1);
    });
  };

  return (
    <PickerSheetFrame
      title={strings.imports[config.titleKey]}
      selectAll={
        view?.selectAll == null
          ? null
          : view.selectAll === "Select All"
            ? strings.imports.selectAll
            : strings.imports.deselectAll
      }
      onSelectAll={() => setPicker(pressYtLibrarySelectAll)}
      onClosed={onClosed}
      actions={[
        { label: strings.imports.import, disabled, afterwards: importTicked(false) },
        { label: strings.imports.importDownload, disabled, afterwards: importTicked(true) },
      ]}
    >
      {read.status === "reading" && (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator
            size="large"
            color={accent}
            accessibilityLabel={strings.imports[config.readingKey]}
          />
        </View>
      )}
      {read.status === "failed" && (
        <Failure
          failure={read.failure}
          tryAgain={() => setAttempt((n) => n + 1)}
          signIn={signInAgain}
        />
      )}
      {read.status === "read" && (
        // Never empty: Liked Songs is always listed.
        <FlatList
          data={read.picker.rows}
          extraData={read.picker}
          keyExtractor={(row) => row.playlistId}
          renderItem={({ item }) => (
            <>
              <PickerRow
                row={item}
                toggle={() => setPicker((picker) => toggleYtLibraryRow(picker, item.playlistId))}
              />
              {item.playlistId === YT_LIKED_SONGS_ID && view !== null && (
                <FavoritesSwitch
                  favorites={view.favorites}
                  toggle={() => setPicker(toggleYtLibraryFavorites)}
                />
              )}
            </>
          )}
          contentContainerStyle={{ paddingVertical: CELL }}
        />
      )}
    </PickerSheetFrame>
  );
}

/**
 * A playlist the picker lists: its tick, cover, name, "N songs" and, when
 * imported on this phone before, Imported. A tap ticks or unticks it.
 */
function PickerRow({ row, toggle }: { row: YtLibraryRow; toggle: () => void }) {
  const { strings } = useLocalisation();
  const label = [row.title, row.line, row.imported ? strings.imports.imported : null]
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
        <Artwork uri={row.artworkUrl ?? undefined} size={COVER} radius={CELL / 2} />
        <View className="flex-1" style={{ gap: CELL / 4 }}>
          <Text numberOfLines={1} className="font-sans text-body text-foreground">
            {row.title}
          </Text>
          {row.line !== null && (
            <Text numberOfLines={1} className="font-sans text-subheadline text-secondary">
              {row.line}
            </Text>
          )}
        </View>
        {row.imported && (
          <Text className="font-sans text-subheadline text-secondary">
            {strings.imports.imported}
          </Text>
        )}
      </View>
    </Press>
  );
}

/** Where a row's name starts: past its tick and cover. */
const TEXT_INSET = grid.margin - CELL + grid.stateCell + CELL * 1.5 + COVER + CELL * 1.5;

/**
 * Also add to Favorites, under Liked Songs, lined up with the rows' names:
 * Import stars the liked songs the Library has. Off and dimmed while Liked
 * Songs is unticked.
 */
function FavoritesSwitch({
  favorites: { on, enabled },
  toggle,
}: {
  favorites: YtLibraryPickerView["favorites"];
  toggle: () => void;
}) {
  const accent = useThemeColor("accent");
  const favoritesLabel = useLocalisation().strings.imports.alsoFavorites;
  const fill = useThemeColor("fill");
  const surface = useThemeColor("surface");
  return (
    <View
      className="flex-row items-center"
      style={{ minHeight: grid.row, paddingLeft: TEXT_INSET, paddingRight: grid.margin }}
    >
      <Text
        className={`flex-1 font-sans text-subheadline ${enabled ? "text-foreground" : "text-tertiary"}`}
      >
        {favoritesLabel}
      </Text>
      <Switch
        accessibilityLabel={favoritesLabel}
        value={on}
        disabled={!enabled}
        onValueChange={toggle}
        trackColor={{ false: fill, true: accent }}
        thumbColor={surface}
      />
    </View>
  );
}

/**
 * Why the library wasn't read (Core's `ytLibraryFailure`,
 * `spotifyLibraryFailure`), with Try Again or Sign In Again.
 */
function Failure({
  failure: { line, action },
  tryAgain,
  signIn: signInAgain,
}: {
  failure: YtLibraryFailureView;
  tryAgain: () => void;
  signIn: () => void;
}) {
  const { strings } = useLocalisation();
  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ padding: grid.margin, gap: CELL }}
    >
      <Text
        accessibilityLiveRegion="polite"
        className="text-center font-sans text-subheadline text-secondary"
      >
        {line}
      </Text>
      {action === "tryAgain" && <TextButton label={strings.imports.tryAgain} onPress={tryAgain} />}
      {action === "signIn" && (
        <TextButton label={strings.imports.signInAgain} onPress={signInAgain} />
      )}
    </View>
  );
}
