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
