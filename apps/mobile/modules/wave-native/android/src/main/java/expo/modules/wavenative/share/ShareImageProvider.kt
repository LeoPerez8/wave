package expo.modules.wavenative.share

import androidx.core.content.FileProvider

/**
 * Hands the images Wave shares ([SharedImages]) to the app they're shared
 * with, as content URIs (`res/xml/wave_share_paths.xml`: the cache's
 * `shared-images` folder only). A class of its own so its manifest entry
 * can't clash with another FileProvider's.
 */
class ShareImageProvider : FileProvider() {
  companion object {
    /** Its authority after the application id; the manifest declares the same. */
    const val AUTHORITY_SUFFIX = ".images"
  }
}
