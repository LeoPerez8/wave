// The seed's audio files: tiny MP3s that tag readers take for whole songs (`seed.ts`).
//
// Each is an ID3v2.3 tag and a few silent MPEG-1 Layer III frames. The first
// frame holds a Xing header claiming the song's frame count, which is where
// the tag reader takes the length from, so a 4-minute song is about 1 KB.

/** The tags a seed file holds and the frames its audio claims. */
export interface SeedFileTags {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly genre: string;
  readonly year: number;
  readonly trackNumber: number;
  readonly frames: number;
}

const FRAME_SAMPLES = 1_152;
const SAMPLE_RATE = 44_100;
/** MPEG-1 Layer III, 32 kbps, 44.1 kHz, no padding, mono, no CRC: 104 bytes a frame. */
const FRAME_HEADER = [0xff, 0xfb, 0x10, 0xc0] as const;
const FRAME_BYTES = Math.floor((144 * 32_000) / SAMPLE_RATE);
/** The header and a mono frame's side information come before the Xing header. */
const XING_AT = 4 + 17;
const SILENT_FRAMES = 8;

/** How long [frames] frames play, as the tag reader works it out (and the seed's database says). */
export const mp3DurationMs = (frames: number): number =>
  Math.round(((frames * FRAME_SAMPLES) / SAMPLE_RATE) * 1000);

const latin1 = (text: string): number[] => {
  const bytes = [...text].map((char) => char.charCodeAt(0));
  if (bytes.some((byte) => byte > 0xff)) throw new Error(`Not ISO-8859-1: ${text}`);
  return bytes;
};

const textFrame = (id: string, text: string): number[] => {
  const body = [0, ...latin1(text)];
  const size = body.length;
  return [
    ...latin1(id),
    size >>> 24,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    0,
    0,
    ...body,
  ];
};

const id3 = (tags: SeedFileTags): number[] => {
  const frames = [
    textFrame("TIT2", tags.title),
    textFrame("TPE1", tags.artist),
    textFrame("TPE2", tags.artist),
    textFrame("TALB", tags.album),
    textFrame("TCON", tags.genre),
    textFrame("TYER", String(tags.year)),
    textFrame("TRCK", String(tags.trackNumber)),
  ].flat();
  const size = frames.length;
  // The tag's size is syncsafe: 7 bits a byte.
  const syncsafe = [(size >>> 21) & 0x7f, (size >>> 14) & 0x7f, (size >>> 7) & 0x7f, size & 0x7f];
  return [...latin1("ID3"), 3, 0, 0, ...syncsafe, ...frames];
};

/** The bytes of an MP3 holding [tags], [tags.frames] frames long. */
export const mp3File = (tags: SeedFileTags): Uint8Array => {
  const tag = id3(tags);
  const audioFrames = 1 + SILENT_FRAMES;
  const bytes = new Uint8Array(tag.length + audioFrames * FRAME_BYTES);
  bytes.set(tag, 0);
  for (let frame = 0; frame < audioFrames; frame += 1)
    bytes.set(FRAME_HEADER, tag.length + frame * FRAME_BYTES);
  const xing = tag.length + XING_AT;
  bytes.set(latin1("Xing"), xing);
  const view = new DataView(bytes.buffer, xing + 4, 12);
  view.setUint32(0, 0x3); // the frames and bytes fields follow
  view.setUint32(4, tags.frames);
  view.setUint32(8, audioFrames * FRAME_BYTES);
  return bytes;
};
