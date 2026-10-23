package expo.modules.wavenative.share

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import java.io.File
import kotlin.math.roundToInt

/**
 * A tight lyrics sticker with transparent rounded corners, without surrounding
 * padding that Instagram could crop. Core's lyricStoryFrame supplies its size
 * and radius, shared with the preview. The gradient is a separate background
 * image; the source for Save image, WhatsApp and More stays intact.
 */
object StorySticker {
  fun write(source: File, frame: Map<String, Double>): File {
    fun value(key: String): Float {
      val value = frame[key] ?: throw IllegalArgumentException("Missing sticker $key")
      require(value.isFinite()) { "Invalid sticker $key" }
      return value.toFloat()
    }
    val width = value("width")
    val height = value("height")
    require(width in 1f..4096f && height in 1f..4096f && width % 1f == 0f && height % 1f == 0f) {
      "Invalid sticker canvas"
    }
    val left = value("left")
    val top = value("top")
    val cardWidth = value("cardWidth")
    val cardHeight = value("cardHeight")
    val radius = value("cornerRadius")
    require(left >= 0 && top >= 0 && cardWidth >= 1 && cardHeight >= 1 &&
      left + cardWidth <= width && top + cardHeight <= height &&
      radius > 0 && radius <= minOf(cardWidth, cardHeight) / 2) { "Invalid sticker bounds" }
    val card = BitmapFactory.decodeFile(source.absolutePath)
      ?: throw IllegalArgumentException("Couldn't read the sticker's card")
    try {
      val sticker = Bitmap.createBitmap(cardWidth.roundToInt(), cardHeight.roundToInt(), Bitmap.Config.ARGB_8888)
      try {
        // A shader on an anti-aliased round rect keeps the corners transparent,
        // including their edge pixels; clipping a path can leave a jagged rim.
        val bounds = RectF(0f, 0f, sticker.width.toFloat(), sticker.height.toFloat())
        val shader = BitmapShader(card, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
        shader.setLocalMatrix(Matrix().apply {
          setRectToRect(
            RectF(0f, 0f, card.width.toFloat(), card.height.toFloat()),
            bounds,
            Matrix.ScaleToFit.FILL,
          )
        })
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { this.shader = shader }
        Canvas(sticker).drawRoundRect(bounds, radius, radius, paint)
        val output = File.createTempFile("story-", ".png", source.parentFile)
        output.deletingOnFailure { file ->
          file.outputStream().use {
            check(sticker.compress(Bitmap.CompressFormat.PNG, 100, it)) { "Couldn't write the sticker" }
          }
        }
        return output
      } finally {
        sticker.recycle()
      }
    } finally {
      card.recycle()
    }
  }
}
