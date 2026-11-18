package expo.modules.wavenative.yt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** What the sign-in web view hands over once YouTube Music opens signed in. */
class YtSignInPageTest {
  private val cookie = "YSC=abc; SAPISID=sap/123; __Secure-3PAPISID=sap/123; SID=sid; LOGIN_INFO=info"

  /** What `evaluateJavascript` passes back for [YtSignInPage.CONFIG_SCRIPT]: a JSON string of JSON. */
  private fun evaluated(json: String) = "\"" + json.replace("\"", "\\\"") + "\""

  @Test
  fun takesTheCookieAndThePagesAccountFromYouTubeMusicSignedIn() {
    assertEquals(
      YtCredentials(cookie = cookie, dataSyncId = "UCdatasync", authUser = "1"),
      YtSignInPage.credentials(cookie, evaluated("""{"dataSyncId":"UCdatasync||117","sessionIndex":"1"}""")),
    )
  }

  @Test
  fun untilGoogleSetsTheSignedInCookieThereIsNoSession() {
    val config = evaluated("""{"dataSyncId":null,"sessionIndex":"0"}""")
    for (anonymous in listOf(null, "", "YSC=abc; VISITOR_INFO1_LIVE=xyz; PREF=hl=en")) {
      assertNull("$anonymous", YtSignInPage.credentials(anonymous, config))
    }
  }

  @Test
  fun anySignedInCookieCountsNotJustTheLegacyOne() {
    val secureOnly = "YSC=abc; __Secure-3PAPISID=sap/123; __Secure-3PSID=sid"
    assertEquals(secureOnly, YtSignInPage.credentials(secureOnly, null)?.cookie)
  }

  @Test
  fun withoutTheAccountOnThePageItsTheFirstAccountsMainChannel() {
    for (config in listOf(null, "null", evaluated("{}"), "\"not json\"", evaluated("""{"sessionIndex":"x1"}"""))) {
      assertEquals("$config", YtCredentials(cookie, dataSyncId = null, authUser = "0"), YtSignInPage.credentials(cookie, config))
    }
  }

  @Test
  fun credentialsNeverPrintTheCookie() {
    val printed = YtSignInPage.credentials(cookie, null).toString()
    assertFalse(printed, printed.contains("SAPISID") || printed.contains("sap/123"))
  }
}
