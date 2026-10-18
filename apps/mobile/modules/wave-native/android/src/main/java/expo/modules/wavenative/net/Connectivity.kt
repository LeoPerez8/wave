package expo.modules.wavenative.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/**
 * Whether the phone is online, as Android sees its default network. YouTube Music and Soulseek
 * both ask here, so they tell the phone being offline from a server failing the same way.
 */
class Connectivity(context: Context) {
  private val manager = context.getSystemService(ConnectivityManager::class.java)

  /** The default network says it carries the internet: worth sending a request on. */
  fun hasNetwork(): Boolean = capabilities()?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

  /**
   * Android checked that the default network reaches the internet. A request that fails while it
   * hasn't (no network, a captive portal, a network still coming up after a handover) failed
   * because the phone is offline, not because the server did.
   */
  fun online(): Boolean = capabilities()?.let {
    it.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && it.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
  } == true

  /**
   * The default network is the phone's mobile data, not Wi-Fi or a cable: a big download is the
   * owner's data plan (a quality replacement's card says so).
   */
  fun onMobileData(): Boolean = capabilities()?.let {
    it.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) &&
      !it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
      !it.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
  } == true

  private fun capabilities(): NetworkCapabilities? {
    val network = manager?.activeNetwork ?: return null
    return manager.getNetworkCapabilities(network)
  }
}
