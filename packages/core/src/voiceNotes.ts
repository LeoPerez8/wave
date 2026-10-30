/**
 * Voice notes and recordings (docs/spec.md, "First run and library"): audio
 * files on the phone that aren't music, which the scan leaves out of the
 * Library while Settings › Library's Skip voice notes and recordings is on.
 */

import { UNKNOWN_ARTIST } from "./library.ts";

/** What a scan knows of an audio file when it decides whether it's music. */
export interface AudioFileFacts {
  readonly path: string;
  /** 0 when the length couldn't be read. */
  readonly durationMs: number;
  /** The artist credit; null, empty or "Unknown Artist" when the file has no artist tag. */
  readonly artist: string | null;
}

/**
 * Folders WhatsApp or Android keep voice notes, recordings or calls in, as
 * their names read with only their letters, lower-cased.
 */
const RECORDING_FOLDERS = new Set([
  "whatsappvoicenotes",
  "whatsappaudio",
  "whatsappbusinessvoicenotes",
  "whatsappbusinessaudio",
  "recordings",
  "call",
  "callrec",
  "callrecordings",
]);

const folderKey = (name: string): string => name.toLowerCase().replace(/[^\p{L}]/gu, "");

/** Whether the file at [path] is in a recordings folder, at any depth. */
const inRecordingFolder = (path: string): boolean => {
  const folders = path.split("/").slice(0, -1);
  return folders.some((folder) => RECORDING_FOLDERS.has(folderKey(folder)));
};

/**
 * The names WhatsApp gives voice notes and audio (`PTT-20260412-WA0017`,
 * `AUD-20260412-WA0003`) and voice recorders give recordings (`Recording_…`,
 * `Recording 12`, `Voice 001`, `Rec_20260412_…`, `Call recording …`), from the
 * start of the file name. Each needs its number, so a song whose title starts
 * with the same word stays music.
 */
const RECORDING_NAMES = [
  /^(aud|ptt)-\d{8}-wa\d+/i,
  /^recording[ _-]?\d/i,
  /^voice[ _-]?\d/i,
  /^rec[ _-]?\d{6}/i,
  /^call[ _-]?recording/i,
];

/** Whether the file at [path] is named the way recordings are. */
const namedAsRecording = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return RECORDING_NAMES.some((shape) => shape.test(name));
};

/** Shorter than this with no artist tag, a file is a voice note or a recording. */
const SHORTEST_UNTAGGED_MS = 30_000;

/** Artist credits that stand for no artist tag: Wave's own and Android's. */
const NO_ARTIST = new Set(["", UNKNOWN_ARTIST.toLowerCase(), "<unknown>"]);

const hasArtist = (artist: string | null): boolean =>
  artist !== null && !NO_ARTIST.has(artist.trim().toLowerCase());

/** Whether [file] is short with no artist tag; one whose length couldn't be read isn't. */
const shortUntagged = (file: AudioFileFacts): boolean =>
  file.durationMs > 0 && file.durationMs < SHORTEST_UNTAGGED_MS && !hasArtist(file.artist);

/**
 * Whether [file] is a voice note or a recording rather than music: it's in a
 * folder WhatsApp or Android keeps them in, its name has the shape they give
 * them, or it's shorter than 30 seconds with no artist tag.
 */
export const isVoiceNoteOrRecording = (file: AudioFileFacts): boolean =>
  inRecordingFolder(file.path) || namedAsRecording(file.path) || shortUntagged(file);
