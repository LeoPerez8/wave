package expo.modules.wavenative.artwork

import java.io.File
import java.util.Base64

/** What an artwork content URI asks [ArtworkProvider] for. */
sealed interface ArtworkRequest {
  /** One online cover, from the first of its [addresses] that loads. */
  data class Online(val addresses: List<String>) : ArtworkRequest

  /** One cover: the original image of artwork [hash]. */
  data class Cover(val hash: String) : ArtworkRequest

  /** A row-sized cover, falling back to medium and original. */
  data class Thumbnail(val hash: String) : ArtworkRequest

  /** A tile-sized embedded cover, falling back to the original while migration is pending. */
  data class Medium(val hash: String) : ArtworkRequest

  /** A playlist's 2×2 mosaic of four covers (Core's `playlistMosaic`), in reading order. */
  data class Mosaic(val tiles: List<ArtworkTile>) : ArtworkRequest
}

/** A mosaic's tile: a cached cover, or an online one. */
sealed interface ArtworkTile {
  data class Cached(val hash: String) : ArtworkTile

  data class Online(val addresses: List<String>) : ArtworkTile
}

/**
 * Content URIs for cached artwork, which Android Auto (and the media
 * notification) can read where app file paths can't be:
 * `content://<package>.artwork/<hash>` for an original,
 * `content://<package>.artwork/medium/<hash>` and `/thumbnail/<hash>` for sized covers, and
 * `content://<package>.artwork/mosaic/<h1>/<h2>/<h3>/<h4>` for a mosaic. A
 * hash is [ArtworkStore]'s 40 lowercase hex chars; anything else is rejected,
 * so the provider never serves a file outside its folders. In place of a
 * hash, `o.<base64url>` is an online cover's addresses: Auto only takes
 * content URIs, so the provider loads them. Only image hosts Wave's covers
 * come from are accepted, so the exported provider fetches nothing else.
 *
 * Plain strings and files only, so it runs in JVM tests.
 */
object ArtworkUris {
  private const val SCHEME = "content://"
  private const val MOSAIC = "mosaic"
  private const val ONLINE = "o."
  const val MOSAIC_TILES = 4

  /**
   * The artwork folder's subfolder of playlists' own images
   * (`PlaylistImageStore`), named as covers are, so a playlist's image is
   * served as a cover.
   */
  const val PLAYLIST_IMAGES = "playlists"

  private val HASH = Regex("^[0-9a-f]{40}$")

  /** The image servers of YT Music and Spotify, the covers `yt_song` stores. */
  private val ONLINE_COVER =
    Regex("^https://[\\w.-]+\\.(?:googleusercontent\\.com|ggpht\\.com|ytimg\\.com|scdn\\.co|spotifycdn\\.com)/\\S*$")

  /** The original's extensions, as [ArtworkStore.extensionOf] names them. */
  private val EXTENSIONS = listOf("jpg", "png", "webp", "gif", "bmp", "img")

  /** A cached file's name: the original (`<hash>.<ext>`) or its thumbnail (`<hash>_thumb.jpg`). */
  private val CACHED_FILE = Regex("^([0-9a-f]{40})(?:_thumb\\.jpg|\\.(?:${EXTENSIONS.joinToString("|")}))$")

  /** The provider's authority in the app [packageName] (declared as `${applicationId}.artwork`). */
  fun authority(packageName: String): String = "$packageName.artwork"

  fun isHash(text: String): Boolean = HASH.matches(text)

  /** The hash of a cached artwork file (original or thumbnail) at [path]; null for any other file. */
  fun hashOf(path: String): String? = CACHED_FILE.find(path.substringAfterLast('/'))?.groupValues?.get(1)

  /** The URI showing [tiles] (hashes or online segments): a mosaic of four, else the first cover; null without any. */
  fun uri(authority: String, tiles: List<String>): String? =
    when {
      tiles.isEmpty() -> null
      tiles.size >= MOSAIC_TILES ->
        "$SCHEME$authority/$MOSAIC/${tiles.take(MOSAIC_TILES).joinToString("/")}"
      else -> "$SCHEME$authority/${tiles.first()}"
    }

  /** The URI showing cached artwork [files] (Core's `AutoArtwork`); files that aren't cached artwork are skipped. */
  fun forFiles(authority: String, files: List<String>): String? = uri(authority, files.mapNotNull(::hashOf))

  /**
   * The URI showing [covers] (Core's `AutoArtwork`), each a cached file or an
   * online cover's addresses, best first; covers that are neither are skipped.
   */
  fun forCovers(authority: String, covers: List<List<String>>): String? =
    uri(authority, covers.mapNotNull { cover -> cover.singleOrNull()?.let(::hashOf) ?: onlineSegment(cover) })

  /** [addresses] as a URI segment, without those of other hosts; null when none is left. */
  private fun onlineSegment(addresses: List<String>): String? {
    val allowed = addresses.filter(ONLINE_COVER::matches)
    if (allowed.isEmpty()) return null
    val text = allowed.joinToString("\n").toByteArray(Charsets.UTF_8)
    return ONLINE + Base64.getUrlEncoder().withoutPadding().encodeToString(text)
  }

  private fun tile(segment: String): ArtworkTile? =
    when {
      isHash(segment) -> ArtworkTile.Cached(segment)
      segment.startsWith(ONLINE) -> onlineAddresses(segment.removePrefix(ONLINE))?.let(ArtworkTile::Online)
      else -> null
    }

  /** The addresses [encoded] holds; null when it isn't one of [onlineSegment]'s, so a forged URI fetches nothing. */
  private fun onlineAddresses(encoded: String): List<String>? {
    val text = runCatching { String(Base64.getUrlDecoder().decode(encoded), Charsets.UTF_8) }.getOrNull()
    return text?.split('\n')?.takeIf { addresses -> addresses.all(ONLINE_COVER::matches) }
  }

  /** What [uri] asks for, or null when it isn't a well-formed artwork URI of [authority]. */
  fun parse(authority: String, uri: String): ArtworkRequest? {
    val prefix = "$SCHEME$authority/"
    if (!uri.startsWith(prefix)) return null
    val segments = uri.substring(prefix.length).split('/')
    return when {
      segments.size == 2 && segments[0] == "thumbnail" && isHash(segments[1]) -> ArtworkRequest.Thumbnail(segments[1])
      segments.size == 2 && segments[0] == "medium" && isHash(segments[1]) -> ArtworkRequest.Medium(segments[1])
      segments.size == 1 ->
        when (val cover = tile(segments[0])) {
          is ArtworkTile.Cached -> ArtworkRequest.Cover(cover.hash)
          is ArtworkTile.Online -> ArtworkRequest.Online(cover.addresses)
          null -> null
        }
      segments.size == MOSAIC_TILES + 1 && segments[0] == MOSAIC ->
        segments.drop(1).map(::tile).takeIf { null !in it }?.let { ArtworkRequest.Mosaic(it.filterNotNull()) }
      else -> null
    }
  }

  /**
   * The original image of cover [hash] in [directory], whatever its format, or
   * the playlist image [hash] in its [PLAYLIST_IMAGES] folder; null when it isn't there.
   */
  fun coverFile(directory: File, hash: String): File? {
    if (!isHash(hash)) return null
    return (EXTENSIONS.map { File(directory, "$hash.$it") } + File(File(directory, PLAYLIST_IMAGES), "$hash.jpg"))
      .firstOrNull { it.isFile }
  }

  /** Thumbnail, medium, original. A missing size never causes the cover to disappear. */
  fun thumbnailFile(directory: File, hash: String): File? {
    if (!isHash(hash)) return null
    return File(directory, "${hash}_thumb.jpg").takeIf { it.isFile } ?: mediumFile(directory, hash)
  }

  /** Medium, then original. Never serves a partial file or a path outside the artwork folder. */
  fun mediumFile(directory: File, hash: String): File? {
    if (!isHash(hash)) return null
    return File(directory, "${hash}_medium.jpg").takeIf { it.isFile } ?: coverFile(directory, hash)
  }

  /** The thumbnail a mosaic draws cached cover [hash] from. */
  fun mosaicTile(directory: File, hash: String): File = File(directory, "${hash}_thumb.jpg")
}
