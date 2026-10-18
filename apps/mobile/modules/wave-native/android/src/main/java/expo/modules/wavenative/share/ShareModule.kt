package expo.modules.wavenative.share

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Sharing images Wave draws (the lyrics card): JS sends a PNG as base64
 * ([SharedImages]), then saves it to the gallery or opens the share sheet with it.
 */
class ShareModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val images: SharedImages get() = SharedImages(File(context.cacheDir, SharedImages.DIRECTORY))

  override fun definition() = ModuleDefinition {
    Name("WaveShare")

    /** Writes the base64 PNG to the shared images as [fileName]; resolves its path. */
    AsyncFunction("writeImage") { base64: String, fileName: String -> images.write(base64, fileName).absolutePath }

    /** Copies the image at [path] into the gallery, in Pictures/Wave. */
    AsyncFunction("saveToGallery") { path: String -> saveToGallery(File(path)) }

    /** Opens the share sheet with the image at [path], titled [title]. */
    AsyncFunction("shareImage") { path: String, title: String ->
      val send = imageIntent(File(path))
      startActivity(Intent.createChooser(send, title))
    }
  }

  /** A content URI for a shared image, readable by whoever the intent carrying it reaches. */
  private fun contentUri(image: File): Uri {
    require(image.parentFile?.canonicalFile == File(context.cacheDir, SharedImages.DIRECTORY).canonicalFile) {
      "Only Wave's shared images can be shared"
    }
    return FileProvider.getUriForFile(context, context.packageName + ShareImageProvider.AUTHORITY_SUFFIX, image)
  }

  /** A send intent with [image] as a PNG. */
  private fun imageIntent(image: File): Intent {
    val uri = contentUri(image)
    return Intent(Intent.ACTION_SEND).apply {
      type = "image/png"
      putExtra(Intent.EXTRA_STREAM, uri)
      // The share sheet shows the image as its preview.
      clipData = ClipData.newRawUri(image.name, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
  }

  private fun startActivity(intent: Intent) {
    val activity = appContext.currentActivity
    if (activity != null) {
      activity.runOnUiThread { activity.startActivity(intent) }
    } else {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private fun saveToGallery(image: File) {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, image.name)
      put(MediaStore.Images.Media.MIME_TYPE, "image/png")
      put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Wave")
      // Hidden from other apps until it's all written.
      put(MediaStore.Images.Media.IS_PENDING, 1)
    }
    val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val uri = resolver.insert(collection, values) ?: throw IllegalStateException("The gallery didn't take the image")
    try {
      val output = resolver.openOutputStream(uri) ?: throw IllegalStateException("Couldn't open the gallery's file")
      output.use { out -> image.inputStream().use { it.copyTo(out) } }
      resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      throw e
    }
  }
}
