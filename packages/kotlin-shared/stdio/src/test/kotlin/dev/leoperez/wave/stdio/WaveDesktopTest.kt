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
}
