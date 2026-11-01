package expo.modules.wavenative.artwork

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Rect
import android.net.Uri
import android.os.ParcelFileDescriptor
import expo.modules.wavenative.log.WaveLog
import java.io.File
import java.io.FileNotFoundException
import kotlin.concurrent.thread

/**
 * Serves cached artwork read-only to Android Auto, the media notification and
 * System UI, which can't read Wave's files: covers straight from the artwork
 * folder, online covers loaded when first asked for (Auto takes no web
 * address), and playlist mosaics drawn once from four tiles, all into the
 * cache. Which URIs exist is [ArtworkUris]'s call; anything else is "not found".
 *
 * Exported without a permission (as Google's UAMP sample does) because Auto
 * reads it from its own process. It only reveals cover images.
 */
class ArtworkProvider : ContentProvider() {
  override fun onCreate(): Boolean {
    // Providers start with the process, before anything builds a player item.
    val appContext = context!!
    authority = ArtworkUris.authority(appContext.packageName)
    // Retire the old lyrics-image cache once at startup; no file IO on the main thread.
    thread(name = "WaveArtworkCleanup", isDaemon = true) {
      runCatching { File(appContext.cacheDir, "artwork-lyrics").deleteRecursively() }
        .onFailure { WaveLog.w("WaveArtwork", "Couldn't delete the old lyrics images", it) }
    }
    return true
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw SecurityException("Artwork is read-only")
    val context = context ?: throw FileNotFoundException(uri.toString())
    val directory = File(context.filesDir, ARTWORK_DIR)
    val file = when (val request = ArtworkUris.parse(authority ?: "", uri.toString())) {
      is ArtworkRequest.Cover -> ArtworkUris.coverFile(directory, request.hash)
      is ArtworkRequest.Medium -> ArtworkUris.mediumFile(directory, request.hash)
      is ArtworkRequest.Thumbnail -> ArtworkUris.thumbnailFile(directory, request.hash)
      is ArtworkRequest.Online -> onlineCover(File(context.cacheDir, ONLINE_DIR), request.addresses)
      is ArtworkRequest.Mosaic -> mosaic(directory, context.cacheDir, request.tiles)
      null -> null
    } ?: throw FileNotFoundException(uri.toString())
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun getType(uri: Uri): String? =
    when (ArtworkUris.parse(authority ?: "", uri.toString())) {
      null -> null
      // Covers keep their original format; image decoders sniff it anyway.
      is ArtworkRequest.Cover, is ArtworkRequest.Medium, is ArtworkRequest.Thumbnail, is ArtworkRequest.Online -> "image/*"
      is ArtworkRequest.Mosaic -> "image/jpeg"
    }

  /**
   * The first of [addresses] that has an image, from [cache] or downloaded
   * into it; null when none has. Openers call on a binder thread and wait, so
   * this may block. A sharper address is tried again each time, so the stored
   * one only stands in while it can't load.
   */
  private fun onlineCover(cache: File, addresses: List<String>): File? =
    addresses.firstNotNullOfOrNull { address ->
      val target = File(cache, "${ArtworkStore.hash(address.toByteArray(Charsets.UTF_8))}${ArtworkUris.ONLINE_FILE}")
      if (target.isFile) return@firstNotNullOfOrNull target
      runCatching {
        val image = ArtistPhotoStore.httpGet(address)
        if (ArtworkStore.extensionOf(image) == "img") return@runCatching null
        cache.mkdirs()
        ArtworkStore.writeAtomically(target, image)
        ArtworkUris.trimOnlineCovers(cache, target, ONLINE_CACHE_BYTES)
        target
      }.getOrNull()
    }

  /**
   * The mosaic of [tiles] as a JPEG, drawn on first use. With a tile that
   * can't be read, such as an online one offline, the first that can stands
   * in and nothing is kept, so the mosaic is drawn once they all load.
   */
  private fun mosaic(directory: File, cache: File, tiles: List<ArtworkTile>): File? {
    val mosaics = File(cache, MOSAIC_DIR)
    val target = File(mosaics, "${ArtworkStore.hash(tiles.toString().toByteArray(Charsets.UTF_8))}.jpg")
    if (target.isFile) return target
    val files = tiles.map { tile ->
      when (tile) {
        is ArtworkTile.Cached -> ArtworkUris.mosaicTile(directory, tile.hash)
        is ArtworkTile.Online -> onlineCover(File(cache, ONLINE_DIR), tile.addresses)
      }
    }
    val decoded = files.map { file -> file?.let { BitmapFactory.decodeFile(it.path) } }
    if (null in decoded) return files.getOrNull(decoded.indexOfFirst { it != null })
    return draw(decoded.filterNotNull(), mosaics, target)
  }

  private fun draw(tiles: List<Bitmap>, cache: File, target: File): File? =
    try {
      val half = tiles.maxOf { minOf(it.width, it.height) }
      val bitmap = Bitmap.createBitmap(half * 2, half * 2, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      tiles.forEachIndexed { index, tile ->
        val left = (index % 2) * half
        val top = (index / 2) * half
        canvas.drawBitmap(tile, centreSquare(tile), Rect(left, top, left + half, top + half), null)
      }
      cache.mkdirs()
      val temp = File(cache, ".${target.name}.tmp")
      temp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
      if (temp.renameTo(target)) target else null.also { temp.delete() }
    } catch (e: Exception) {
      WaveLog.w("WaveArtwork", "Couldn't draw a mosaic", e)
      null
    }

  /** The largest centred square of [bitmap], so non-square covers aren't stretched. */
  private fun centreSquare(bitmap: Bitmap): Rect {
    val side = minOf(bitmap.width, bitmap.height)
    val left = (bitmap.width - side) / 2
    val top = (bitmap.height - side) / 2
    return Rect(left, top, left + side, top + side)
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  companion object {
    /** Where [ArtworkStore] keeps artwork, under `filesDir` (see `WaveNativeModule`). */
    const val ARTWORK_DIR = "artwork"
    private const val MOSAIC_DIR = "artwork-mosaic"
    private const val ONLINE_DIR = "artwork-online"

    /** How much the online covers may take; the oldest go past it. */
    private const val ONLINE_CACHE_BYTES = 50L * 1024 * 1024

    /** This app's artwork authority, once the provider has started (always, before any player item). */
    @Volatile
    var authority: String? = null
      private set

    /** The content URI showing cached artwork [files] (a cover, or four for a mosaic); null without any. */
    fun uriFor(files: List<String>): Uri? {
      val authority = authority ?: return null
      return ArtworkUris.forFiles(authority, files)?.let(Uri::parse)
    }

    /** The content URI showing [covers] (Core's `AutoArtwork`); null without any. */
    fun uriForCovers(covers: List<List<String>>): Uri? {
      val authority = authority ?: return null
      return ArtworkUris.forCovers(authority, covers)?.let(Uri::parse)
    }
  }
}
