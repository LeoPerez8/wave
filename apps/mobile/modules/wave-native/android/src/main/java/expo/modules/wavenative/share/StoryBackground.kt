package expo.modules.wavenative.share

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File

/** A Story's background as JS passes it (Core's `LyricStoryBackground`): `#rrggbb` top and bottom. */
class StoryBackgroundRecord : Record {
  @Field val top: String = ""
  @Field val bottom: String = ""
}

/** The surrounding Story gradient as pixels, independent of Instagram's colour extras. */
object StoryBackground {
  fun write(directory: File, width: Int, height: Int, colours: StoryBackgroundRecord): File {
    require(width in 1..4096 && height in 1..4096) { "Invalid Story background size" }
    val paint = Paint().apply {
      shader = LinearGradient(
        0f, 0f, 0f, height.toFloat(),
        Color.parseColor(colours.top), Color.parseColor(colours.bottom), Shader.TileMode.CLAMP,
      )
      isDither = true
    }
    val background = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    try {
      Canvas(background).drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
      val output = File.createTempFile("story-background-", ".png", directory)
      output.deletingOnFailure { file ->
        file.outputStream().use {
          check(background.compress(Bitmap.CompressFormat.PNG, 100, it)) { "Couldn't write the Story background" }
        }
      }
      return output
    } finally {
      background.recycle()
    }
  }
}
