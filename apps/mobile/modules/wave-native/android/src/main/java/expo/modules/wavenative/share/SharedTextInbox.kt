package expo.modules.wavenative.share

import android.content.Intent

/**
 * Text shared to Wave from another app's share sheet (the `text/plain` SEND intent filter in
 * app.config.ts, or the "Import to Wave" [ShareShortcut]), or a song or playlist link tapped in
 * another app (the VIEW filter there), held until JS takes it ([SharedText] says what counts). The main
 * activity's intents arrive here from [expo.modules.wavenative.WaveNativePackage]: the one that
 * started it and any later one (a share with Wave already open). Only the latest share is kept.
 */
object SharedTextInbox {
  private var pending: String? = null

  /** Told when a share arrives; WaveNativeModule sends `onShareReceived` to JS. */
  @Volatile var onReceived: (() -> Unit)? = null

  /** Keeps [intent]'s text when it's a share of text or a tapped web link; anything else is ignored. */
  fun receive(intent: Intent?) {
    val text = SharedText.of(intent) ?: return
    synchronized(this) { pending = text }
    onReceived?.invoke()
  }

  /** The latest shared text, once; null when nothing new was shared. */
  fun take(): String? = synchronized(this) { pending.also { pending = null } }
}
