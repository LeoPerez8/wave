package expo.modules.wavenative.tags

import java.net.CookieManager
import java.net.CookiePolicy
import java.net.URI
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.JavaNetCookieJar
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Fix Song looks songs up with React Native's `fetch`, which is
 * OkHttp with a `JavaNetCookieJar` in front of the system cookie store. Deezer
 * sets cookies on its first answer, so the album request after a track search
 * carries them, and so does every later Deezer request (they last six months).
 *
 * The test classpath resolves OkHttp the way the app does: React Native's
 * cookie jar (okhttp-urlconnection) next to the OkHttp that YT Music's ktor
 * client raises it to. When those disagreed, loading the cookies threw
 * `NoClassDefFoundError: okhttp3/internal/Util` on OkHttp's thread and Android
 * closed Wave (#119).
 */
class LookupCookiesTest {
  @Test
  fun deezerRequestsCarryTheCookiesItsSearchSet() {
    val cookies = CookieManager(null, CookiePolicy.ACCEPT_ALL)
    // What Deezer's track search answers with, as React Native's cookie store keeps it.
    cookies.put(
      URI("https://api.deezer.com/search/track?q=Radiohead%20Creep&limit=25"),
      mapOf("Set-Cookie" to listOf("dzr_uniq_id=dzr_uniq_id_fr64f4a4; Max-Age=15552000; path=/; domain=.deezer.com; secure")),
    )
    val jar = JavaNetCookieJar(cookies)

    val sent = jar.loadForRequest("https://api.deezer.com/album/14879699".toHttpUrl())

    assertEquals(listOf("dzr_uniq_id" to "dzr_uniq_id_fr64f4a4"), sent.map { it.name to it.value })
  }
}
