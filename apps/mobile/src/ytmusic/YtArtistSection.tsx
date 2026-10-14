import { ytTrackId, type QueueContext, type YtArtistSectionNote } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { playYtSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";

import { useYtArtistSection } from "./artistSection";
import { YtSongRow } from "./YtSongRow";

const NOTE: Readonly<Record<YtArtistSectionNote, string>> = {
  loading: "Looking on YouTube Music…",
  allInLibrary: "Your library already has this artist's top songs.",
  noSongs: "YouTube Music lists no top songs for this artist.",
  notFound: "Not found on YouTube Music.",
  offline: "You're offline. Try again when you're back online.",
  failed: "YouTube Music didn't answer. Try again in a moment.",
};

/** The section's head, as the artist page heads its other sections. */
const SECTION_HEAD = CELL * 6;

const ignore = (): void => undefined;

/**
 * The end of an artist page while YT Music is on (docs/spec.md, "YT Music"):
 * Show on YouTube Music, then the artist's top songs the Library doesn't have
 * (streamed on tap, with the YT Music song menu) or a quiet line. Nothing is
 * asked until the button is tapped; a saved answer shows for a week without it.
 */
export function YtArtistSection({
  name,
  context,
  selecting,
}: {
  /** The Library artist's name. */
  name: string;
  context: QueueContext;
  /** While the page's albums and songs are being selected, the section's songs do nothing. */
  selecting: boolean;
}) {
  const { view, show } = useYtArtistSection(name);
  const currentId = useCurrentTrackId();
  if (view === null) return null;
  const { songs, note, button } = view;
  return (
    <View>
      {(songs.length > 0 || note !== null) && (
        <View className="justify-end" style={{ height: SECTION_HEAD, paddingBottom: CELL }}>
          <CatalogLine>YT Music</CatalogLine>
        </View>
      )}
      {songs.map((song, index) => (
        <YtSongRow
          key={song.videoId}
          song={song}
          playing={ytTrackId(song.videoId) === currentId}
          onPress={selecting ? ignore : () => void playYtSongs(songs, index, context)}
          onLongPress={selecting ? ignore : undefined}
        />
      ))}
      {note !== null && (
        <View className="justify-center" style={{ minHeight: CELL * 6 }}>
          <Text className="font-sans text-footnote text-secondary">{NOTE[note]}</Text>
        </View>
      )}
      {button && (
        <View style={{ paddingTop: note === null ? CELL * 2 : 0 }}>
          <TextButton label="Show on YouTube Music" onPress={show} />
        </View>
      )}
    </View>
  );
}
