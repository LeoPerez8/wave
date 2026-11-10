package expo.modules.wavenative.share

import android.content.Intent

/**
 * The text an intent hands Wave's [SharedTextInbox]: the text of a `text/` share (`SEND`), or the
 * address of a tapped web link (`VIEW` with an `http` or `https` link, from the song-link filter
 * in app.config.ts). `wave://` links stay with expo-router, and anything else gives nothing.
 */
object SharedText {
  fun of(intent: Intent?): String? =
    intent?.let {
      of(
        it.action,
        it.type,
        fromHistory = (it.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0,
        text = if (it.action == Intent.ACTION_SEND) it.getCharSequenceExtra(Intent.EXTRA_TEXT) else null,
        link = it.dataString,
      )
    }

  fun of(action: String?, type: String?, fromHistory: Boolean, text: CharSequence?, link: String?): String? {
    // An intent Android replays when Wave is reopened from Recents was already handled.
    if (fromHistory) return null
    return when (action) {
      Intent.ACTION_SEND ->
        if (type?.startsWith("text/") == true) text?.toString()?.takeIf { it.isNotBlank() } else null
      Intent.ACTION_VIEW -> link?.takeIf { isWebLink(it) }
      else -> null
    }
  }

  private fun isWebLink(link: String): Boolean {
    val scheme = link.substringBefore(':', missingDelimiterValue = "").lowercase()
    return scheme == "https" || scheme == "http"
  }
}
