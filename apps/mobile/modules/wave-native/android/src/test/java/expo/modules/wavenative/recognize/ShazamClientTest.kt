package expo.modules.wavenative.recognize

import expo.modules.wavenative.Fixtures
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test

/** The saved answers are Shazam's (`src/test/resources/fixtures/shazam/README.md`). */
class ShazamClientTest {
  private val signature = ShazamSignature("data:audio/vnd.shazam.sig;base64,gCX+yg==", 8000)
  private val requests = mutableListOf<ShazamRequest>()
  private var answer: (ShazamRequest) -> ShazamResponse = { ShazamResponse(200, saved("no-match")) }

  private fun client(locale: Locale = Locale.forLanguageTag("pt-BR")) = ShazamClient(
    http = { request -> requests += request; answer(request) },
    installId = "5E1B2C3D-0000-4000-8000-00000000AAAA",
    locale = locale,
    timeZone = "America/Sao_Paulo",
    clock = { 1_793_000_000_123 },
    newTagId = { "TAG-1" },
  )

  private fun saved(name: String) = Fixtures.file("shazam/answers/$name.json").readText()

  private fun answering(name: String): RecognizeOutcome {
    answer = { ShazamResponse(200, saved(name)) }
    return client().recognize(signature)
  }

  private val gloria = RecognizedSong(
    title = "I Will Survive",
    artist = "Gloria Gaynor",
    album = "Love Tracks",
    coverUrl = "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/0c/72/a1/0c72a174-9208-6c86-e479-79865376e904/19UMGIM66006.rgb.jpg/400x400cc.jpg",
    isrc = "USUR10200634",
    releaseYear = 1978,
  )

  @Test
  fun `a match names the song`() {
    assertEquals(RecognizeOutcome.Match(gloria), answering("match"))
  }

  @Test
  fun `a match in the phone's language still finds the album and the year`() {
    assertEquals(RecognizeOutcome.Match(gloria), answering("match-pt-BR"))
  }

  @Test
  fun `a match without album or ISRC leaves them out`() {
    assertEquals(RecognizeOutcome.Match(gloria.copy(album = null, isrc = null)), answering("match-without-album"))
  }

  @Test
  fun `no match is its own outcome`() {
    assertEquals(RecognizeOutcome.NoMatch, answering("no-match"))
  }

  @Test
  fun `a request that never gets an answer fails`() {
    answer = { throw SocketTimeoutException("timeout") }
    assertEquals(RecognizeOutcome.Failed(RecognizeFailure.NETWORK), client().recognize(signature))
    answer = { throw IOException("Unable to resolve host") }
    assertEquals(RecognizeOutcome.Failed(RecognizeFailure.NETWORK), client().recognize(signature))
  }

  @Test
  fun `an HTTP error fails, even with a no-match body`() {
    for (status in listOf(429, 404, 500, 503)) {
      answer = { ShazamResponse(status, saved("no-match")) }
      assertEquals("$status", RecognizeOutcome.Failed(RecognizeFailure.REFUSED), client().recognize(signature))
    }
  }

  @Test
  fun `an answer that can't be read fails rather than reading as no match`() {
    val unreadable = listOf(
      "<!DOCTYPE html><html></html>",
      "",
      "{}",
      "[]",
      """{"tagid":"X","retryms":5000}""",
      """{"matches":[{"id":"211404070","offset":92.9}],"tagid":"X"}""",
      """{"matches":[{"id":"1"}],"track":{"key":"1","subtitle":"Gloria Gaynor"}}""",
      """{"matches":[{"id":"1"}],"track":"I Will Survive"}""",
    )
    for (body in unreadable) {
      answer = { ShazamResponse(200, body) }
      assertEquals(body, RecognizeOutcome.Failed(RecognizeFailure.UNREADABLE), client().recognize(signature))
    }
  }

  @Test
  fun `the request is shazamio's, in the phone's language and country`() {
    client().recognize(signature)

    val request = requests.single()
    assertEquals(
      "https://amp.shazam.com/discovery/v5/pt-BR/BR/iphone/-/tag/5E1B2C3D-0000-4000-8000-00000000AAAA/TAG-1" +
        "?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3",
      request.url,
    )
    assertEquals("pt-BR", request.headers["Accept-Language"])
    assertEquals("application/json", request.headers["Content-Type"])
    assertEquals("IPHONE", request.headers["X-Shazam-Platform"])
    val body = Json.parseToJsonElement(request.body).jsonObject
    assertEquals("America/Sao_Paulo", body["timezone"]!!.jsonPrimitive.content)
    assertEquals(1_793_000_000_123, body["timestamp"]!!.jsonPrimitive.long)
    val sent = body["signature"]!!.jsonObject
    assertEquals(signature.uri, sent["uri"]!!.jsonPrimitive.content)
    assertEquals(8000L, sent["samplems"]!!.jsonPrimitive.long)
    assertEquals(JsonObject(emptyMap()), body["context"])
    assertEquals(JsonObject(emptyMap()), body["geolocation"])
  }

  @Test
  fun `a phone language without a country asks for Shazam's US catalogue`() {
    client(Locale.forLanguageTag("fr")).recognize(signature)

    assert(requests.single().url.startsWith("https://amp.shazam.com/discovery/v5/fr/US/iphone/-/tag/"))
  }

  @Test
  fun `each request has its own tag under the install's id`() {
    var tags = 0
    val client = ShazamClient(
      http = { request -> requests += request; ShazamResponse(200, saved("no-match")) },
      installId = "INSTALL",
      locale = Locale.US,
      timeZone = "UTC",
      newTagId = { "TAG-${++tags}" },
    )
    client.recognize(signature)
    client.recognize(signature)

    assertEquals(listOf("INSTALL/TAG-1", "INSTALL/TAG-2"), requests.map { it.url.substringAfter("/tag/").substringBefore('?') })
  }
}
