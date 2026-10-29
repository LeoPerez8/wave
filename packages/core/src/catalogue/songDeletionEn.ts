import { formatNumber } from "../formatting.ts";

const n = (count: number): string => formatNumber("en", count);

/** Deleting songs and removing missing ones (`confirmSongDeletion`, `confirmSongRemoval`, `songDeletionFailure`). */
export const songDeletionEn = {
  deleteSongs: (count: number): string => `Delete ${n(count)} songs?`,
  deleteSong: (title: string): string => `Delete “${title}”?`,
  /** What leaves: the file(s), and with a Wave account the song(s) there too. */
  deleteMessage: {
    one: "The file is removed from your phone.",
    several: "The files are removed from your phone.",
    oneSignedIn: "The file is removed from your phone, and the song from your Wave account.",
    severalSignedIn: "The files are removed from your phone, and the songs from your Wave account.",
  },
  delete: "Delete",
  removeSongs: (count: number): string => `Remove ${n(count)} songs from your Library?`,
  removeSong: (title: string): string => `Remove “${title}” from your Library?`,
  removeMessage: {
    one: "It leaves your Wave account too. Your other phones lose it at their next sync, unless they have its file.",
    several:
      "They leave your Wave account too. Your other phones lose them at their next sync, unless they have their files.",
  },
  remove: "Remove",
  /** Why a file couldn't be deleted, by `SongDeleteFailureReason`. */
  reasons: {
    missing: "The file is already gone.",
    denied: "Wave isn't allowed to delete it.",
    readOnly: "Its storage is read-only.",
    failed: "The file couldn't be deleted.",
  },
  couldntDeleteSong: (title: string): string => `Couldn't delete “${title}”`,
  songStays: "The song stays in your library.",
  couldntDeleteSongs: (failed: number, attempted: number): string =>
    `Couldn't delete ${n(failed)} of ${n(attempted)} songs`,
  oneStays: "It stays in your library.",
  severalStay: "They stay in your library.",
  more: (count: number): string => `And ${n(count)} more.`,
  couldntRemoveSongs: "Couldn't remove the songs",
  couldntUpdateLibrary: "Couldn't update the library",
};
