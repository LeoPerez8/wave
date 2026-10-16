package expo.modules.wavenative.playlists

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import java.io.ByteArrayOutputStream

/** Makes a picked photo into a playlist image's two square JPEGs ([PlaylistImageStore] saves them). */
object AndroidPlaylistImages {
  private const val QUALITY = 90

  /**
   * Decodes the photo at [uri] upright (ImageDecoder applies its EXIF
   * rotation), crops its centre square, and encodes it at
   * [PlaylistImageStore.LARGE_SIZE] and [PlaylistImageStore.THUMB_SIZE] px (or
   * smaller, when the photo is). Returns (large, thumbnail); throws when the
   * photo can't be read.
   */
  fun squareJpegs(resolver: ContentResolver, uri: Uri): Pair<ByteArray, ByteArray> {
    val source = ImageDecoder.createSource(resolver, uri)
    val decoded = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
      // Software pixels, so the crop and the JPEG encoder can read them.
      decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
      decoder.setTargetSampleSize(
        PlaylistImageStore.sampleSize(info.size.width, info.size.height, PlaylistImageStore.LARGE_SIZE),
      )
    }
    val square = PlaylistImageStore.centreSquare(decoded.width, decoded.height)
    val cropped = Bitmap.createBitmap(decoded, square.left, square.top, square.side, square.side)
    try {
      return jpeg(cropped, PlaylistImageStore.LARGE_SIZE) to jpeg(cropped, PlaylistImageStore.THUMB_SIZE)
    } finally {
      if (cropped !== decoded) cropped.recycle()
      decoded.recycle()
    }
  }

  private fun jpeg(square: Bitmap, side: Int): ByteArray {
    val scaled = if (square.width > side) Bitmap.createScaledBitmap(square, side, side, true) else square
    try {
      val out = ByteArrayOutputStream()
      scaled.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
      return out.toByteArray()
    } finally {
      if (scaled !== square) scaled.recycle()
    }
  }
}
