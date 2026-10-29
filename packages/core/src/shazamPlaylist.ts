import { playlistSongKey, type PlaylistSong } from "./playlistEntries.ts";
import { joinArtists, recordingMatches } from "./ytMusic.ts";
import { checkPlaylistName } from "./playlists.ts";

/** Playlist ids here are sync ids, shared by every phone. */
interface ShazamPlaylist {
  readonly id: string;
  readonly name: string;
}

type ShazamAddPlan =
  | {
      readonly kind: "create";
      readonly name: string;
      readonly song: PlaylistSong;
      readonly index: 0;
      readonly toast: string;
    }
  | {
      readonly kind: "add";
      readonly playlistId: string;
      readonly song: PlaylistSong;
      readonly index: 0;
      readonly toast: string;
    }
  | { readonly kind: "duplicate"; readonly playlistId: string; readonly toast: string };

/** Plans an explicit save; [existing] holds the remembered playlist's songs. */
export const planShazamAdd = (
  rememberedId: string | null,
  playlists: readonly ShazamPlaylist[],
  existing: readonly PlaylistSong[],
  song: PlaylistSong,
): ShazamAddPlan => {
  const playlist = playlists.find((candidate) => candidate.id === rememberedId);
  if (playlist !== undefined) {
    if (
      existing.some((held) => {
        if (playlistSongKey(held) === playlistSongKey(song)) return true;
        if (held.source === "library" || song.source === "library") return false;
        if (held.source === "stream" && song.source === "stream") return false;
        return recordingMatches(
          { title: held.song.title, artist: joinArtists(held.song.artists), durationMs: 0 },
          { ...song.song, durationMs: null },
        );
      })
    )
      return { kind: "duplicate", playlistId: playlist.id, toast: "Already in Shazam" };
    return { kind: "add", playlistId: playlist.id, song, index: 0, toast: "Added to Shazam" };
  }
  const names = playlists.map((candidate) => candidate.name);
  let name = "Shazam";
  for (let n = 2; !checkPlaylistName(name, names).ok; n++) name = `Shazam ${n}`;
  return { kind: "create", name, song, index: 0, toast: "Added to Shazam" };
};
