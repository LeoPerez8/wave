package expo.modules.wavenative.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectivityCacheTest {
  private val validatedWifi = NetworkFacts(internet = true, validated = true, cellular = false, wifi = true, ethernet = false)
  private val validatedMobile = validatedWifi.copy(cellular = true, wifi = false)
  private val captivePortal = validatedWifi.copy(validated = false)

  @Test
  fun `a validated network with internet is online, mobile data only without Wi-Fi or a cable`() {
    assertEquals(ConnectivityState(hasNetwork = true, online = true, onMobileData = false), ConnectivityState.of(validatedWifi))
    assertEquals(ConnectivityState(hasNetwork = true, online = true, onMobileData = true), ConnectivityState.of(validatedMobile))
    assertFalse(ConnectivityState.of(validatedMobile.copy(wifi = true)).onMobileData)
    assertFalse(ConnectivityState.of(validatedMobile.copy(ethernet = true)).onMobileData)
  }

  @Test
  fun `a network Android hasn't validated has a network but isn't online, and no network is offline`() {
    assertEquals(ConnectivityState(hasNetwork = true, online = false, onMobileData = false), ConnectivityState.of(captivePortal))
    assertEquals(ConnectivityState(hasNetwork = false, online = false, onMobileData = false), ConnectivityState.of(null))
  }

  @Test
  fun `the cache answers its last state and tells its listener only of changes`() {
    val heard = mutableListOf<ConnectivityState>()
    val cache = ConnectivityCache(ConnectivityState.of(validatedWifi))
    cache.listen { heard.add(it) }
    assertTrue(cache.current.online)

    cache.update(ConnectivityState.of(validatedWifi))
    cache.update(ConnectivityState.of(captivePortal))
    cache.update(ConnectivityState.of(captivePortal))
    cache.update(ConnectivityState.of(null))
    cache.update(ConnectivityState.of(validatedMobile))

    assertEquals(
      listOf(ConnectivityState.of(captivePortal), ConnectivityState.of(null), ConnectivityState.of(validatedMobile)),
      heard,
    )
    assertEquals(ConnectivityState.of(validatedMobile), cache.current)
  }
}
