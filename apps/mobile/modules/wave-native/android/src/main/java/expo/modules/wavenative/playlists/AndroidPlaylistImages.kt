package expo.modules.wavenative.playlists

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Makes a picked photo into a playlist image's original, and a framing of the
 * original into the image's two square JPEGs ([PlaylistImageStore] saves them).
 */
object AndroidPlaylistImages {
  private const val QUALITY = 90

  /** A photo kept as an original: its JPEG and its size, in px. */
  class Original(val jpeg: ByteArray, val width: Int, val height: Int)

  /**
   * Decodes the photo at [uri] upright (ImageDecoder applies its EXIF
   * rotation), at most [PlaylistImageStore.ORIGINAL_SIZE] px on its short
   * side, and encodes it as a JPEG. Throws when the photo can't be read.
   */
  fun original(resolver: ContentResolver, uri: Uri): Original {
    val decoded = decode(ImageDecoder.createSource(resolver, uri), shrink = true)
    try {
      return Original(jpeg(decoded), decoded.width, decoded.height)
    } finally {
      decoded.recycle()
    }
  }

  /**
   * Crops [square] (in the original's px, kept inside it) out of the original
   * at [path] and encodes it at [PlaylistImageStore.LARGE_SIZE] and
   * [PlaylistImageStore.THUMB_SIZE] px (or smaller, when the square is).
   * Returns (large, thumbnail); throws when the original can't be read.
   */
  fun squareJpegs(path: String, square: Square): Pair<ByteArray, ByteArray> {
    val decoded = decode(ImageDecoder.createSource(File(path)), shrink = false)
    try {
      val fit = PlaylistImageStore.fitSquare(decoded.width, decoded.height, square)
      // Inside the try: a crop that throws (out of memory on a big original) still frees the decoded photo.
      val cropped = Bitmap.createBitmap(decoded, fit.left, fit.top, fit.side, fit.side)
      try {
        return jpeg(cropped, PlaylistImageStore.LARGE_SIZE) to jpeg(cropped, PlaylistImageStore.THUMB_SIZE)
      } finally {
        if (cropped !== decoded) cropped.recycle()
      }
    } finally {
      decoded.recycle()
    }
  }

  private fun decode(source: ImageDecoder.Source, shrink: Boolean): Bitmap =
    ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
      // Software pixels, so the crop and the JPEG encoder can read them.
      decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
      if (shrink) {
        val (width, height) = PlaylistImageStore.originalSize(info.size.width, info.size.height)
        decoder.setTargetSize(width, height)
      }
    }

  private fun jpeg(picture: Bitmap): ByteArray {
    val out = ByteArrayOutputStream()
    picture.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
    return out.toByteArray()
  }

  private fun jpeg(square: Bitmap, side: Int): ByteArray {
    val scaled = if (square.width > side) Bitmap.createScaledBitmap(square, side, side, true) else square
    try {
      return jpeg(scaled)
    } finally {
      if (scaled !== square) scaled.recycle()
    }
  }
}
