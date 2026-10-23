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
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Sharing images Wave draws (the lyrics card): JS sends a PNG as base64
 * ([SharedImages]), then saves it to the gallery, opens the share sheet with it,
 * or hands it straight to Instagram Stories or WhatsApp. The functions that open
 * another app run on the main thread and start it there, so an app that can't
 * be opened (uninstalled since the check) rejects the call instead of crashing.
 */
class ShareModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val images: SharedImages get() = SharedImages(File(context.cacheDir, SharedImages.DIRECTORY))

  override fun definition() = ModuleDefinition {
    Name("WaveShare")

    /** Writes the base64 PNG to the shared images as [fileName]; resolves its path. */
    AsyncFunction("writeImage") { base64: String, fileName: String -> images.write(base64, fileName).absolutePath }

    /** Creates a tight rounded sticker and the separate full Story gradient. */
    AsyncFunction("writeStoryImages") { path: String, frame: Map<String, Double>, top: String, bottom: String ->
      val source = File(path)
      // The same cache-only boundary as delivery, before reading or creating a sibling PNG.
      contentUri(source)
      val sticker = StorySticker.write(source, frame)
      try {
        val background = StoryBackground.write(
          source.parentFile!!, frame.getValue("width").toInt(), frame.getValue("height").toInt(), top, bottom,
        )
        mapOf("sticker" to sticker.absolutePath, "background" to background.absolutePath)
      } catch (error: Exception) {
        sticker.delete()
        throw error
      }
    }

    /** Copies the image at [path] into the gallery, in Pictures/Wave. */
    AsyncFunction("saveToGallery") { path: String -> saveToGallery(File(path)) }

    /** Opens the share sheet with the image at [path], titled [title]. */
    AsyncFunction("shareImage") { path: String, title: String ->
      val send = imageIntent(File(path))
      startActivity(Intent.createChooser(send, title))
    }.runOnQueue(Queues.MAIN)

    /**
     * Which apps an image can go straight to: `instagramStories` (Instagram
     * takes its Stories intent) and `whatsapp` (WhatsApp takes a shared image).
     * The manifest's `<queries>` make both packages visible to the check.
     */
    AsyncFunction("shareApps") {
      mapOf(
        "instagramStories" to resolves(storyIntent()),
        "whatsapp" to resolves(Intent(Intent.ACTION_SEND).setType(PNG).setPackage(WHATSAPP)),
      )
    }

    /**
     * Opens Instagram's Stories editor with the image at [path] as a sticker the
     * user can move and resize, over a [top] to [bottom] background (`#rrggbb`),
     * as Meta's "Sharing to Stories" has it. [appId] is the build's Facebook App
     * ID, which Instagram requires as the source application. Only Instagram is
     * granted to read the image. Song and Recap retain this colour-extra path;
     * lyrics use [shareStoryImages] with an actual background image.
     */
    AsyncFunction("shareToInstagramStory") { path: String, top: String, bottom: String, appId: String ->
      val uri = contentUri(File(path))
      context.grantUriPermission(INSTAGRAM, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      val story = storyIntent().apply {
        putExtra("source_application", appId)
        putExtra("interactive_asset_uri", uri)
        putExtra("top_background_color", top)
        putExtra("bottom_background_color", bottom)
      }
      startActivity(story)
    }.runOnQueue(Queues.MAIN)

    /** Keeps the lyrics movable over Wave's gradient, with read access to both PNGs. */
    AsyncFunction("shareStoryImages") { sticker: String, background: String, appId: String ->
      val stickerUri = contentUri(File(sticker))
      val backgroundUri = contentUri(File(background))
      context.grantUriPermission(INSTAGRAM, stickerUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      context.grantUriPermission(INSTAGRAM, backgroundUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      val story = storyIntent().apply {
        setDataAndType(backgroundUri, PNG)
        putExtra("source_application", appId)
        putExtra("interactive_asset_uri", stickerUri)
        clipData = ClipData.newRawUri("Story background", backgroundUri).apply {
          addItem(ClipData.Item(stickerUri))
        }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      startActivity(story)
    }.runOnQueue(Queues.MAIN)

    /** Sends the image at [path] straight to WhatsApp's share flow; only WhatsApp can read it. */
    AsyncFunction("shareToWhatsApp") { path: String ->
      startActivity(imageIntent(File(path)).setPackage(WHATSAPP))
    }.runOnQueue(Queues.MAIN)
  }

  /** Instagram's Stories intent, addressed to Instagram only, with no image yet. */
  private fun storyIntent(): Intent = Intent(INSTAGRAM_STORY).setType(PNG).setPackage(INSTAGRAM)

  /** Whether an installed app takes [intent]. */
  private fun resolves(intent: Intent): Boolean = intent.resolveActivity(context.packageManager) != null

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
      type = PNG
      putExtra(Intent.EXTRA_STREAM, uri)
      // The share sheet shows the image as its preview.
      clipData = ClipData.newRawUri(image.name, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
  }

  /**
   * Starts [intent] now, on the main thread the calling function runs on: an
   * `ActivityNotFoundException` rejects the JS promise (its toast says so).
   */
  private fun startActivity(intent: Intent) {
    val activity = appContext.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private fun saveToGallery(image: File) {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, image.name)
      put(MediaStore.Images.Media.MIME_TYPE, PNG)
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

  private companion object {
    const val PNG = "image/png"
    const val INSTAGRAM = "com.instagram.android"
    const val INSTAGRAM_STORY = "com.instagram.share.ADD_TO_STORY"
    const val WHATSAPP = "com.whatsapp"
  }
}
