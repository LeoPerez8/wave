package expo.modules.wavenative.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities

/**
 * Whether the phone is online, as Android sees its default network. YouTube Music and Soulseek
 * both ask here, so they tell the phone being offline from a server failing the same way. Each
 * answer reads [AndroidConnectivity]'s cache, which follows the default network's callbacks.
 */
class Connectivity(context: Context) {
  private val cache = AndroidConnectivity.cache(context)

  /** The default network says it carries the internet: worth sending a request on. */
  fun hasNetwork(): Boolean = cache.current.hasNetwork

  /** Android checked that the default network reaches the internet (`ConnectivityState.online`). */
  fun online(): Boolean = cache.current.online

  /** The default network is the phone's mobile data, not Wi-Fi or a cable. */
  fun onMobileData(): Boolean = cache.current.onMobileData
}

/** The process's one [ConnectivityCache], kept by a default-network callback from its first use. */
object AndroidConnectivity {
  @Volatile private var cache: ConnectivityCache? = null

  fun cache(context: Context): ConnectivityCache =
    cache ?: synchronized(this) { cache ?: start(context.applicationContext).also { cache = it } }

  private fun start(context: Context): ConnectivityCache {
    val manager = context.getSystemService(ConnectivityManager::class.java)
      ?: return ConnectivityCache(ConnectivityState.OFFLINE)
    val active = manager.activeNetwork?.let { manager.getNetworkCapabilities(it) }
    val cache = ConnectivityCache(ConnectivityState.of(active?.facts()))
    manager.registerDefaultNetworkCallback(
      object : ConnectivityManager.NetworkCallback() {
        /** The default network the cache describes; a handover's late loss of the last one changes nothing. */
        private var current: Network? = null

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
          current = network
          cache.update(ConnectivityState.of(capabilities.facts()))
        }

        override fun onLost(network: Network) {
          if (network != current) return
          current = null
          cache.update(ConnectivityState.OFFLINE)
        }
      },
    )
    return cache
  }

  private fun NetworkCapabilities.facts() = NetworkFacts(
    internet = hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
    validated = hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
    cellular = hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR),
    wifi = hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
    ethernet = hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET),
  )
}
