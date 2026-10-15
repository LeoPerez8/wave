package expo.modules.wavenative.share

import android.content.Intent

/**
 * Text shared to Wave from another app's share sheet (the `text/plain` SEND intent filter in
 * app.config.ts, or the "Import to Wave" [ShareShortcut]), held until JS takes it. The main
 * activity's intents arrive here from [expo.modules.wavenative.WaveNativePackage]: the one that
 * started it and any later one (a share with Wave already open). Only the latest share is kept.
 */
object SharedTextInbox {
  private var pending: String? = null

  /** Told when a share arrives; WaveNativeModule sends `onShareReceived` to JS. */
  @Volatile var onReceived: (() -> Unit)? = null

  /** Keeps [intent]'s text when it's a share of text; anything else is ignored. */
  fun receive(intent: Intent?) {
    val text = sharedText(intent) ?: return
    synchronized(this) { pending = text }
    onReceived?.invoke()
  }

  /** The latest shared text, once; null when nothing new was shared. */
  fun take(): String? = synchronized(this) { pending.also { pending = null } }

  private fun sharedText(intent: Intent?): String? {
    if (intent?.action != Intent.ACTION_SEND) return null
    if (intent.type?.startsWith("text/") != true) return null
    // A share Android replays when Wave is reopened from Recents was already handled.
    if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null
    return intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf { it.isNotBlank() }
  }
}
