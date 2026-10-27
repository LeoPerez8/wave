package expo.modules.wavenative.net

import java.util.concurrent.CopyOnWriteArrayList

/** What Android says of the default network, as [ConnectivityState] reads it. */
data class NetworkFacts(
  val internet: Boolean,
  val validated: Boolean,
  val cellular: Boolean,
  val wifi: Boolean,
  val ethernet: Boolean,
)

/**
 * The phone's connectivity. [hasNetwork]: the default network says it carries the internet,
 * worth sending a request on. [online]: Android also checked it reaches the internet, so a
 * request failing while it hasn't (no network, a captive portal, a network still coming up after
 * a handover) failed because the phone is offline, not because the server did. [onMobileData]:
 * the default network is mobile data, not Wi-Fi or a cable (a big download is the owner's plan).
 */
data class ConnectivityState(val hasNetwork: Boolean, val online: Boolean, val onMobileData: Boolean) {
  companion object {
    val OFFLINE = ConnectivityState(hasNetwork = false, online = false, onMobileData = false)

    /** The state of a default network with [facts]; offline with none. */
    fun of(facts: NetworkFacts?): ConnectivityState =
      if (facts == null) {
        OFFLINE
      } else {
        ConnectivityState(
          hasNetwork = facts.internet,
          online = facts.internet && facts.validated,
          onMobileData = facts.cellular && !facts.wifi && !facts.ethernet,
        )
      }
  }
}

/**
 * The last connectivity Android reported, so a check reads a field instead of asking
 * Android (a binder call) each time. Listeners hear each change, once.
 */
class ConnectivityCache(initial: ConnectivityState) {
  @Volatile var current: ConnectivityState = initial
    private set

  private val listeners = CopyOnWriteArrayList<(ConnectivityState) -> Unit>()

  /** Hears each change from now on, until the returned function stops it. */
  fun listen(listener: (ConnectivityState) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }

  fun update(next: ConnectivityState) {
    synchronized(this) {
      if (next == current) return
      current = next
    }
    for (listener in listeners) listener(next)
  }
}
