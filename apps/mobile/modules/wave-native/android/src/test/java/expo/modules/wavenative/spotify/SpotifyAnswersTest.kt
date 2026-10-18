package expo.modules.wavenative.spotify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SpotifyAnswersTest {
  private val signedInToken =
    """{"clientId":"d8a5ed958d274c2e8ee717e6a4b0971d","accessToken":"BQsecret","accessTokenExpirationTimestampMs":1792364794718,"isAnonymous":false}"""

  @Test
  fun aTokenAnswerCarriesTheTokenAndWhenItExpires() {
    val answer = SpotifyTokenAnswer.read(200, signedInToken) as SpotifyTokenAnswer.Token
    assertEquals(SpotifyToken("BQsecret", 1_792_364_794_718, anonymous = false), answer.token)
    assertFalse(answer.secretStale)
    assertFalse("the token stays out of logs", answer.token.toString().contains("BQsecret"))
  }

  @Test
  fun aTokenIsUsedUntilAMinuteBeforeItExpires() {
    val token = SpotifyToken("BQ", expiresAtMs = 1_000_000, anonymous = false)
    assertTrue(token.usableAt(1_000_000 - 60_001))
    assertFalse(token.usableAt(1_000_000 - 60_000))
  }

  @Test
  fun aStaleSecretVersionStillGivesATokenButAsksForANewSecret() {
    val body = signedInToken.dropLast(1) + ""","totpVerExpired":"error","totpValidUntil":"2025-10-18T09:00:00.000Z"}"""
    val answer = SpotifyTokenAnswer.read(200, body) as SpotifyTokenAnswer.Token
    assertTrue(answer.secretStale)
  }

  @Test
  fun a401MeansSpotifyNoLongerAcceptsTheCookie() {
    assertEquals(SpotifyTokenAnswer.Rejected, SpotifyTokenAnswer.read(401, """{"error":{"code":401,"message":"Unauthorized"}}"""))
  }

  @Test
  fun a400MeansTheSecretChangedNotTheSession() {
    assertEquals(SpotifyTokenAnswer.Changed, SpotifyTokenAnswer.read(400, """{"error":{"code":400,"message":"Unauthorized request"}}"""))
  }

  @Test
  fun aServerErrorSaysNothingAboutTheSession() {
    assertThrows(Exception::class.java) { SpotifyTokenAnswer.read(503, "") }
    assertThrows(Exception::class.java) { SpotifyTokenAnswer.read(200, "<html>") }
  }

  @Test
  fun theProfileGivesTheNameTheLargestPhotoAndTheUsername() {
    val body = """{"data":{"me":{"profile":{"uri":"spotify:user:leo","username":"leo","name":"Leo Perez",
      "avatar":{"sources":[{"url":"https://i.scdn.co/image/large","width":300,"height":300},{"url":"https://i.scdn.co/image/small","width":64,"height":64}]}}}}}"""
    val data = (SpotifyQueryAnswer.read(200, body) as SpotifyQueryAnswer.Data).data
    assertEquals(SpotifyAccountInfo("Leo Perez", "https://i.scdn.co/image/large", "leo"), SpotifyAccountInfo.fromProfile(data))
  }

  @Test
  fun aProfileWithoutANameOrPhotoGoesByItsUsername() {
    val body = """{"data":{"me":{"profile":{"username":"31abc","name":"","avatar":null}}}}"""
    val data = (SpotifyQueryAnswer.read(200, body) as SpotifyQueryAnswer.Data).data
    assertEquals(SpotifyAccountInfo("31abc", null, "31abc"), SpotifyAccountInfo.fromProfile(data))
  }

  @Test
  fun notAuthorizedMeansTheTokenIsAnonymous() {
    val body = """{"data":{"me":null},"errors":[{"message":"Exception while fetching data (/me) : User is not authorized","path":["me"]}]}"""
    assertEquals(SpotifyQueryAnswer.NotSignedIn, SpotifyQueryAnswer.read(200, body))
  }

  @Test
  fun anUnknownHashOrOtherErrorsMeanSpotifyChangedSomething() {
    assertEquals(SpotifyQueryAnswer.Changed, SpotifyQueryAnswer.read(412, """{"errors":[{"message":"Invalid query hash"}]}"""))
    assertEquals(
      SpotifyQueryAnswer.Changed,
      SpotifyQueryAnswer.read(200, """{"data":null,"errors":[{"message":"Validation error of type FieldUndefined"}]}"""),
    )
  }

  @Test
  fun a401ToTheTokenAsksForANewToken() {
    assertEquals(
      SpotifyQueryAnswer.TokenExpired,
      SpotifyQueryAnswer.read(401, """{"error":{"status":401,"message":"Missing/invalid/expired access token"}}"""),
    )
  }
}

