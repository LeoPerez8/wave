import {
  entryDivider,
  linkImportView,
  planLinkImport,
  playlistImportSources,
  recognisePlaylistLink,
  type LinkImportPlan,
  type LinkImportRead,
  type PlaylistImportSource,
  type PlaylistLink,
} from "@wave/core";
import * as Result from "effect/Result";
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { WaveNative } from "@/native/waveNative";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { pressedRect } from "@/motion/pressedRect";
import { showError, showMessage } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { followUp, openOverlay, presentOverlay } from "@/overlay/overlay";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { useThemeColor } from "@/theme/useThemeColor";
import { askYtMusic } from "@/ytmusic/askYtMusic";

import { importPlaylists, saveImportedPlaylist, type ImportedPlaylist } from "./importPlaylists";
import { LibraryStore } from "./LibraryStore";
import { openPlaylist } from "./routes";
import { appRuntime } from "./runtime";

// ---------------------------------------------------------------------------
// Import service

/** A linked playlist read, or why it wasn't. */
export type LinkRead = LinkImportRead<NativeYtSong>;

/**
 * Reads the playlist [link] names and plans its import against the Library
 * (Core's `planLinkImport`). Sends YouTube Music the playlist id and nothing
 * else. Never rejects: a failed read is `{ status: "failed" }`.
 */
export const readLinkImport = async (link: PlaylistLink): Promise<LinkRead> => {
  const answer = await askYtMusic((ytMusic) => ytMusic.playlist(link.playlistId));
  if (Result.isFailure(answer)) return { status: "failed", reason: answer.failure.reason };
  try {
    const library = await appRuntime.runPromise(LibraryStore.use((store) => store.listSongs));
    return {
      status: "read",
      playlist: answer.success,
      plan: planLinkImport(answer.success, library),
    };
  } catch {
    return { status: "failed", reason: "failed" };
  }
};

/**
 * Makes the planned playlist (Replace or Keep Both when its name is taken,
 * as the M3U import asks), then opens it.
 */
export const saveLinkImport = async (
  plan: LinkImportPlan<NativeYtSong>,
): Promise<ImportedPlaylist> => {
  const saved = await saveImportedPlaylist(plan.name, plan.songs);
  openPlaylist(saved.playlistId);
  return saved;
};

// ---------------------------------------------------------------------------
// Entry points

/**
 * Opens the import card for a playlist link: [text] as pasted or shared (a
 * link, a link among words, or a bare playlist id; Core's
 * `recognisePlaylistLink`). The card reads the playlist at once and offers
 * Import and Cancel. Text that names no playlist opens the link card with it
 * filled in and the reason under it. With YT Music off it says so and asks
 * YouTube nothing.
 */
export const openLinkImport = (text: string): void => {
  if (!ytMusicEnabled()) {
    void showMessage(
      "YT Music is off",
      "Turn on YT Music in Settings to import playlists from YouTube Music links.",
    );
    return;
  }
  const check = recognisePlaylistLink(text);
  if (check.ok) openImportCard(check.link);
  else void askForLink(text);
};

/**
 * Library › Playlists › Import: From a Link or From Files (Core's
 * `playlistImportSources`). With YT Music off it opens the file picker at once.
 */
export const openPlaylistImport = (): void => {
  const sources = playlistImportSources({ ytMusic: ytMusicEnabled() });
  if (sources.length === 1) {
    void importPlaylists();
    return;
  }
  openOverlay({
    label: "Import",
    anchor: pressedRect(),
    render: (close) => (
      <SourceMenu
        sources={sources}
        choose={(source) => {
          close();
          if (source === "files") void importPlaylists();
          else void followUp(fromClipboard).then(askForLink);
        }}
      />
    ),
  });
};

const SOURCE_LABELS: Record<PlaylistImportSource, string> = {
  link: "From a Link",
  files: "From Files",
};

function SourceMenu({
  sources,
  choose,
}: {
  sources: readonly PlaylistImportSource[];
  choose: (source: PlaylistImportSource) => void;
}) {
  const flow = useOverlayFlow();
  return (
    <>
      <Text
        accessibilityRole="header"
        className="font-sans text-body font-medium text-foreground"
        style={{ paddingBottom: CELL * 1.5 }}
      >
        Import
      </Text>
      <Hairline />
      <CardEntries>
        {sources.map((source, index) => (
          <EntryRow
            key={source}
            label={SOURCE_LABELS[source]}
            divider={entryDivider(index, sources.length, flow)}
            onPress={() => choose(source)}
          />
        ))}
      </CardEntries>
    </>
  );
}

/** The clipboard's text when it names a playlist, to offer in the link card; "" otherwise. */
const fromClipboard = async (): Promise<string> => {
  try {
    const text = (await WaveNative.readClipboardText()) ?? "";
    return recognisePlaylistLink(text).ok ? text.trim() : "";
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------------------
// Link card: paste a link

/** Asks for a link, [initial] filled in; on Continue, opens the import card for it. */
const askForLink = async (initial: string): Promise<void> => {
  const link = await presentOverlay<PlaylistLink | null>({
    label: "Import from a link",
    align: "top",
    dismissed: null,
    render: (finish) => <LinkCard initial={initial} finish={finish} />,
  });
  if (link !== null) openImportCard(link);
};

function LinkCard({
  initial,
  finish,
}: {
  initial: string;
  finish: (link: PlaylistLink | null) => void;
}) {
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const [value, setValue] = useState(initial);
  const check = recognisePlaylistLink(value);

  const confirm = () => {
    if (check.ok) finish(check.link);
  };

  return (
    <>
      <CatalogLine>Import from a link</CatalogLine>
      <TextInput
        value={value}
        onChangeText={setValue}
        autoFocus
        selectTextOnFocus
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={confirm}
        accessibilityLabel="Playlist link"
        placeholder="YouTube Music playlist link"
        placeholderTextColor={secondary}
        selectionColor={accent}
        cursorColor={accent}
        numberOfLines={1}
        className="font-sans text-body text-foreground"
        style={{ height: grid.row, padding: 0 }}
      />
      <Hairline />
      {/* The line is reserved so the actions don't jump when a reason appears. */}
      <Text
        accessibilityLiveRegion="polite"
        className="font-sans text-footnote text-secondary"
        style={{ minHeight: CELL * 3, paddingTop: CELL / 2 }}
      >
        {check.ok || check.problem === "empty" ? "" : check.reason}
      </Text>
      <View className="flex-row justify-end" style={{ gap: CELL * 3 }}>
        <TextButton label="Cancel" onPress={() => finish(null)} />
        <TextButton label="Continue" onPress={confirm} disabled={!check.ok} />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Import card: what the playlist is, Import or Cancel

const COVER = CELL * 9;

const READING: LinkRead = { status: "reading" };

const openImportCard = (link: PlaylistLink): void => {
  openOverlay({
    label: "Import playlist",
    render: (close) => <ImportCard link={link} close={close} />,
  });
};

/** Reads [link] as it opens (again on Try Again) and shows Core's `linkImportView` of it. */
function ImportCard({ link, close }: { link: PlaylistLink; close: () => void }) {
  const [attempt, setAttempt] = useState(0);
  // The answer to an earlier attempt isn't shown: Try Again reads as "reading" at once.
  const [answer, setAnswer] = useState<{ readonly attempt: number; readonly read: LinkRead }>();

  useEffect(() => {
    let current = true;
    void readLinkImport(link).then((read) => {
      if (current) setAnswer({ attempt, read });
    });
    return () => {
      current = false;
    };
  }, [link, attempt]);

  const read: LinkRead = answer?.attempt === attempt ? answer.read : READING;
  const view = linkImportView(read);
  const importIt = () => {
    if (read.status !== "read") return;
    close();
    void saveLinkImport(read.plan).catch((error: unknown) =>
      showError("Couldn't import the playlist", error),
    );
  };

  return (
    <>
      <View style={{ paddingTop: CELL, paddingBottom: CELL * 2, gap: CELL * 1.5 }}>
        <CatalogLine>Import from YouTube Music</CatalogLine>
        <View className="flex-row items-center" style={{ gap: CELL * 1.5 }}>
          {view.name !== null && (
            <Artwork uri={view.artworkUrl ?? undefined} size={COVER} radius={CELL / 2} />
          )}
          <View className="flex-1" style={{ gap: CELL / 2 }}>
            {view.name !== null && (
              <Text numberOfLines={2} className="font-sans text-title3 font-normal text-foreground">
                {view.name}
              </Text>
            )}
            <Text
              accessibilityLiveRegion="polite"
              className="font-sans text-subheadline text-secondary"
            >
              {view.line}
            </Text>
          </View>
        </View>
        {view.note !== null && (
          <Text className="font-sans text-footnote text-secondary">{view.note}</Text>
        )}
      </View>
      <View className="flex-row items-center justify-end" style={{ gap: CELL * 3 }}>
        <TextButton label="Cancel" onPress={close} />
        {view.retry && <TextButton label="Try Again" onPress={() => setAttempt((n) => n + 1)} />}
        {view.canImport && <TextButton label="Import" onPress={importIt} />}
      </View>
    </>
  );
}
