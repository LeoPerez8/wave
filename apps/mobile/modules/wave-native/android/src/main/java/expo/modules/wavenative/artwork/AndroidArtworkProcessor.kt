package expo.modules.wavenative.artwork

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.palette.graphics.Palette
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Decodes artwork with BitmapFactory, writes a JPEG thumbnail whose longest
 * side is [thumbSize] px, and picks a palette with AndroidX Palette (used to
 * tint Now Playing).
 */
class AndroidArtworkProcessor(private val thumbSize: Int = 300) : ArtworkProcessor {
  override fun process(image: ByteArray, thumbFile: File): ArtworkPalette? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(image, 0, image.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    // Decode at the smallest power-of-two scale that still covers the thumbnail size.
    var sampleSize = 1
    while (
      bounds.outWidth / (sampleSize * 2) >= thumbSize && bounds.outHeight / (sampleSize * 2) >= thumbSize
    ) {
      sampleSize *= 2
    }
    val decoded =
      BitmapFactory.decodeByteArray(
        image,
        0,
        image.size,
        BitmapFactory.Options().apply { inSampleSize = sampleSize },
      ) ?: return null

    val scale = thumbSize.toFloat() / max(decoded.width, decoded.height)
    val thumb =
      if (scale < 1f) {
        Bitmap.createScaledBitmap(
          decoded,
          max(1, (decoded.width * scale).roundToInt()),
          max(1, (decoded.height * scale).roundToInt()),
          true,
        )
      } else {
        decoded
      }
    try {
      val temp = File(thumbFile.parentFile, ".${thumbFile.name}.tmp")
      temp.outputStream().use { thumb.compress(Bitmap.CompressFormat.JPEG, 85, it) }
      if (!temp.renameTo(thumbFile)) {
        temp.delete()
        return null
      }
      val palette = Palette.from(thumb).maximumColorCount(16).generate()
      return ArtworkPalette(
        dominant = palette.dominantSwatch?.rgb,
        vibrant = palette.vibrantSwatch?.rgb,
        darkVibrant = palette.darkVibrantSwatch?.rgb,
        lightVibrant = palette.lightVibrantSwatch?.rgb,
        muted = palette.mutedSwatch?.rgb,
        darkMuted = palette.darkMutedSwatch?.rgb,
        lightMuted = palette.lightMutedSwatch?.rgb,
      )
    } finally {
      if (thumb !== decoded) thumb.recycle()
      decoded.recycle()
    }
  }
}
