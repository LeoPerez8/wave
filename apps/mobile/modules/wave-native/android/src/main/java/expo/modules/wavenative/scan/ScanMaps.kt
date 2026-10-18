package expo.modules.wavenative.scan

import expo.modules.wavenative.artwork.ArtworkInfo

/** A scanned track as JS receives it (`NativeScannedTrack`): from scans, tag writes and downloads. */
internal fun trackToMap(track: ScannedTrack): Map<String, Any?> =
  mapOf(
    "path" to track.path,
    "sizeBytes" to track.sizeBytes.toDouble(),
    "modifiedAt" to track.modifiedAt.toDouble(),
    "title" to track.tags.title,
    "artist" to track.tags.artist,
    "artists" to track.tags.artists,
    "album" to track.tags.album,
    "albumArtist" to track.tags.albumArtist,
    "albumArtists" to track.tags.albumArtists,
    "genre" to track.tags.genre,
    "genres" to track.tags.genres,
    "year" to track.tags.year,
    "trackNumber" to track.tags.trackNumber,
    "discNumber" to track.tags.discNumber,
    "compilation" to track.tags.compilation,
    "durationMs" to track.tags.durationMs.toDouble(),
    "sampleRate" to track.tags.sampleRate,
    "bitrateKbps" to track.tags.bitrateKbps,
    "artworkHash" to track.artworkHash,
    "hasLyrics" to track.hasLyrics,
    "advisory" to track.tags.advisory,
  )

/** Stored artwork as JS receives it (`NativeArtwork`). */
internal fun artworkToMap(artwork: ArtworkInfo): Map<String, Any?> =
  mapOf(
    "hash" to artwork.hash,
    "path" to artwork.path,
    "thumbPath" to artwork.thumbPath,
    "palette" to artwork.palette.toMap(),
  )
