package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class YtSessionStoreTest {
  private val leo = YtAccountInfo("Leo Perez", "leo@example.com", "https://yt3.ggpht.com/leo=s88")
  private val credentials = YtCredentials("SAPISID=sap/123; SID=sid", dataSyncId = "UCdatasync", authUser = "1")

  private fun file() = File(Fixtures.tempDir(), "yt-session.json")

  @Test
  fun aSignedInSessionSurvivesRestarting() {
    val file = file()
    YtSessionStore(file).save(YtSessionState.SignedIn(credentials, leo))
    assertEquals(YtSessionState.SignedIn(credentials, leo), YtSessionStore(file).load())
  }

  @Test
  fun anExpiredSessionIsRememberedWithoutItsCookie() {
    val file = file()
    val store = YtSessionStore(file)
    store.save(YtSessionState.SignedIn(credentials, leo))
    store.save(YtSessionState.Expired(leo))
    assertEquals(YtSessionState.Expired(leo), YtSessionStore(file).load())
    assertFalse(file.readText().contains("sap/123"))
  }

  @Test
  fun signingOutLeavesNothingBehind() {
    val file = file()
    val store = YtSessionStore(file)
    store.save(YtSessionState.SignedIn(credentials, leo))
    store.save(YtSessionState.SignedOut)
    assertFalse(file.exists())
    assertEquals(YtSessionState.SignedOut, store.load())
  }

  @Test
  fun aMissingOrDamagedFileIsSignedOut() {
    val file = file()
    assertEquals(YtSessionState.SignedOut, YtSessionStore(file).load())
    for (damaged in listOf("", "{", "[]", """{"cookie":"SAPISID=x"}""", """{"expired":"yes"}""")) {
      file.writeText(damaged)
      assertEquals(damaged, YtSessionState.SignedOut, YtSessionStore(file).load())
    }
  }
}
