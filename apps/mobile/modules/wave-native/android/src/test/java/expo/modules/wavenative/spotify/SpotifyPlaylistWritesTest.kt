package expo.modules.wavenative.spotify

import expo.modules.wavenative.Fixtures
import java.io.File
import java.net.URI
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SpotifyPlaylistWritesTest {
  private val playlist = "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"

  /** Spotify as these tests have it answer; every request it got, in order. */
  private class FakeSpotify : SpotifyHttp {
    val requests = mutableListOf<SpotifyRequest>()
    var tokens = 0
    var spclient: (SpotifyRequest) -> SpotifyResponse = { SpotifyResponse(200, "") }
    var query: (SpotifyRequest) -> SpotifyResponse = {
      SpotifyResponse(200, """{"data":{"me":{"profile":{"username":"leo vaz","name":"Leo"}}}}""")
    }

    override fun send(request: SpotifyRequest): SpotifyResponse {
      requests += request
      val url = URI(request.url)
      return when {
        url.path == "/api/server-time" -> SpotifyResponse(200, """{"serverTime":1792361453}""")
        url.path == "/api/token" -> {
          tokens += 1
          SpotifyResponse(200, """{"accessToken":"BQ$tokens","accessTokenExpirationTimestampMs":1792364794718,"isAnonymous":false}""")
        }
        url.path == "/pathfinder/v2/query" -> query(request)
        url.host == "spclient.wg.spotify.com" -> spclient(request)
        else -> SpotifyResponse(404, "")
      }
    }

    fun spclientRequests() = requests.filter { URI(it.url).host == "spclient.wg.spotify.com" }
    fun queries() = requests.filter { URI(it.url).path == "/pathfinder/v2/query" }
  }

  private val spotify = FakeSpotify()
  private val session = SpotifySession(SpotifySessionStore(File(Fixtures.tempDir(), "spotify-session.json")))
  private val client = SpotifyClient(session, spotify, clock = { 1_792_361_453_000L })
  private val writes = SpotifyPlaylistWrites(client)

  @Before
  fun signIn() {
    runBlocking { client.signIn(SpotifyCredentials("AQCookie")) }
    spotify.requests.clear()
  }

  private fun body(request: SpotifyRequest): JsonObject = Json.parseToJsonElement(request.body!!).jsonObject

  private fun variables(request: SpotifyRequest): JsonObject = body(request)["variables"]!!.jsonObject

  @Test
  fun creatingMakesThePlaylistPutsItInTheLibraryAndLetsAnyoneWithTheLinkOpenIt() {
    spotify.spclient = { request ->
      val path = URI(request.url).path
      when {
        path == "/playlist/v2/playlist" -> SpotifyResponse(200, """{"uri":"$playlist","revision":"AAA"}""")
        path.endsWith("/permission/base") && request.method == "GET" ->
          SpotifyResponse(200, """{"permissionLevel":"BLOCKED","revision":"r1"}""")
        else -> SpotifyResponse(200, "{}")
      }
    }
    val uri = runBlocking { writes.create("Road Trip") }
    assertEquals(playlist, uri)
    val sent = spotify.spclientRequests()
    assertEquals(
      listOf(
        "POST /playlist/v2/playlist",
        "POST /playlist/v2/user/leo%20vaz/rootlist/changes",
        "POST /playlist/v2/user/leo%20vaz/rootlist/changes",
        "GET /playlist-permission/v1/playlist/37i9dQZF1DXcBWIGoYBM5M/permission/base",
        "POST /playlist-permission/v1/playlist/37i9dQZF1DXcBWIGoYBM5M/permission/base",
      ),
      sent.map { "${it.method} ${URI(it.url).rawPath}" },
    )
    assertTrue(sent.all { it.headers["Authorization"] == "Bearer BQ1" })
    assertTrue(sent[0].body!!.contains(""""name":"Road Trip""""))
    val add = body(sent[1])["deltas"]!!.jsonArray[0].jsonObject["ops"]!!.jsonArray[0].jsonObject
    assertEquals("ADD", add["kind"]!!.jsonPrimitive.content)
    assertTrue(add.toString().contains(playlist))
    assertTrue(sent[2].body!!.contains(""""public":true"""))
    val permission = body(sent[4])
    assertEquals("VIEWER", permission["permissionLevel"]!!.jsonPrimitive.content)
    assertEquals("r1", permission["revision"]!!.jsonPrimitive.content)
  }

  @Test
  fun renamingChangesTheListsName() {
    runBlocking { writes.rename(playlist, "Road Trip 2") }
    val sent = spotify.spclientRequests().single()
    assertEquals("/playlist/v2/playlist/37i9dQZF1DXcBWIGoYBM5M/changes", URI(sent.url).path)
    assertTrue(sent.body!!.contains("UPDATE_LIST_ATTRIBUTES") && sent.body!!.contains(""""name":"Road Trip 2""""))
  }

  @Test
  fun songsAreAddedRemovedAndMovedWithTheWebPlayersMutations() {
    spotify.query = { SpotifyResponse(200, """{"data":{}}""") }
    runBlocking {
      writes.add(playlist, listOf("spotify:track:a", "spotify:track:b"))
      writes.remove(playlist, listOf("u1"))
      writes.move(playlist, "u2", before = "u3")
      writes.move(playlist, "u4", before = null)
    }
    val (add, remove, move, last) = spotify.queries()
    assertEquals("addToPlaylist", body(add)["operationName"]!!.jsonPrimitive.content)
    assertEquals(
      """{"playlistUri":"$playlist","playlistItemUris":["spotify:track:a","spotify:track:b"],"newPosition":{"moveType":"BOTTOM_OF_PLAYLIST","fromUid":null},"interactionId":null}""",
      variables(add).toString(),
    )
    assertEquals("removeFromPlaylist", body(remove)["operationName"]!!.jsonPrimitive.content)
    assertEquals("""{"playlistUri":"$playlist","uids":["u1"]}""", variables(remove).toString())
    assertEquals("moveItemsInPlaylist", body(move)["operationName"]!!.jsonPrimitive.content)
    assertEquals(
      """{"playlistUri":"$playlist","uids":["u2"],"newPosition":{"moveType":"BEFORE_UID","fromUid":"u3"}}""",
      variables(move).toString(),
    )
    assertEquals(
      """{"playlistUri":"$playlist","uids":["u4"],"newPosition":{"moveType":"BOTTOM_OF_PLAYLIST","fromUid":null}}""",
      variables(last).toString(),
    )
  }

  @Test
  fun searchingAndReadingAnswerTheQuerysDataForCoreToRead() {
    spotify.query = { SpotifyResponse(200, """{"data":{"searchV2":{"tracksV2":{"items":[]}}}}""") }
    val data = runBlocking { writes.search("Get Lucky Daft Punk") }
    assertEquals("""{"searchV2":{"tracksV2":{"items":[]}}}""", data)
    val sent = spotify.queries().single()
    assertEquals("searchTracks", body(sent)["operationName"]!!.jsonPrimitive.content)
    assertEquals("Get Lucky Daft Punk", variables(sent)["searchTerm"]!!.jsonPrimitive.content)
    runBlocking {
      writes.playlistPage(playlist, offset = 500)
      writes.libraryPage(offset = 50)
    }
    val (_, page, library) = spotify.queries()
    assertEquals("fetchPlaylist", body(page)["operationName"]!!.jsonPrimitive.content)
    assertEquals("500", variables(page)["offset"]!!.jsonPrimitive.content)
    assertEquals(playlist, variables(page)["uri"]!!.jsonPrimitive.content)
    assertEquals("libraryV3", body(library)["operationName"]!!.jsonPrimitive.content)
    assertEquals("50", variables(library)["offset"]!!.jsonPrimitive.content)
  }

  @Test
  fun anExpiredTokenGetsOneNewOneForSpclientToo() {
    var calls = 0
    spotify.spclient = { calls += 1; if (calls == 1) SpotifyResponse(401, "") else SpotifyResponse(200, "{}") }
    runBlocking { writes.rename(playlist, "Road Trip") }
    val sent = spotify.spclientRequests()
    assertEquals(listOf("Bearer BQ1", "Bearer BQ2"), sent.map { it.headers["Authorization"] })
  }

  @Test
  fun aRequestSpotifyRefusesFails() {
    spotify.spclient = { SpotifyResponse(403, "") }
    val failure = try {
      runBlocking { writes.rename(playlist, "Road Trip") }
      null
    } catch (e: SpotifyException) {
      e.failure
    }
    assertEquals(SpotifyFailure.FAILED, failure)
  }
}
