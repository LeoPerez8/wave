package expo.modules.wavenative.artwork

import java.io.File

/** What an artwork content URI asks [ArtworkProvider] for. */
sealed interface ArtworkRequest {
  /** One cover: the original image of artwork [hash]. */
  data class Cover(val hash: String) : ArtworkRequest

  /** A playlist's 2×2 mosaic of four covers (Core's `playlistMosaic`), in reading order. */
  data class Mosaic(val hashes: List<String>) : ArtworkRequest
}

/**
 * Content URIs for cached artwork, which Android Auto (and the media
 * notification) can read where app file paths can't be:
 * `content://<package>.artwork/<hash>` for a cover and
 * `content://<package>.artwork/mosaic/<h1>/<h2>/<h3>/<h4>` for a mosaic. A
 * hash is [ArtworkStore]'s 40 lowercase hex chars; anything else is rejected,
 * so the provider never serves a file outside the artwork folder.
 *
 * Plain strings and files only, so it runs in JVM tests.
 */
object ArtworkUris {
  private const val SCHEME = "content://"
  private const val MOSAIC = "mosaic"
  const val MOSAIC_TILES = 4

  private val HASH = Regex("^[0-9a-f]{40}$")

  /** The original's extensions, as [ArtworkStore.extensionOf] names them. */
  private val EXTENSIONS = listOf("jpg", "png", "webp", "gif", "bmp", "img")

  /** A cached file's name: the original (`<hash>.<ext>`) or its thumbnail (`<hash>_thumb.jpg`). */
  private val CACHED_FILE = Regex("^([0-9a-f]{40})(?:_thumb\\.jpg|\\.(?:${EXTENSIONS.joinToString("|")}))$")

  /** The provider's authority in the app [packageName] (declared as `${applicationId}.artwork`). */
  fun authority(packageName: String): String = "$packageName.artwork"

  fun isHash(text: String): Boolean = HASH.matches(text)

  /** The hash of a cached artwork file (original or thumbnail) at [path]; null for any other file. */
  fun hashOf(path: String): String? = CACHED_FILE.find(path.substringAfterLast('/'))?.groupValues?.get(1)

  /** The URI showing [hashes]: a mosaic of four, else the first cover; null without any. */
  fun uri(authority: String, hashes: List<String>): String? =
    when {
      hashes.isEmpty() -> null
      hashes.size >= MOSAIC_TILES ->
        "$SCHEME$authority/$MOSAIC/${hashes.take(MOSAIC_TILES).joinToString("/")}"
      else -> "$SCHEME$authority/${hashes.first()}"
    }

  /** The URI showing cached artwork [files] (Core's `AutoArtwork`); files that aren't cached artwork are skipped. */
  fun forFiles(authority: String, files: List<String>): String? = uri(authority, files.mapNotNull(::hashOf))

  /** What [uri] asks for, or null when it isn't a well-formed artwork URI of [authority]. */
  fun parse(authority: String, uri: String): ArtworkRequest? {
    val prefix = "$SCHEME$authority/"
    if (!uri.startsWith(prefix)) return null
    val segments = uri.substring(prefix.length).split('/')
    if (!segments.all(::isSegment)) return null
    return when {
      segments.size == 1 && isHash(segments[0]) -> ArtworkRequest.Cover(segments[0])
      segments.size == MOSAIC_TILES + 1 && segments[0] == MOSAIC && segments.drop(1).all(::isHash) ->
        ArtworkRequest.Mosaic(segments.drop(1))
      else -> null
    }
  }

  private fun isSegment(segment: String): Boolean = segment == MOSAIC || isHash(segment)

  /** The original image of cover [hash] in [directory], whatever its format; null when it isn't there. */
  fun coverFile(directory: File, hash: String): File? {
    if (!isHash(hash)) return null
    return EXTENSIONS.map { File(directory, "$hash.$it") }.firstOrNull { it.isFile }
  }

  /** The thumbnails a mosaic of [hashes] is drawn from, in reading order. */
  fun mosaicTiles(directory: File, hashes: List<String>): List<File> =
    hashes.map { File(directory, "${it}_thumb.jpg") }
}
