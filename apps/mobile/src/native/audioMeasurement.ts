/**
 * What the native meter (`WaveNative.measureAudioLoudness`) says of a file:
 * its integrated loudness (ITU-R BS.1770, LUFS) and sample peak (0–1 full
 * scale); that it couldn't decode it (`unmeasurable`, as the player couldn't
 * play it either); that it couldn't open it now (`unreadable`: gone, or on
 * storage that isn't mounted); or that Normalize Volume turning off stopped it.
 */
export type AudioMeasurement =
  | { readonly kind: "measured"; readonly loudness: number; readonly peak: number }
  | { readonly kind: "unmeasurable" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "cancelled" };

/**
 * What the charging job measured of a Library file (`WaveNative.libraryMeasurements`),
 * kept natively until the app takes it in: the file as the Library store
 * handed it over (`setLibraryToMeasure`), and what measuring it gave. [seq] is
 * its place in the job's results, which `forgetLibraryMeasurements` forgets through.
 */
export type LibraryMeasurement = {
  readonly seq: number;
  readonly id: number;
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: number;
} & Exclude<AudioMeasurement, { readonly kind: "cancelled" }>;
