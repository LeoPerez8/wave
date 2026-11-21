package dev.leoperez.wave.stdio

import expo.modules.wavenative.Fixtures
import expo.modules.wavenative.recognize.ShazamRequest
import expo.modules.wavenative.recognize.ShazamResponse
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Recognize as Electron drives it: audio the host captured goes in, Shazam's answer comes out. */
class DesktopRecognizeTest {
  private val requests = CopyOnWriteArrayList<ShazamRequest>()
  private var answer = "match"
  private val events = mutableListOf<JsonObject>()

  private fun withDesktop(block: (Host) -> Unit) {
    val host = Host()
    val desktop = WaveDesktop(
      host.lines, Fixtures.tempDir(), online = { true },
      shazam = { request ->
        requests += request
        ShazamResponse(200, Fixtures.file("shazam/answers/$answer.json").readText())
      },
    )
    withHost(desktop::handle, host) { block(it) }
    desktop.close()
  }

  /** The answer to request [id], keeping the events that come before it. */
  private fun Host.answerTo(id: Int): JsonObject {
    while (true) {
      val line = next()
      if (line["event"] != null) events += line else if (line["id"]!!.jsonPrimitive.int == id) return line
    }
  }

  /** Sends the fixture's 4 s of audio in 100 ms pieces, each after the one before was taken. */
  private fun Host.sendChordSong(session: Int) {
    val pcm = Fixtures.file("shazam/chord-song.pcm").readBytes()
    var id = 100
    for (start in pcm.indices step 3_200) {
      val piece = Base64.getEncoder().encodeToString(pcm.copyOfRange(start, minOf(pcm.size, start + 3_200)))
      write("""{"id":${++id},"method":"recognize.audio","params":{"session":$session,"pcm":"$piece"}}""")
      answerTo(id)
    }
  }

  private fun Host.waitForHeard(ms: Int) {
    while (events.none { it["event"]!!.jsonPrimitive.content == "recognizeHeard" && it["heardMs"]!!.jsonPrimitive.int == ms }) {
      events += next()
    }
  }

  @Test
  fun namesTheSongInTheAudioTheHostSent() = withDesktop { host ->
    host.write("""{"id":1,"method":"recognize.start","params":{"session":7,"locale":"pt-BR"}}""")
    assertEquals(7, host.answerTo(1)["result"]!!.jsonPrimitive.int)
    host.sendChordSong(7)
    host.waitForHeard(4_000)

    host.write("""{"id":2,"method":"recognize.ask","params":{"session":7,"last":true,"windowMs":12000}}""")
    val outcome = host.answerTo(2)["result"]!!.jsonObject

    assertEquals("match", outcome["kind"]!!.jsonPrimitive.content)
    assertEquals("I Will Survive", outcome["song"]!!.jsonObject["title"]!!.jsonPrimitive.content)
    assertEquals("Gloria Gaynor", outcome["song"]!!.jsonObject["artist"]!!.jsonPrimitive.content)
    val sent = Json.parseToJsonElement(requests.single().body).jsonObject["signature"]!!.jsonObject
    assertEquals(Fixtures.file("shazam/chord-song.uri").readText().trim(), sent["uri"]!!.jsonPrimitive.content)
    assertTrue(requests.single().url.startsWith("https://amp.shazam.com/discovery/v5/pt-BR/BR/iphone/-/tag/"))
    val heard = events.filter { it["event"]!!.jsonPrimitive.content == "recognizeHeard" }
    assertEquals((1..16).map { it * 250 }, heard.map { it["heardMs"]!!.jsonPrimitive.int })
    assertTrue(heard.all { it["session"]!!.jsonPrimitive.int == 7 && it["audible"]!!.jsonPrimitive.boolean })
  }

  @Test
  fun aNoMatchAnswerIsNotAFailure() = withDesktop { host ->
    answer = "no-match"
    host.write("""{"id":1,"method":"recognize.start","params":{"session":1}}""")
    host.answerTo(1)
    host.sendChordSong(1)
    host.waitForHeard(4_000)
    host.write("""{"id":2,"method":"recognize.ask","params":{"session":1,"last":false,"windowMs":12000}}""")
    assertEquals("noMatch", host.answerTo(2)["result"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
  }

  @Test
  fun aCaptureThatEndsOnItsOwnIsReportedAndAStoppedOneIsNot() = withDesktop { host ->
    host.write("""{"id":1,"method":"recognize.start","params":{"session":3}}""")
    host.answerTo(1)
    host.write("""{"id":2,"method":"recognize.stop","params":{"session":3}}""")
    host.answerTo(2)
    host.write("""{"id":3,"method":"recognize.start","params":{"session":4}}""")
    host.answerTo(3)
    host.write("""{"id":4,"method":"recognize.end","params":{"session":4}}""")
    host.answerTo(4)
    while (events.none { it["event"]!!.jsonPrimitive.content == "recognizeCaptureFailed" }) events += host.next()

    assertEquals(listOf(4), events.map { it["session"]!!.jsonPrimitive.int })
  }

  @Test
  fun anAskForASessionThatIsGoneFailsAsEnded() = withDesktop { host ->
    host.write("""{"id":1,"method":"recognize.ask","params":{"session":9,"last":false,"windowMs":12000}}""")
    assertEquals("ERR_RECOGNIZE_ENDED", host.answerTo(1)["error"]!!.jsonObject["code"]!!.jsonPrimitive.content)
  }

  @Test
  fun aDevelopmentBuildSendsShazamsRequestsToTheOriginItWasGiven() {
    val sent = mutableListOf<String>()
    val http = shazamAt("http://127.0.0.1:4100/") { request ->
      sent += request.url
      ShazamResponse(200, "{}")
    }
    http.post(ShazamRequest("$SHAZAM_ORIGIN/discovery/v5/en-US/US/iphone/-/tag/a/b?sync=true", emptyMap(), "{}"))
    http.post(ShazamRequest("https://elsewhere.example/x", emptyMap(), "{}"))

    assertEquals(
      listOf("http://127.0.0.1:4100/discovery/v5/en-US/US/iphone/-/tag/a/b?sync=true", "https://elsewhere.example/x"),
      sent,
    )
  }
}
