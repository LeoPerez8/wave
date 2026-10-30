package expo.modules.wavenative.player

import expo.modules.wavenative.locale.NativeText
/** Where the Lyrics toggle is kept between drives. */
interface LyricsToggleStore {
  fun load(): Boolean

  fun save(on: Boolean)
}

/**
 * What the now-playing title and artist show (Core's `AutoLyricsText`): the
 * line being sung as the title, and the next sung line as the artist, or the
 * track's own artist with a null [artist].
 */
data class LyricsText(val title: String, val artist: String?)

/** The text JS last sent, for the item (queue entry key) it belongs to. */
private data class SentText(val itemId: String, val text: LyricsText)

/**
 * The Lyrics toggle in the overflow menu of Auto's player screen. While it is
 * on and Auto is connected, the title shows the synced lyric line being sung
 * and the artist the next one; the cover stays as it is. JS works out the
 * text (Core's `autoLyricLines`) and sends it with `setAutoLyricsText`;
 * [PlaybackService] shows it through [LyricsTextPlayer]. Plain Kotlin, so it
 * is JVM-testable.
 */
object AutoLyrics {
  const val TOGGLE_ACTION = "expo.modules.wavenative.AUTO_LYRICS"

  /** The toggle's label in Auto's overflow menu. */
  fun label(on: Boolean): String = if (on) NativeText.get("lyricsOn") else NativeText.get("lyricsOff")

  /** The process-wide state: the service and [WavePlayerModule] share it. */
  val state = AutoLyricsState()
}

/**
 * The toggle (kept in a [LyricsToggleStore]), whether Auto is connected, and
 * the text JS sent. The phone's notification and lock screen share the title
 * and artist with Auto, so lyrics only show while both the toggle is on and
 * Auto is connected: turning either off brings the real title and artist back
 * at once, without waiting for JS. Use it on the main thread.
 */
class AutoLyricsState {
  private val listeners = mutableListOf<() -> Unit>()
  private var store: LyricsToggleStore? = null
  private var sent: SentText? = null

  /** The Lyrics toggle; off on a fresh install. */
  var on = false
    private set

  /** Whether Android Auto is connected. */
  var carConnected = false
    private set

  /** Reads the toggle from [store], once per process. */
  fun init(store: LyricsToggleStore) {
    if (this.store != null) return
    this.store = store
    on = store.load()
  }

  /** A tap on the toggle: remembers the new state. */
  fun toggle() {
    on = !on
    store?.save(on)
    if (!on) sent = null
    changed()
  }

  fun setCarConnected(connected: Boolean) {
    if (connected == carConnected) return
    carConnected = connected
    if (!connected) sent = null
    changed()
  }

  /** Shows [text] as the title and artist of item [itemId]; null shows its own. Ignored while lyrics don't show. */
  fun showText(itemId: String?, text: LyricsText?) {
    val next = if (on && carConnected && itemId != null && text != null) SentText(itemId, text) else null
    if (next == sent) return
    sent = next
    changed()
  }

  /** The text to show as the title and artist of item [itemId], or null for its own. */
  fun textFor(itemId: String?): LyricsText? =
    sent?.takeIf { on && carConnected && it.itemId == itemId }?.text

  /** Calls [listener] on every change; the returned function stops it. */
  fun listen(listener: () -> Unit): () -> Unit {
    listeners += listener
    return { listeners -= listener }
  }

  private fun changed() = listeners.toList().forEach { it() }
}
