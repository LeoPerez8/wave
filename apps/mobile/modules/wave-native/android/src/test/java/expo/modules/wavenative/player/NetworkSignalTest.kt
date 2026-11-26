package expo.modules.wavenative.player

import org.junit.Assert.*
import org.junit.Test

/** Same inputs and answers as Core's public networkSignal tests. */
class NetworkSignalTest {
  private val now = 10_000L
  private fun signal(waiting: Boolean = false, loadingFor: Long? = null, cut: Boolean = false, ranOut: Boolean = false, online: Boolean = true) =
    NetworkSignalPolicy.signal(waiting, loadingFor?.let { now - it }, cut, ranOut, online, now)

  @Test fun aSongThatPlaysOrIsPausedByHandShowsNothing() {
    assertEquals(NetworkSignal.PLAYING, signal())
    assertEquals(NetworkSignal.PLAYING, signal(online = false))
  }

  @Test fun theWaitIsOffline() {
    assertEquals(NetworkSignal.OFFLINE, signal(waiting = true, online = false))
    assertEquals(NetworkSignal.OFFLINE, signal(waiting = true))
  }

  @Test fun loadingWaitsOutTheGraceBeforeSlow() {
    assertEquals(NetworkSignal.PLAYING, signal(loadingFor = 0))
    assertEquals(NetworkSignal.PLAYING, signal(loadingFor = 1_499))
    assertEquals(NetworkSignal.SLOW, signal(loadingFor = 1_500))
    assertEquals(NetworkSignal.OFFLINE, signal(loadingFor = 1_500, online = false))
  }

  @Test fun theSongLoadingAgainAfterTheCutIsSlowAtOnce() {
    assertEquals(NetworkSignal.SLOW, signal(loadingFor = 0, cut = true))
    assertEquals(NetworkSignal.OFFLINE, signal(loadingFor = 0, cut = true, online = false))
  }

  @Test fun afterTheWaitThePausedSongIsBackOnlineAndOfflineWithout() {
    assertEquals(NetworkSignal.BACK, signal(cut = true, ranOut = true))
    assertEquals(NetworkSignal.OFFLINE, signal(cut = true, ranOut = true, online = false))
  }

  @Test fun aPauseByHandDuringTheWaitIsANormalPause() {
    assertEquals(NetworkSignal.PLAYING, signal(cut = true))
    assertEquals(NetworkSignal.PLAYING, signal(cut = true, online = false))
  }

  @Test fun theGraceAsksForALookWhenItEnds() {
    assertEquals(1_000L, NetworkSignalPolicy.recheckInMs(false, now - 500, false, now))
    assertNull(NetworkSignalPolicy.recheckInMs(false, null, false, now))
    assertNull(NetworkSignalPolicy.recheckInMs(false, now - 1_500, false, now))
    assertNull(NetworkSignalPolicy.recheckInMs(true, now - 500, false, now))
    assertNull(NetworkSignalPolicy.recheckInMs(false, now - 500, true, now))
  }

  @Test fun theNotificationSaysNoInternetOrSlowConnection() {
    assertEquals("noInternet", NetworkSignalPolicy.subTextKey(NetworkSignal.OFFLINE))
    assertEquals("slowConnection", NetworkSignalPolicy.subTextKey(NetworkSignal.SLOW))
    assertNull(NetworkSignalPolicy.subTextKey(NetworkSignal.PLAYING))
    assertNull(NetworkSignalPolicy.subTextKey(NetworkSignal.BACK))
  }
}
