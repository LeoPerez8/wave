package expo.modules.wavenative.tags

import java.io.File

/**
 * Tags as read from one audio file, before any interpretation. Values are passed
 * to JS as-is; Core's library model applies fallbacks and parses numbers.
 */
data class RawTags(
  val title: String? = null,
  val artist: String? = null,
  val album: String? = null,
  val albumArtist: String? = null,
  val genre: String? = null,
  /** Year or date as tagged, e.g. `2024` or `2024-05-01`. */
  val year: String? = null,
  /** Track number as tagged, e.g. `3` or `3/12`. */
  val trackNumber: String? = null,
  /** Disc number as tagged, e.g. `1` or `1/2`. */
  val discNumber: String? = null,
  val compilation: Boolean = false,
  val durationMs: Long = 0,
  val sampleRate: Int? = null,
  val bitrateKbps: Int? = null,
  /** Embedded front cover (or the first picture), undecoded. */
  // Compared field by field in tests; ByteArray equality is by identity, which is fine here.
  val artwork: ByteArray? = null,
  /** Embedded lyrics as tagged: plain text, or LRC for synced lyrics (Core tells them apart). */
  val lyrics: String? = null,
  /**
   * Every value of a multi-value artist tag (Vorbis comments, ID3v2.4), where [artist]
   * holds the first: each is a credit of its own (Core's `normalizeTrack`).
   */
  val artists: List<String> = listOfNotNull(artist),
  /** Every value of a multi-value album artist tag, as [artists]. */
  val albumArtists: List<String> = listOfNotNull(albumArtist),
  /** The advisory tag as tagged ([Advisory]): Core's `explicitFromAdvisory` reads it. */
  val advisory: String? = null,
)

/** Reads tags from an audio file. Implementations throw when the file can't be parsed. */
fun interface TagReader {
  fun read(file: File): RawTags
}

internal fun String?.cleanTag(): String? = this?.replace("\u0000", "")?.trim()?.takeIf { it.isNotEmpty() }

/** Combines a number and a separate total into the `n/total` form Core parses. */
internal fun numberOf(number: String?, total: String?): String? {
  val n = number.cleanTag() ?: return null
  val t = total.cleanTag()
  return if (n.contains('/') || t == null) n else "$n/$t"
}

internal fun isTruthyFlag(value: String?): Boolean =
  when (value.cleanTag()?.lowercase()) {
    "1", "true", "yes" -> true
    else -> false
  }
