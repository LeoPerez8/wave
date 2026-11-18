package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import java.io.File
import java.net.UnknownHostException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class YtSessionTest {
  private val leo = YtAccountInfo("Leo Perez", "leo@example.com", "https://yt3.ggpht.com/leo=s88")
  private val credentials = YtCredentials("SAPISID=sap/123; SID=sid", dataSyncId = "UCdatasync", authUser = "1")
  private val file = File(Fixtures.tempDir(), "yt-session.json")

  /** What requests go out with: the credentials last handed to innertubex. */
  private var sentWith: YtCredentials? = null

  /** YouTube refusing the credentials, as innertubex reports it (HTTP 401). */
  private class Rejected : Exception("search failed with HTTP 401")

  private fun session() = YtSession(YtSessionStore(file), rejects = { it is Rejected }) { sentWith = it }

  @Test
  fun afterARestartRequestsGoOutAsTheSignedInAccount() {
    session().signedIn(credentials, leo)
    sentWith = null
    val restarted = session()
    assertEquals(credentials, sentWith)
    assertEquals(YtSessionState.SignedIn(credentials, leo), restarted.state)
  }

  @Test
  fun aSessionYouTubeRejectsExpiresAndRequestsGoOutSignedOut() {
    val session = session().apply { signedIn(credentials, leo) }
    val heard = mutableListOf<YtSessionState>()
    session.onChange = { heard += it }

    assertTrue(session.expireIfRejected(IllegalStateException("wrapped", Rejected())))
    assertEquals(YtSessionState.Expired(leo), session.state)
    assertNull(sentWith)
    assertEquals(listOf<YtSessionState>(YtSessionState.Expired(leo)), heard)
    assertEquals("still expired after a restart", YtSessionState.Expired(leo), session().state)
  }

  @Test
  fun onceSignedOutARejectionIsJustAFailure() {
    val session = session()
    assertFalse(session.expireIfRejected(Rejected()))
    session.signedIn(credentials, leo)
    session.expireIfRejected(Rejected())
    assertFalse("no second expiry", session.expireIfRejected(Rejected()))
  }

  @Test
  fun otherFailuresLeaveTheAccountSignedIn() {
    val session = session().apply { signedIn(credentials, leo) }
    for (error in listOf(IllegalStateException("search failed with HTTP 503"), UnknownHostException("music.youtube.com"))) {
      assertFalse("$error", session.expireIfRejected(error))
    }
    assertEquals(YtSessionState.SignedIn(credentials, leo), session.state)
    assertEquals(credentials, sentWith)
  }

  @Test
  fun checkingTheAccountPicksUpANewNameOrPicture() {
    val session = session().apply { signedIn(credentials, leo) }
    val renamed = leo.copy(name = "Leonardo Perez", photoUrl = "https://yt3.ggpht.com/new=s88")
    session.checked(credentials, YtAccountMenu.SignedIn(renamed))
    assertEquals(YtSessionState.SignedIn(credentials, renamed), session().state)
  }

  @Test
  fun anAccountMenuWithoutTheAccountExpiresTheSession() {
    val session = session().apply { signedIn(credentials, leo) }
    session.checked(credentials, YtAccountMenu.SignedOut)
    assertEquals(YtSessionState.Expired(leo), session.state)
    assertNull(sentWith)
  }

  @Test
  fun anAnswerAboutAnEarlierSessionChangesNothing() {
    val session = session().apply { signedIn(credentials, leo) }
    val earlier = credentials.copy(cookie = "SAPISID=old")
    session.checked(earlier, YtAccountMenu.SignedOut)
    assertEquals(YtSessionState.SignedIn(credentials, leo), session.state)
  }

  @Test
  fun jsSeesWhoIsSignedInButNeverTheCookie() {
    assertEquals(
      mapOf("status" to "signedIn", "account" to leo.toMap()),
      YtSessionState.SignedIn(credentials, leo).toMap(),
    )
    assertEquals(mapOf("status" to "expired", "account" to null), YtSessionState.Expired(null).toMap())
    assertEquals(mapOf("status" to "signedOut"), YtSessionState.SignedOut.toMap())
  }

  @Test
  fun signingOutForgetsTheSession() {
    val session = session().apply { signedIn(credentials, leo) }
    val heard = mutableListOf<YtSessionState>()
    session.onChange = { heard += it }
    session.signOut()
    assertEquals(YtSessionState.SignedOut, session.state)
    assertNull(sentWith)
    assertFalse(file.exists())
    assertEquals(listOf<YtSessionState>(YtSessionState.SignedOut), heard)
  }
}
