package expo.modules.wavenative.share

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import java.io.File

/** The surrounding Story gradient as pixels, independent of Instagram's colour extras. */
object StoryBackground {
  fun write(directory: File, width: Int, height: Int, top: String, bottom: String): File {
    require(width in 1..4096 && height in 1..4096) { "Invalid Story background size" }
    val paint = Paint().apply {
      shader = LinearGradient(
        0f, 0f, 0f, height.toFloat(),
        Color.parseColor(top), Color.parseColor(bottom), Shader.TileMode.CLAMP,
      )
      isDither = true
    }
    val background = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    try {
      Canvas(background).drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
      val output = File.createTempFile("story-background-", ".png", directory)
      try {
        output.outputStream().use {
          check(background.compress(Bitmap.CompressFormat.PNG, 100, it)) { "Couldn't write the Story background" }
        }
      } catch (error: Exception) {
        output.delete()
        throw error
      }
      return output
    } finally {
      background.recycle()
    }
  }
}
