package expo.modules.wavenative.scan

import expo.modules.wavenative.artwork.ArtworkInfo

/** A scanned track as JS receives it (`NativeScannedTrack`): from scans, tag writes and downloads. */
internal fun trackToMap(track: ScannedTrack): Map<String, Any?> =
  mapOf(
    "path" to track.path,
    "sizeBytes" to track.sizeBytes.toDouble(),
    "modifiedAt" to track.modifiedAt.toDouble(),
  ) + track.tags.toMap() + mapOf(
    "artworkHash" to track.artworkHash,
    "hasLyrics" to track.hasLyrics,
  )

/** Stored artwork as JS receives it (`NativeArtwork`). */
internal fun artworkToMap(artwork: ArtworkInfo): Map<String, Any?> =
  mapOf(
    "hash" to artwork.hash,
    "path" to artwork.path,
    "thumbPath" to artwork.thumbPath,
    "palette" to artwork.palette.toMap(),
  )
