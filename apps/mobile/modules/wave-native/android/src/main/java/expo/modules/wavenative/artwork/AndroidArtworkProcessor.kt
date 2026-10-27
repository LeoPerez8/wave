package expo.modules.wavenative.artwork

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.palette.graphics.Palette
import java.io.File
import java.io.IOException

/** Decodes once for the medium cover and thumbnail, then picks the palette from the thumbnail. */
class AndroidArtworkProcessor(private val thumbSize: Int = 300) : ArtworkProcessor {
  override fun process(image: ByteArray, thumbFile: File): ArtworkPalette? {
    val decoded = decode(image, maxOf(thumbSize, ArtworkDimensions.MEDIUM_SIZE)) ?: return null
    try {
      val mediumFile = File(thumbFile.parentFile, thumbFile.name.removeSuffix("_thumb.jpg") + "_medium.jpg")
      writeSized(decoded, mediumFile, ArtworkDimensions.MEDIUM_SIZE)
      val thumb = scaled(decoded, thumbSize)
      try {
        writeJpeg(thumb, thumbFile)
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
      }
    } finally {
      decoded.recycle()
    }
  }

  /** Backfills only the missing size from cached image bytes, without tags or palette work. */
  fun medium(image: ByteArray, target: File): Boolean {
    val decoded = decode(image, ArtworkDimensions.MEDIUM_SIZE) ?: return false
    try {
      writeSized(decoded, target, ArtworkDimensions.MEDIUM_SIZE)
      return true
    } finally {
      decoded.recycle()
    }
  }

  private fun decode(image: ByteArray, limit: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(image, 0, image.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    return BitmapFactory.decodeByteArray(image, 0, image.size, BitmapFactory.Options().apply {
      inSampleSize = ArtworkDimensions.sampleSize(bounds.outWidth, bounds.outHeight, limit)
    })
  }

  private fun scaled(bitmap: Bitmap, limit: Int): Bitmap {
    val (width, height) = ArtworkDimensions.fit(bitmap.width, bitmap.height, limit)
    return if (width == bitmap.width && height == bitmap.height) bitmap
      else Bitmap.createScaledBitmap(bitmap, width, height, true)
  }

  private fun writeSized(bitmap: Bitmap, target: File, limit: Int) {
    val result = scaled(bitmap, limit)
    try {
      writeJpeg(result, target)
    } finally {
      if (result !== bitmap) result.recycle()
    }
  }

  private fun writeJpeg(bitmap: Bitmap, target: File) {
    // Scanner and backfill may meet on this cover. Each writer owns its temp file.
    val temp = File.createTempFile(".${target.name}", ".tmp", target.parentFile)
    try {
      val saved = temp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
      if (!saved || !temp.renameTo(target)) throw IOException("Could not write ${target.path}")
    } finally {
      temp.delete()
    }
  }
}
