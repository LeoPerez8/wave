package expo.modules.wavenative.account

import java.net.URLEncoder

internal object ProviderSignInUrls {
  fun ytMusic(email: String?): String = withHint(
    "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com",
    "Email",
    email,
  )

  fun spotify(email: String?): String = withHint(
    "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F",
    "login_hint",
    email,
  )

  private fun withHint(url: String, parameter: String, email: String?): String =
    if (email.isNullOrBlank()) url else "$url&$parameter=${URLEncoder.encode(email, "UTF-8")}"
}
