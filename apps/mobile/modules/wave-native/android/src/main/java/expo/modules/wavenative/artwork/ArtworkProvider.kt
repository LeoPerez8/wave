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

/**
 * Serves cached artwork read-only to Android Auto, the media notification and
 * System UI, which can't read Wave's files: covers straight from the artwork
 * folder, and playlist mosaics drawn once from four thumbnails into the cache.
 * Which URIs exist is [ArtworkUris]'s call; anything else is "not found".
 *
 * Exported without a permission (as Google's UAMP sample does) because Auto
 * reads it from its own process. It only reveals cover images.
 */
class ArtworkProvider : ContentProvider() {
  override fun onCreate(): Boolean {
    // Providers start with the process, before anything builds a player item.
    authority = ArtworkUris.authority(context!!.packageName)
    return true
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw SecurityException("Artwork is read-only")
    val context = context ?: throw FileNotFoundException(uri.toString())
    val directory = File(context.filesDir, ARTWORK_DIR)
    val file = when (val request = ArtworkUris.parse(authority ?: "", uri.toString())) {
      is ArtworkRequest.Cover -> ArtworkUris.coverFile(directory, request.hash)
      is ArtworkRequest.Mosaic -> mosaic(directory, File(context.cacheDir, MOSAIC_DIR), request.hashes)
      null -> null
    } ?: throw FileNotFoundException(uri.toString())
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun getType(uri: Uri): String? =
    when (ArtworkUris.parse(authority ?: "", uri.toString())) {
      null -> null
      // Covers keep their original format; image decoders sniff it anyway.
      is ArtworkRequest.Cover -> "image/*"
      is ArtworkRequest.Mosaic -> "image/jpeg"
    }

  /** The mosaic of [hashes] as a JPEG, drawn on first use; null when a tile can't be read. */
  private fun mosaic(directory: File, cache: File, hashes: List<String>): File? {
    val target = File(cache, "${hashes.joinToString("_")}.jpg")
    if (target.isFile) return target
    val tiles = ArtworkUris.mosaicTiles(directory, hashes).map { BitmapFactory.decodeFile(it.path) ?: return null }
    return try {
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

    /** This app's artwork authority, once the provider has started (always, before any player item). */
    @Volatile
    var authority: String? = null
      private set

    /** The content URI showing cached artwork [files] (a cover, or four for a mosaic); null without any. */
    fun uriFor(files: List<String>): Uri? {
      val authority = authority ?: return null
      return ArtworkUris.forFiles(authority, files)?.let(Uri::parse)
    }
  }
}
