package expo.modules.wavenative.yt

import expo.modules.wavenative.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * WEB_REMIX `account/account_menu` answers: a real signed-out one, and a
 * signed-in one built from it with the account header innertubex's
 * `AccountMenuResponse` reads (`fixtures/yt`).
 */
class YtAccountMenuTest {
  private fun fixture(name: String) = Fixtures.file("yt/$name").readText()

  @Test
  fun readsTheSignedInAccountsNameEmailAndLargestPicture() {
    assertEquals(
      YtAccountMenu.SignedIn(
        YtAccountInfo(
          name = "Leo Perez",
          email = "leo@example.com",
          photoUrl = "https://yt3.ggpht.com/ytc/leo=s88-c-k-c0x00ffffff-no-rj",
        ),
      ),
      YtAccountMenu.read(200, fixture("account-menu-signed-in.json")),
    )
  }

  @Test
  fun aMenuWithoutAnAccountIsSignedOut() {
    assertEquals(YtAccountMenu.SignedOut, YtAccountMenu.read(200, fixture("account-menu-signed-out.json")))
  }

  @Test
  fun aSessionYouTubeRejectsIsSignedOut() {
    for (status in listOf(401, 403)) {
      assertEquals("HTTP $status", YtAccountMenu.SignedOut, YtAccountMenu.read(status, """{"error":{"code":$status}}"""))
    }
  }

  @Test
  fun aServerErrorOrAnUnreadableAnswerSaysNothingAboutTheSession() {
    for ((status, body) in listOf(503 to "", 200 to "<html>", 200 to """{"responseContext":{}}""")) {
      assertThrows("HTTP $status $body", Exception::class.java) { YtAccountMenu.read(status, body) }
    }
  }
}
