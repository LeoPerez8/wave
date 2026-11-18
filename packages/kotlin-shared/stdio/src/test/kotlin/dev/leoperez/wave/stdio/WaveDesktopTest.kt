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
  private fun youTubeWatch(next: String, other: String): YtHttp = { _, _ ->
    HttpClient(
      MockEngine { request ->
        val fixture = if (request.url.encodedPath.endsWith("/next")) next else other
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
}
