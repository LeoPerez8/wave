import type { AudioMeasurement } from "@wave/client/songMeasurements";

/** What the native meter (`WaveNative.measureAudioLoudness`) says of a file. */
export type { AudioMeasurement };

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
