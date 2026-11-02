package expo.modules.wavenative.launch

import java.lang.ref.WeakReference
import java.util.WeakHashMap

/**
 * Which of MainActivity's intents are new requests (#899, #902).
 *
 * MainActivity hands `super.onCreate` a null state, so its listeners can't tell a fresh launch
 * from Android restoring the screen after its process died: [preCreated] sees the real state.
 * A restored screen carries the intent that first opened it, already handled.
 */
class LaunchIntents {
  private val restored = WeakHashMap<Any, Unit>()
  private var delivered = WeakReference<Any>(null)

  fun preCreated(screen: Any, restored: Boolean) = synchronized(this) {
    if (restored) this.restored[screen] = Unit else this.restored.remove(screen)
  }

  /** Recents replays an old intent too. */
  fun launchIsNew(screen: Any, fromHistory: Boolean): Boolean =
    synchronized(this) { !fromHistory && screen !in restored }

  /** Expo passes a new intent on only once the app has loaded, the activity only before that. */
  fun firstDelivery(intent: Any): Boolean = synchronized(this) {
    if (delivered.get() === intent) return false
    delivered = WeakReference(intent)
    true
  }

  companion object {
    val shared = LaunchIntents()
  }
}
