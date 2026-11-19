package dev.leoperez.wave.stdio

import expo.modules.wavenative.Fixtures
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import java.net.UnknownHostException
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The desktop's JVM over JSON lines, as Electron drives it: the shared Kotlin behind each method. */
class WaveDesktopTest {
  /** YouTube Music answering every request with [fixture], or failing as [failure]. */
  private fun youTube(fixture: String? = null, failure: Throwable? = null): YtHttp = { _, _ ->
    HttpClient(
      MockEngine {
        failure?.let { throw it }
        respond(
          Fixtures.file(fixture!!).readText(),
          headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
        )
      },
    ) {
      expectSuccess = false
      install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }) }
    }
  }

  private fun desktop(http: YtHttp = youTube("yt/search-songs.json"), online: Boolean = true): Pair<Host, WaveDesktop> {
    val host = Host()
    return host to WaveDesktop(host.lines, Fixtures.tempDir(), http = http, online = { online })
  }

  private fun withDesktop(http: YtHttp = youTube("yt/search-songs.json"), online: Boolean = true, block: (Host) -> Unit) {
    val (host, desktop) = desktop(http, online)
    withHost(desktop::handle, host) { block(it) }
  }

  private fun JsonObject.code() = this["error"]!!.jsonObject["code"]!!.jsonPrimitive.content

  @Test
  fun answersATagReadWithTheFilesTags() = withDesktop { host ->
    val path = Json.encodeToString(String.serializer(), Fixtures.file("tagged.mp3").absolutePath)
    host.write("""{"id":1,"method":"readTags","params":{"path":$path}}""")
    val tags = host.next()["result"]!!.jsonObject
    assertEquals("Wave Fixture", tags["title"]!!.jsonPrimitive.content)
    assertEquals("Fixture Artist", tags["artist"]!!.jsonPrimitive.content)
    assertEquals("Fixture Album", tags["album"]!!.jsonPrimitive.content)
    assertTrue(tags["durationMs"]!!.jsonPrimitive.content.toDouble() > 0)
    val cover = java.util.Base64.getDecoder().decode(tags["artworkBase64"]!!.jsonPrimitive.content)
    assertTrue(cover.size > 100)
    assertEquals(0x89.toByte(), cover[0])
    assertEquals(0x50.toByte(), cover[1])
  }

  @Test
  fun aTagReadCarriesTheFilesEmbeddedLyrics() = withDesktop { host ->
    val path = Json.encodeToString(String.serializer(), Fixtures.file("lyrics.mp3").absolutePath)
    host.write("""{"id":1,"method":"readTags","params":{"path":$path}}""")
    val lyrics = host.next()["result"]!!.jsonObject["lyrics"]!!.jsonPrimitive.content
    assertEquals("[00:00.50]Olá, onda\n[00:01.00]Second line", lyrics)
  }

  @Test
  fun answersASearchWithYouTubeMusicsSongs() = withDesktop(youTube("yt/search-songs.json")) { host ->
    host.write("""{"id":2,"method":"search","params":{"query":"get lucky"}}""")
    val songs = host.next()["result"]!!.jsonObject["songs"]!!.jsonArray
    assertEquals(20, songs.size)
    val first = songs.first().jsonObject
    assertEquals("4D7u5KF7SP8", first["videoId"]!!.jsonPrimitive.content)
    assertEquals("Get Lucky (feat. Pharrell Williams and Nile Rodgers)", first["title"]!!.jsonPrimitive.content)
  }

  @Test
  fun aSearchOfflineFailsWithThePhonesCode() =
    withDesktop(youTube(failure = UnknownHostException("music.youtube.com")), online = false) { host ->
      host.write("""{"id":3,"method":"search","params":{"query":"get lucky"}}""")
      assertEquals("ERR_YT_OFFLINE", host.next().code())
    }

  @Test
  fun aLinkedPlaylistOfflineFailsWithThePhonesCode() =
    withDesktop(youTube(failure = UnknownHostException("music.youtube.com")), online = false) { host ->
      host.write("""{"id":30,"method":"playlist","params":{"playlistId":"PLabcdefghijk"}}""")
      assertEquals("ERR_YT_OFFLINE", host.next().code())
    }

  @Test
  fun sharingAPlaylistWithoutAYouTubeSessionSaysSignedOut() = withDesktop { host ->
    host.write("""{"id":31,"method":"createPlaylist","params":{"title":"Night Music","videoIds":["abcdefghijk"],"privacy":"UNLISTED"}}""")
    assertEquals("ERR_YT_SIGNED_OUT", host.next().code())
  }

  @Test
  fun anUnknownMethodFailsWithACode() = withDesktop { host ->
    host.write("""{"id":4,"method":"fly","params":{}}""")
    assertEquals("ERR_UNKNOWN_METHOD", host.next().code())
  }

  @Test
  fun aMissingParamFailsWithACode() = withDesktop { host ->
    host.write("""{"id":5,"method":"search","params":{}}""")
    assertEquals("ERR_BAD_PARAMS", host.next().code())
  }

  @Test
  fun withYtMusicOffASearchAndAStreamFailAsOff() = withDesktop { host ->
    host.write("""{"id":6,"method":"setYtMusic","params":{"enabled":false}}""")
    assertTrue(host.next().containsKey("result"))
    host.write("""{"id":7,"method":"search","params":{"query":"get lucky"}}""")
    assertEquals("ERR_YT_DISABLED", host.next().code())
    host.write("""{"id":8,"method":"resolveStream","params":{"videoId":"4D7u5KF7SP8"}}""")
    assertEquals("ERR_YT_DISABLED", host.next().code())
    host.write("""{"id":9,"method":"setYtMusic","params":{"enabled":true}}""")
    host.next()
    host.write("""{"id":10,"method":"search","params":{"query":"get lucky"}}""")
    assertEquals(20, host.next()["result"]!!.jsonObject["songs"]!!.jsonArray.size)
  }

  @Test
  fun aStreamOfflineFailsWithThePhonesCode() =
    withDesktop(youTube(failure = UnknownHostException("music.youtube.com")), online = false) { host ->
      host.write("""{"id":11,"method":"resolveStream","params":{"videoId":"4D7u5KF7SP8","fresh":true}}""")
      assertEquals("ERR_YT_OFFLINE", host.next().code())
    }

  @Test
  fun aStreamOrASettingWithBadParamsFailsWithACode() = withDesktop { host ->
    host.write("""{"id":12,"method":"resolveStream","params":{"videoId":"../../etc"}}""")
    assertEquals("ERR_BAD_PARAMS", host.next().code())
    host.write("""{"id":13,"method":"setYtMusic","params":{"enabled":"no"}}""")
    assertEquals("ERR_BAD_PARAMS", host.next().code())
  }

  /** YouTube Music answering a watch page (`next`) with [next] and every other request with [other]. */
  private fun youTubeWatch(next: String, other: String): YtHttp =
    youTubeBy { path -> if (path.endsWith("/next")) next else other }

  /** YouTube Music answering a watch page with [watch] and any browse with the lyrics page. */
  private fun youTubeLyrics(watch: String = "yt/next-song.json"): YtHttp =
    youTubeBy { path -> if (path.endsWith("/browse")) "yt/song-lyrics.json" else watch }

  /** YouTube Music answering each request with the fixture [pick] names for its path. */
  private fun youTubeBy(pick: (String) -> String): YtHttp = { _, _ ->
    HttpClient(
      MockEngine { request ->
        val fixture = pick(request.url.encodedPath)
        respond(
          Fixtures.file(fixture).readText(),
          headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
        )
      },
    ) {
      expectSuccess = false
      install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }) }
    }
  }

  @Test
  fun answersAnArtistPageWithItsTopSongs() = withDesktop(youTube("yt/artist-page.json")) { host ->
    host.write("""{"id":20,"method":"artist","params":{"browseId":"UC_kRDKYrUlrbtrSiyu5Tflg"}}""")
    val page = host.next()["result"]!!.jsonObject
    assertEquals("Daft Punk", page["name"]!!.jsonPrimitive.content)
    assertEquals(5, page["songs"]!!.jsonArray.size)
    assertEquals("khnokW3Mw24", page["songs"]!!.jsonArray[0].jsonObject["videoId"]!!.jsonPrimitive.content)
  }

  @Test
  fun answersAnAlbumWithItsTracks() = withDesktop(youTube("yt/album-page.json")) { host ->
    host.write("""{"id":21,"method":"album","params":{"browseId":"MPREb_abc"}}""")
    val album = host.next()["result"]!!.jsonObject
    assertEquals("Random Access Memories", album["title"]!!.jsonPrimitive.content)
    assertEquals(13, album["tracks"]!!.jsonArray.size)
  }

  @Test
  fun answersASongRadioAndItsNextPage() = withDesktop(youTube("yt/radio-song.json")) { host ->
    host.write("""{"id":22,"method":"songRadio","params":{"videoId":"4D7u5KF7SP8"}}""")
    val page = host.next()["result"]!!.jsonObject
    val songs = page["songs"]!!.jsonArray
    assertTrue(songs.isNotEmpty())
    assertTrue(songs[0].jsonObject.containsKey("video"))
    assertTrue(page.containsKey("continuation"))
  }

  @Test
  fun answersMoreOfARadio() = withDesktop(youTube("yt/radio-more.json")) { host ->
    host.write("""{"id":23,"method":"radioMore","params":{"continuation":"token"}}""")
    assertTrue(host.next()["result"]!!.jsonObject["songs"]!!.jsonArray.isNotEmpty())
  }

  @Test
  fun answersArtistsNamedLikeAQuery() = withDesktop(youTube("yt/search-artists.json")) { host ->
    host.write("""{"id":24,"method":"searchArtists","params":{"query":"daft punk"}}""")
    val artists = host.next()["result"]!!.jsonArray
    assertEquals(7, artists.size)
    assertTrue(artists[0].jsonObject["browseId"]!!.jsonPrimitive.content.startsWith("UC"))
  }

  @Test
  fun answersAlbumsNamedLikeAQuery() = withDesktop(youTube("yt/search-albums.json")) { host ->
    host.write("""{"id":28,"method":"searchAlbums","params":{"query":"watch the throne"}}""")
    val albums = host.next()["result"]!!.jsonArray
    assertTrue(albums.isNotEmpty())
    val album = albums[0].jsonObject
    assertEquals("album", album["kind"]!!.jsonPrimitive.content)
    assertTrue(album["browseId"]!!.jsonPrimitive.content.startsWith("MPRE"))
  }

  @Test
  fun answersASongsRelatedTab() =
    withDesktop(youTubeWatch(next = "yt/next-song.json", other = "yt/related-song.json")) { host ->
      host.write("""{"id":25,"method":"related","params":{"videoId":"5NV6Rdv1a3I"}}""")
      val related = host.next()["result"]!!.jsonObject
      assertEquals("Killer Queen", related["songs"]!!.jsonArray[0].jsonObject["title"]!!.jsonPrimitive.content)
      assertEquals("Justice", related["artists"]!!.jsonArray[0].jsonObject["name"]!!.jsonPrimitive.content)
    }

  @Test
  fun aPageReadWithABadIdFailsWithACode() = withDesktop { host ->
    host.write("""{"id":26,"method":"songRadio","params":{"videoId":"../x"}}""")
    assertEquals("ERR_BAD_PARAMS", host.next().code())
    host.write("""{"id":27,"method":"artist","params":{"browseId":"../x"}}""")
    assertEquals("ERR_BAD_PARAMS", host.next().code())
  }

  @Test
  fun readsATracksEmbeddedAndSidecarLyrics() = withDesktop { host ->
    val folder = Fixtures.libraryOf("lyrics.flac" to "Song.flac")
    java.io.File(folder, "Song.lrc").writeText("[00:02.00]Sidecar")
    val path = Json.encodeToString(String.serializer(), java.io.File(folder, "Song.flac").absolutePath)
    host.write("""{"id":14,"method":"readLyrics","params":{"path":$path}}""")
    val lyrics = host.next()["result"]!!.jsonObject
    assertTrue(lyrics["embedded"]!!.jsonPrimitive.content.isNotBlank())
    assertEquals("[00:02.00]Sidecar", lyrics["sidecar"]!!.jsonPrimitive.content)
  }

  @Test
  fun aTrackWithoutLyricsReadsAsNone() = withDesktop { host ->
    val path = Json.encodeToString(String.serializer(), Fixtures.file("tagged.mp3").absolutePath)
    host.write("""{"id":15,"method":"readLyrics","params":{"path":$path}}""")
    val lyrics = host.next()["result"]!!.jsonObject
    assertEquals(JsonNull, lyrics["sidecar"])
  }

  @Test
  fun answersASongsYtMusicLyrics() = withDesktop(youTubeLyrics()) { host ->
    host.write("""{"id":16,"method":"ytLyrics","params":{"videoId":"4D7u5KF7SP8"}}""")
    assertEquals(
      "First line of the song\r\nSecond line\r\n\r\nA line after a break",
      host.next()["result"]!!.jsonPrimitive.content,
    )
  }

  @Test
  fun ytLyricsWithBadParamsOrYtMusicOffFail() = withDesktop(youTubeLyrics()) { host ->
    host.write("""{"id":17,"method":"ytLyrics","params":{"videoId":"../../etc"}}""")
    assertEquals("ERR_BAD_PARAMS", host.next().code())
    host.write("""{"id":18,"method":"setYtMusic","params":{"enabled":false}}""")
    host.next()
    host.write("""{"id":19,"method":"ytLyrics","params":{"videoId":"4D7u5KF7SP8"}}""")
    assertEquals("ERR_YT_DISABLED", host.next().code())
  }

  /** YouTube Music as a signed-in account sees it: its account menu and its library's playlists. */
  private fun youTubeAccount(menu: String = "yt/account-menu-signed-in.json"): YtHttp =
    youTubeBy { path -> if (path.endsWith("/account_menu")) menu else "yt/library-playlists.json" }

  /** A made-up cookie with the names a signed-in one has; no account's. */
  private val fakeCookie = "SAPISID=fake-sapisid; __Secure-3PAPISID=fake-3p; SID=fake-sid"

  private fun JsonObject.status() = this["result"]!!.jsonObject["status"]!!.jsonPrimitive.content

  @Test
  fun signingInAnswersTheAccountAndHandsTheSessionToTheHost() {
    val dataDir = Fixtures.tempDir()
    val host = Host()
    val desktop = WaveDesktop(host.lines, dataDir, http = youTubeAccount(), online = { true })
    withHost(desktop::handle, host) {
      host.write("""{"id":40,"method":"ytSignIn","params":{"cookie":"$fakeCookie","dataSyncId":"123||456","sessionIndex":"1"}}""")
      val answer = host.next()
      assertEquals("signedIn", answer.status())
      assertEquals("Leo Perez", answer["result"]!!.jsonObject["account"]!!.jsonObject["name"]!!.jsonPrimitive.content)
      assertTrue("the answer holds no cookie", "fake-sapisid" !in answer.toString())
      val kept = host.ytSession!!
      assertEquals(fakeCookie, kept["cookie"]!!.jsonPrimitive.content)
      assertEquals("123", kept["dataSyncId"]!!.jsonPrimitive.content)
      assertEquals("1", kept["authUser"]!!.jsonPrimitive.content)
      assertEquals("Leo Perez", kept["account"]!!.jsonObject["name"]!!.jsonPrimitive.content)
      host.write("""{"id":41,"method":"ytSession","params":{}}""")
      assertEquals("signedIn", host.next().status())
    }
    val written = dataDir.walkTopDown().filter { it.isFile }.filter { "fake-sapisid" in it.readText() }.toList()
    assertEquals("no file in the data folder holds the cookie", emptyList<java.io.File>(), written)
  }

  @Test
  fun signingInWithoutTheChannelsIdStillSignsIn() = withDesktop(youTubeAccount()) { host ->
    host.write("""{"id":42,"method":"ytSignIn","params":{"cookie":"$fakeCookie"}}""")
    assertEquals("signedIn", host.next().status())
    assertEquals(JsonNull, host.ytSession!!["dataSyncId"])
    assertEquals("0", host.ytSession!!["authUser"]!!.jsonPrimitive.content)
  }

  @Test
  fun aCookieThatIsntASignedInOneOrThatYouTubeTurnsDownFails() {
    withDesktop(youTubeAccount()) { host ->
      host.write("""{"id":43,"method":"ytSignIn","params":{"cookie":"VISITOR_INFO1_LIVE=x"}}""")
      assertEquals("ERR_YT_FAILED", host.next().code())
      assertEquals(0, host.ytSessionSaves)
    }
    withDesktop(youTubeAccount("yt/account-menu-signed-out.json")) { host ->
      host.write("""{"id":44,"method":"ytSignIn","params":{"cookie":"$fakeCookie"}}""")
      assertEquals("ERR_YT_FAILED", host.next().code())
      assertEquals(0, host.ytSessionSaves)
    }
  }

  /** The session main kept from an earlier run, as it hands it to a JVM that starts. */
  private fun keptSession() = Json.parseToJsonElement(
    """{"cookie":"$fakeCookie","dataSyncId":null,"authUser":"0","account":{"name":"Leo Perez","email":"leo@example.com","photoUrl":null}}""",
  ).jsonObject

  @Test
  fun theSessionTheHostKeepsOpensTheAccountsPlaylists() {
    val (host, desktop) = desktop(youTubeAccount())
    host.ytSession = keptSession()
    withHost(desktop::handle, host) {
      host.write("""{"id":45,"method":"libraryPlaylists","params":{}}""")
      val playlists = host.next()["result"]!!.jsonArray
      assertTrue(playlists.isNotEmpty())
      assertTrue(playlists[0].jsonObject.containsKey("playlistId"))
      host.write("""{"id":46,"method":"ytSession","params":{}}""")
      val session = host.next()
      assertEquals("signedIn", session.status())
      assertEquals("leo@example.com", session["result"]!!.jsonObject["account"]!!.jsonObject["email"]!!.jsonPrimitive.content)
    }
  }

  @Test
  fun theAccountsPlaylistsWithoutASessionSaySignedOut() = withDesktop(youTubeAccount()) { host ->
    host.write("""{"id":47,"method":"libraryPlaylists","params":{}}""")
    assertEquals("ERR_YT_SIGNED_OUT", host.next().code())
  }

  @Test
  fun signingOutForgetsTheSessionOnTheHostToo() {
    val (host, desktop) = desktop(youTubeAccount())
    host.ytSession = keptSession()
    withHost(desktop::handle, host) {
      host.write("""{"id":48,"method":"ytSignOut","params":{}}""")
      assertEquals("signedOut", host.next().status())
      assertEquals(null, host.ytSession)
      assertEquals(1, host.ytSessionSaves)
      host.write("""{"id":49,"method":"libraryPlaylists","params":{}}""")
      assertEquals("ERR_YT_SIGNED_OUT", host.next().code())
    }
  }

  @Test
  fun aSessionYouTubeStoppedAcceptingIsKeptAsExpired() {
    val (host, desktop) = desktop(youTubeAccount("yt/account-menu-signed-out.json"))
    host.ytSession = keptSession()
    withHost(desktop::handle, host) {
      host.write("""{"id":50,"method":"ytCheckSession","params":{}}""")
      assertEquals("expired", host.next().status())
      assertEquals(true, host.ytSession!!["expired"]!!.jsonPrimitive.content.toBoolean())
      assertTrue("an expired session keeps no cookie", !host.ytSession!!.containsKey("cookie"))
    }
  }
}
