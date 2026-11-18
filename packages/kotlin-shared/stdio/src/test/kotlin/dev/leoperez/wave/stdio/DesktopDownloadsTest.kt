package dev.leoperez.wave.stdio

import expo.modules.wavenative.Fixtures
import expo.modules.wavenative.tags.JAudioTaggerReader
import expo.modules.wavenative.yt.YtAudioStreams
import expo.modules.wavenative.yt.YtRange
import expo.modules.wavenative.yt.YtStream
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpStatusCode
import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Downloads, Soulseek and tag writes over the desktop's JSON lines, as Electron's main drives them. */
class DesktopDownloadsTest {
  /** YouTube serving [audio] for every video, as googlevideo answers ranges. */
  private class FakeStreams(private val audio: ByteArray) : YtAudioStreams {
    override fun resolve(videoId: String) = YtStream(
      url = "https://example.invalid/$videoId", headers = emptyMap(), mimeType = "audio/mp4; codecs=\"mp4a.40.2\"",
      itag = 140, bitrate = 128_000, contentLength = audio.size.toLong(), expiresAtMs = Long.MAX_VALUE,
    )
    override fun reject(videoId: String) {}
    override fun open(stream: YtStream, start: Long, end: Long): YtRange {
      val last = minOf(end, audio.size - 1L)
      return YtRange(206, ByteArrayInputStream(audio, start.toInt(), (last - start + 1).toInt()))
    }
    override fun headLength(stream: YtStream) = audio.size.toLong()
  }

  private val noYouTube: YtHttp = { _, _ -> HttpClient(MockEngine { respondError(HttpStatusCode.NotFound) }) }

  private fun withDownloads(dataDir: File = Fixtures.tempDir(), block: suspend Calls.() -> Unit) {
    val host = Host()
    val audio = Fixtures.file("fragmented-aac.m4a").readBytes()
    val desktop = WaveDesktop(host.lines, dataDir, http = noYouTube, online = { true }, audioStreams = { FakeStreams(audio) })
    try {
      withHost(desktop::handle, host) { Calls(it).block() }
    } finally {
      desktop.close()
    }
  }

  /** Requests to the JVM, each answered by id; events in between are counted and skipped. */
  private class Calls(private val host: Host) {
    private val ids = AtomicInteger()
    var events = 0

    fun call(method: String, params: String = "{}"): JsonObject {
      val id = ids.incrementAndGet()
      host.write("""{"id":$id,"method":"$method","params":$params}""")
      while (true) {
        val line = host.next()
        if (line["event"] != null) { events++; continue }
        assertEquals(id.toString(), line["id"]!!.jsonPrimitive.content)
        return line
      }
    }

    fun result(method: String, params: String = "{}"): JsonElement =
      call(method, params).let { it["result"] ?: error("$method failed: ${it["error"]}") }

    /** Asks for [id]'s decision until the journal offers [decision]. */
    fun claim(id: String, decision: String): JsonObject {
      repeat(200) {
        val claim = result("downloads.claim", """{"id":${quote(id)}}""")
        if (claim is JsonObject && claim["decision"]?.jsonPrimitive?.content == decision) return claim
        Thread.sleep(50)
      }
      error("No $decision decision for $id")
    }
  }

  @Test
  fun anM4aYouTubeServesPlaysToItsLastSample() {
    assertEquals(1536L, Mp4Length.of(Fixtures.file("fragmented-aac.m4a")))
  }

  @Test
  fun aYouTubeDownloadReachesTheFolderTaggedAndIsImported() = withDownloads {
    val root = Fixtures.tempDir()
    val revision = result("downloads.refreshPolicy", """{"roots":[${quote(root.path)}],"excluded":[]}""")
    val song = """{"videoId":"abcdefghijk","title":"Fixture Song","artists":[{"name":"Fixture Artist"}],"durationMs":1536}"""
    val id = result("downloads.enqueue", """{"song":$song,"source":"youtube"}""").jsonPrimitive.content
    assertEquals("abcdefghijk", id)
    result("downloads.start")

    val target = File(root, "Fixture Artist/Fixture Song.m4a").path
    val prepare = claim(id, "prepare")
    result(
      "downloads.submit",
      """{"id":${quote(id)},"generation":${prepare["generation"]},"token":${prepare["token"]},"decision":"prepare",
        |"payload":{"source":"youtube","candidates":[],"targetPath":${quote(target)},
        |"tags":{"title":"Fixture Song","artist":"Fixture Artist","album":"Fixture Album","genre":"Electronic","lyrics":"la la"}}}""".trimMargin(),
    )

    val confirm = claim(id, "confirm")
    assertEquals(1536.0, confirm["audio"]!!.jsonObject["durationMs"]!!.jsonPrimitive.content.toDouble(), 0.0)
    result(
      "downloads.submit",
      """{"id":${quote(id)},"generation":${confirm["generation"]},"token":${confirm["token"]},"decision":"confirm",
        |"payload":{"receiptId":${confirm["receiptId"]},"acceptable":true}}""".trimMargin(),
    )

    val publish = claim(id, "publish")
    result(
      "downloads.submit",
      """{"id":${quote(id)},"generation":${publish["generation"]},"token":${publish["token"]},"decision":"publish",
        |"payload":{"targetPath":${quote(target)},"revision":$revision}}""".trimMargin(),
    )

    val import = claim(id, "import")
    val saved = import["saved"]!!.jsonObject["path"]!!.jsonPrimitive.content
    assertEquals(target, saved)
    val tags = JAudioTaggerReader().read(File(saved))
    assertEquals("Fixture Song", tags.title)
    assertEquals("Fixture Artist", tags.artist)
    assertEquals("Electronic", tags.genre)
    assertEquals(
      true,
      result(
        "downloads.submit",
        """{"id":${quote(id)},"generation":${import["generation"]},"token":${import["token"]},"decision":"import","payload":{"path":${quote(saved)}}}""",
      ).jsonPrimitive.content.toBoolean(),
    )
    val job = result("downloads.snapshot").jsonArray.single().jsonObject
    assertEquals("completed", job["phase"]!!.jsonPrimitive.content)
    assertTrue("the journal told the host it changed", events > 0)
  }

  @Test
  fun aCancelledJobLeavesTheQueue() = withDownloads {
    val song = """{"videoId":"abcdefghijk","title":"Fixture Song","artists":[],"durationMs":1536}"""
    val id = result("downloads.enqueue", """{"song":$song,"source":"youtube"}""").jsonPrimitive.content
    result("downloads.cancel", """{"id":${quote(id)}}""")
    val job = result("downloads.snapshot").jsonArray.single().jsonObject
    assertEquals("cancelled", job["phase"]!!.jsonPrimitive.content)
  }

  @Test
  fun soulseekStartsOffWithNoAccount() = withDownloads {
    val session = result("soulseek.session").jsonObject
    assertEquals("off", session["status"]!!.jsonPrimitive.content)
    assertEquals(JsonNull, session["username"])
  }

  @Test
  fun fixSongWritesLyricsAndGenreThatTheTagReadSees() = withDownloads {
    val file = File(Fixtures.tempDir(), "song.mp3").also { Fixtures.file("tagged.mp3").copyTo(it) }
    val report = result(
      "tags.writeSong",
      """{"path":${quote(file.path)},"lyrics":"First line","genre":"Bossa Nova","trackNumber":3,"discNumber":null,"year":1999,"advisory":null}""",
    ).jsonObject
    assertTrue("a written report, not a failure: $report", report["failed"] == null)
    val tags = result("readTags", """{"path":${quote(file.path)}}""").jsonObject
    assertEquals("Bossa Nova", tags["genre"]!!.jsonPrimitive.content)
    assertEquals(true, tags["hasLyrics"]!!.jsonPrimitive.content.toBoolean())
  }
}

private fun quote(text: String) = Json.encodeToString(kotlinx.serialization.json.JsonPrimitive.serializer(), kotlinx.serialization.json.JsonPrimitive(text))
