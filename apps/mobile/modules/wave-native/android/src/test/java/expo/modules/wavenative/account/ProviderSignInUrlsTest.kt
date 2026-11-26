package expo.modules.wavenative.account

import org.junit.Assert.assertEquals
import org.junit.Test

class ProviderSignInUrlsTest {
  @Test fun googlePrefillsAnEncodedEmail() {
    assertEquals(
      "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com&Email=ana.souza%2Bwave%40example.com",
      ProviderSignInUrls.ytMusic("ana.souza+wave@example.com"),
    )
  }

  @Test fun spotifyPrefillsAnEncodedEmailAndContinuesToTheWebPlayer() {
    assertEquals(
      "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F&login_hint=ana.souza%2Bwave%40example.com",
      ProviderSignInUrls.spotify("ana.souza+wave@example.com"),
    )
  }

  @Test fun noEmailOpensTheSamePagesWithNoHint() {
    assertEquals(
      "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com",
      ProviderSignInUrls.ytMusic(null),
    )
    assertEquals(
      "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F",
      ProviderSignInUrls.spotify(null),
    )
  }
}
