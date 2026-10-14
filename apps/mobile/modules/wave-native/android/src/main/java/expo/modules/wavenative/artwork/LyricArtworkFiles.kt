package expo.modules.wavenative.artwork

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Shader
import android.graphics.Typeface
import android.util.Log
import expo.modules.wavenative.player.AutoLyrics
import expo.modules.wavenative.player.LyricArtCanvas
import expo.modules.wavenative.player.LyricArtPainter
import expo.modules.wavenative.player.LyricRow
import java.io.File

/**
 * The lyrics images Android Auto shows as the artwork ([AutoLyrics.artworks]),
 * drawn by [LyricArtPainter] into JPEGs in [directory] the first time they
 * are asked for, on the provider's thread. Images no longer kept are deleted
 * as new ones are drawn, as are any left by an earlier run.
 */
object LyricArtworkFiles {
  /** The JPEG of lyrics image [id], drawn now if it isn't yet; null when it isn't one of the latest. */
  fun file(directory: File, id: String): File? {
    val target = File(directory, "$id.jpg")
    if (target.isFile) return target
    val entry = AutoLyrics.artworks.find(id) ?: return null
    directory.mkdirs()
    dropOld(directory)
    return try {
      val size = LyricArtPainter.SIZE
      val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
      LyricArtPainter.paint(entry.lines, AndroidLyricArtCanvas(Canvas(bitmap), size, entry.coverPath?.let { decodeCover(it, size) }))
      val temp = File.createTempFile(".$id-", ".tmp", directory)
      temp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
      bitmap.recycle()
      // Another reader may have drawn it meanwhile; either copy is the same image.
      if (temp.renameTo(target) || target.isFile) target.also { temp.delete() } else null.also { temp.delete() }
    } catch (e: Exception) {
      Log.w("WaveArtwork", "Couldn't draw a lyrics image", e)
      null
    }
  }

  /** Deletes the images (and half-written files) of ids no longer kept. */
  private fun dropOld(directory: File) {
    val live = AutoLyrics.artworks.liveIds()
    directory.listFiles()?.forEach { file ->
      val id = file.name.trimStart('.').substringBefore('-').substringBefore('.')
      if (id !in live) file.delete()
    }
  }

  /** The cover at [path], decoded at about [size] (not much larger), or null when it can't be read. */
  private fun decodeCover(path: String, size: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= size) sample *= 2
    return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
  }
}

/** [LyricArtCanvas] on Android's canvas, over [cover] (null for Wave's gradient). */
private class AndroidLyricArtCanvas(
  private val canvas: Canvas,
  override val size: Int,
  private val cover: Bitmap?,
) : LyricArtCanvas {
  private val bold = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
    color = Color.WHITE
    textAlign = Paint.Align.CENTER
  }
  private val regular = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
    color = Color.WHITE
    textAlign = Paint.Align.CENTER
  }

  private fun paint(sizePx: Float, isBold: Boolean): Paint = (if (isBold) bold else regular).apply { textSize = sizePx }

  override fun textWidth(text: String, sizePx: Float, bold: Boolean): Float = paint(sizePx, bold).measureText(text)

  override fun drawBackground() {
    val full = Rect(0, 0, size, size)
    if (cover == null) {
      val side = size.toFloat()
      val gradient = Paint().apply {
        shader = LinearGradient(
          0f, 0f, side, side,
          Color.rgb(LyricArtPainter.FALLBACK_TOP shr 16, LyricArtPainter.FALLBACK_TOP shr 8 and 0xff, LyricArtPainter.FALLBACK_TOP and 0xff),
          Color.rgb(LyricArtPainter.FALLBACK_BOTTOM shr 16, LyricArtPainter.FALLBACK_BOTTOM shr 8 and 0xff, LyricArtPainter.FALLBACK_BOTTOM and 0xff),
          Shader.TileMode.CLAMP,
        )
      }
      canvas.drawRect(full, gradient)
      return
    }
    // The largest centred square, so a non-square cover isn't stretched.
    val side = minOf(cover.width, cover.height)
    val left = (cover.width - side) / 2
    val top = (cover.height - side) / 2
    canvas.drawBitmap(cover, Rect(left, top, left + side, top + side), full, Paint(Paint.FILTER_BITMAP_FLAG))
    canvas.drawColor(Color.argb((LyricArtPainter.DIM * 255).toInt(), 0, 0, 0))
  }

  override fun drawText(row: LyricRow) {
    val paint = paint(row.sizePx, row.bold)
    paint.alpha = (row.alpha * 255).toInt()
    canvas.drawText(row.text, row.centreX, row.baseline, paint)
  }
}
