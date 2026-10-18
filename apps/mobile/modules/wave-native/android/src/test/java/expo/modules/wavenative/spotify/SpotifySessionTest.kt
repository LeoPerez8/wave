package expo.modules.wavenative.spotify

import expo.modules.wavenative.Fixtures
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class SpotifySessionTest {
  private val leo = SpotifyAccountInfo("Leo Perez", "https://i.scdn.co/image/leo", "leo")
  private val credentials = SpotifyCredentials("AQCookieValue")
  private val file = File(Fixtures.tempDir(), "spotify-session.json")

  private fun session() = SpotifySession(SpotifySessionStore(file))

  @Test
  fun theSignInPageHandsOverOnlyTheSpDcCookie() {
    assertEquals(
      SpotifyCredentials("AQCookieValue"),
      SpotifySignInPage.credentials("sp_t=device; sp_dc=AQCookieValue; sp_landing=x"),
    )
    assertNull("not signed in yet", SpotifySignInPage.credentials("sp_t=device; sp_landing=x"))
    assertNull(SpotifySignInPage.credentials(null))
    assertFalse("the cookie stays out of logs", credentials.toString().contains("AQCookieValue"))
  }

  @Test
  fun afterARestartWaveIsStillSignedIn() {
    session().signedIn(credentials, leo)
    assertEquals(SpotifySessionState.SignedIn(credentials, leo), session().state)
  }

  @Test
  fun aRejectedSessionExpiresKeepingOnlyTheAccountAndTellsListeners() {
    val session = session().apply { signedIn(credentials, leo) }
    val heard = mutableListOf<SpotifySessionState>()
    session.onChange = { heard += it }
    session.expire(credentials)
    assertEquals(SpotifySessionState.Expired(leo), session.state)
    assertEquals(listOf<SpotifySessionState>(SpotifySessionState.Expired(leo)), heard)
    assertEquals("still expired after a restart", SpotifySessionState.Expired(leo), session().state)
    assertFalse("the cookie is gone from the file", file.readText().contains("AQCookieValue"))
  }

  @Test
  fun aRejectionOfAnOlderSessionChangesNothing() {
    val session = session().apply { signedIn(credentials, leo) }
    val newer = SpotifyCredentials("AQNewer")
    session.signedIn(newer, leo)
    session.expire(credentials)
    assertEquals(SpotifySessionState.SignedIn(newer, leo), session.state)
  }

  @Test
  fun checkingPicksUpANewNameOrPhoto() {
    val session = session().apply { signedIn(credentials, leo) }
    val renamed = leo.copy(name = "Leonardo", photoUrl = null)
    session.checked(credentials, renamed)
    assertEquals(SpotifySessionState.SignedIn(credentials, renamed), session.state)
  }

  @Test
  fun signingOutDeletesTheFile() {
    val session = session().apply { signedIn(credentials, leo) }
    session.signOut()
    assertFalse(file.exists())
    assertEquals(SpotifySessionState.SignedOut, session().state)
  }

  @Test
  fun javascriptSeesTheAccountNeverTheCookie() {
    assertEquals(
      mapOf("status" to "signedIn", "account" to mapOf("name" to "Leo Perez", "photoUrl" to "https://i.scdn.co/image/leo")),
      SpotifySessionState.SignedIn(credentials, leo).toMap(),
    )
    assertEquals(mapOf("status" to "expired", "account" to null), SpotifySessionState.Expired(null).toMap())
  }
}
