package expo.modules.wavenative.spotify

import expo.modules.wavenative.Fixtures
import java.io.File
import java.net.URI
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SpotifyClientTest {
  private val leo = SpotifyAccountInfo("Leo Perez", null, "leo")
  private val credentials = SpotifyCredentials("AQCookieValue")
  private val profile = """{"data":{"me":{"profile":{"username":"leo","name":"Leo Perez","avatar":null}}}}"""
  private var now = 1_792_361_453_000L

  /** Spotify as these tests have it answer; every request it got, in order. */
  private class FakeSpotify : SpotifyHttp {
    val requests = mutableListOf<SpotifyRequest>()
    var token: (SpotifyRequest) -> SpotifyResponse = { SpotifyResponse(200, tokenBody(anonymous = false)) }
    var query: (SpotifyRequest) -> SpotifyResponse = { SpotifyResponse(500, "") }
    var bundle = "no secret"

    override fun send(request: SpotifyRequest): SpotifyResponse {
      requests += request
      val url = URI(request.url)
      return when {
        url.path == "/api/server-time" -> SpotifyResponse(200, """{"serverTime":1792361453}""")
        url.path == "/api/token" -> token(request)
        url.host == "open.spotify.com" && url.path == "/" ->
          SpotifyResponse(200, """<script src="https://open.spotifycdn.com/cdn/build/web-player/web-player.abc123.js"></script>""")
        url.path.endsWith("web-player.abc123.js") -> SpotifyResponse(200, bundle)
        url.path == "/pathfinder/v2/query" -> query(request)
        else -> SpotifyResponse(404, "")
      }
    }

    fun count(path: String) = requests.count { URI(it.url).path == path }

    companion object {
      fun tokenBody(anonymous: Boolean, token: String = "BQtoken", expiresAt: Long = 1_792_364_794_718) =
        """{"accessToken":"$token","accessTokenExpirationTimestampMs":$expiresAt,"isAnonymous":$anonymous}"""
    }
  }

  private val spotify = FakeSpotify().apply { query = { SpotifyResponse(200, profile) } }
  private val session = SpotifySession(SpotifySessionStore(File(Fixtures.tempDir(), "spotify-session.json")))
  private var network = true
  private val client = SpotifyClient(session, spotify, clock = { now }, hasNetwork = { network }, online = { network })

  private fun failure(block: suspend () -> Unit): SpotifyFailure {
    try {
      runBlocking { block() }
    } catch (e: SpotifyException) {
      return e.failure
    }
    fail("expected a SpotifyException")
    error("unreachable")
  }

  private fun signedIn() = runBlocking { client.signIn(credentials) }

  @Test
  fun signingInAsksForATokenWithTheCookieAndTheTotpThenReadsTheProfile() {
    assertEquals(SpotifySessionState.SignedIn(credentials, leo), signedIn())
    val token = spotify.requests.first { URI(it.url).path == "/api/token" }
    assertEquals("sp_dc=AQCookieValue", token.headers["Cookie"])
    val query = URI(token.url).query
    assertTrue(query, query.contains("totp=103443") && query.contains("totpServer=103443") && query.contains("totpVer=61"))
    val profileQuery = spotify.requests.last()
    assertEquals("Bearer BQtoken", profileQuery.headers["Authorization"])
    assertTrue(profileQuery.body!!.contains("profileAttributes"))
  }

  @Test
  fun aCookieSpotifyDoesntAcceptIsAFailedSignIn() {
    spotify.token = { SpotifyResponse(401, "") }
    assertEquals(SpotifyFailure.FAILED, failure { client.signIn(credentials) })
    spotify.token = { SpotifyResponse(200, FakeSpotify.tokenBody(anonymous = true)) }
    assertEquals(SpotifyFailure.FAILED, failure { client.signIn(credentials) })
    assertEquals(SpotifySessionState.SignedOut, session.state)
  }

  @Test
  fun aSessionSpotifyStopsAcceptingExpiresOnceWithoutAnErrorLoop() {
    signedIn()
    now += 3_600_000
    spotify.token = { SpotifyResponse(401, "") }
    assertEquals(SpotifyFailure.SIGNED_OUT, failure { client.query(SpotifyOperation.PROFILE, JsonObject(emptyMap())) })
    assertEquals(SpotifySessionState.Expired(leo), session.state)
    val sent = spotify.requests.size
    assertEquals(SpotifyFailure.SIGNED_OUT, failure { client.query(SpotifyOperation.PROFILE, JsonObject(emptyMap())) })
    assertEquals("nothing more is sent", sent, spotify.requests.size)
  }

  @Test
  fun theTokenIsReusedUntilAMinuteBeforeItExpires() {
    signedIn()
    runBlocking { client.query(SpotifyOperation.PROFILE, JsonObject(emptyMap())) }
    assertEquals(1, spotify.count("/api/token"))
    now = 1_792_364_794_718 - 60_000
    runBlocking { client.query(SpotifyOperation.PROFILE, JsonObject(emptyMap())) }
    assertEquals(2, spotify.count("/api/token"))
  }

  @Test
  fun aTokenSpotifyCallsExpiredIsReplacedOnce() {
    signedIn()
    var answers = listOf(SpotifyResponse(401, ""), SpotifyResponse(200, profile))
    spotify.query = { answers.first().also { answers = answers.drop(1) } }
    runBlocking { client.query(SpotifyOperation.PROFILE, JsonObject(emptyMap())) }
    assertEquals(2, spotify.count("/api/token"))
  }

  @Test
  fun aRotatedSecretIsReadFromTheWebPlayerAndTheTokenAskedForAgain() {
    spotify.bundle = """x=[{secret:"abcdef",version:62}]"""
    spotify.token = { request ->
      if (URI(request.url).query.contains("totpVer=62")) SpotifyResponse(200, FakeSpotify.tokenBody(anonymous = false))
      else SpotifyResponse(400, """{"error":{"code":400,"message":"Unauthorized request"}}""")
    }
    assertEquals(SpotifySessionState.SignedIn(credentials, leo), signedIn())
  }

  @Test
  fun whenTheWebPlayerHasNoNewSecretWaveNeedsAnUpdateAndStaysSignedIn() {
    signedIn()
    now += 3_600_000
    spotify.token = { SpotifyResponse(400, "") }
    spotify.bundle = """x=[{secret:",7/*F(\"rLJ2oxaKL^f+E1xvP@N",version:61}]"""
    assertEquals(SpotifyFailure.CHANGED, failure { client.query(SpotifyOperation.PROFILE, JsonObject(emptyMap())) })
    assertEquals(SpotifySessionState.SignedIn(credentials, leo), session.state)
    val reads = spotify.count("/")
    assertEquals(SpotifyFailure.CHANGED, failure { client.query(SpotifyOperation.PROFILE, JsonObject(emptyMap())) })
    assertEquals("the web player is read once per run", reads, spotify.count("/"))
  }

  @Test
  fun anUnknownQueryHashIsReadFromTheWebPlayer() {
    signedIn()
    spotify.bundle = """a("profileAttributes","query","${"f".repeat(64)}")"""
    spotify.query = { request ->
      if (request.body!!.contains("f".repeat(64))) SpotifyResponse(200, profile) else SpotifyResponse(412, "")
    }
    runBlocking { client.query(SpotifyOperation.PROFILE, JsonObject(emptyMap())) }
  }

  @Test
  fun offlineNothingIsSent() {
    network = false
    assertEquals(SpotifyFailure.OFFLINE, failure { client.signIn(credentials) })
    assertEquals(0, spotify.requests.size)
  }

  @Test
  fun checkingTheSessionPicksUpANewNameAndAnswersNothingElseWhenSpotifyFails() {
    signedIn()
    spotify.query = { SpotifyResponse(200, profile.replace("Leo Perez", "Leonardo")) }
    assertEquals(SpotifySessionState.SignedIn(credentials, leo.copy(name = "Leonardo")), runBlocking { client.checkSession() })
    spotify.query = { SpotifyResponse(503, "") }
    assertEquals(SpotifySessionState.SignedIn(credentials, leo.copy(name = "Leonardo")), runBlocking { client.checkSession() })
  }
}
