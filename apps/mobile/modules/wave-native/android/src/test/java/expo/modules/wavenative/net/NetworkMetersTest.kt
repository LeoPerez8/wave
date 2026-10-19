package expo.modules.wavenative.net

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Collections
import java.util.zip.GZIPOutputStream
import kotlin.concurrent.thread
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NetworkMetersTest {
  /** What the server answers: a large page, gzipped as YouTube sends it. */
  private val page = "{\"contents\":[" + (1..2000).joinToString(",") { "{\"title\":\"Song $it\"}" } + "]}"
  private val gzipped = ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(page.toByteArray()) } }.toByteArray()

  /** The header names each request reached the server with. */
  private val seenHeaders = Collections.synchronizedList(mutableListOf<Set<String>>())

  private lateinit var server: ServerSocket
  private lateinit var url: String
  private val meters = NetworkMeters()
  private lateinit var http: HttpClient

  /** One answer per connection, as a server closing each would give. */
  private fun serve(server: ServerSocket) {
    while (!server.isClosed) {
      val socket = runCatching { server.accept() }.getOrNull() ?: return
      socket.use {
        val input = it.getInputStream().bufferedReader()
        val headers = generateSequence { input.readLine() }.drop(1).takeWhile(String::isNotEmpty).toList()
        seenHeaders.add(headers.map { line -> line.substringBefore(':').lowercase() }.toSet())
        val head = listOf(
          "HTTP/1.1 200 OK",
          "Content-Type: application/json",
          "Content-Encoding: gzip",
          "Content-Length: ${gzipped.size}",
          "Connection: close",
        ).joinToString(CRLF, postfix = CRLF + CRLF)
        val out = it.getOutputStream()
        out.write(head.toByteArray())
        out.write(gzipped)
        out.flush()
      }
    }
  }

  @Before
  fun start() {
    server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
    thread(isDaemon = true) { serve(server) }
    url = "http://127.0.0.1:${server.localPort}/youtubei/v1/next"
    http = HttpClient(OkHttp) { meteredBy(meters) }
  }

  @After
  fun stop() {
    http.close()
    server.close()
  }

  @Test
  fun aRequestInAMeterCountsTheCompressedBytesItReceived() = runBlocking {
    val meter = meters.start()
    val body = withContext(NetworkMeter(meter)) { http.get(url).bodyAsText() }
    assertEquals("the caller still reads the page unzipped", page, body)
    assertEquals(MeteredUse(requests = 1, bytes = gzipped.size.toLong()), meters.take(meter))
    assertTrue("the meter's header stays on the phone", seenHeaders.none { NetworkMeters.HEADER.lowercase() in it })
  }

  @Test
  fun runsAtOnceEachCountOnlyTheirOwnRequests() = runBlocking {
    val artistMixes = meters.start()
    val genreMixes = meters.start()
    val other = meters.start()
    val requests = listOf(artistMixes, genreMixes, artistMixes).map { meter ->
      async(Dispatchers.IO + NetworkMeter(meter)) { http.get(url).bodyAsText() }
    } + async(Dispatchers.IO) { http.get(url).bodyAsText() }
    requests.awaitAll()
    assertEquals(MeteredUse(2, 2L * gzipped.size), meters.take(artistMixes))
    assertEquals(MeteredUse(1, gzipped.size.toLong()), meters.take(genreMixes))
    assertEquals("a request outside any meter counts on none", MeteredUse(0, 0), meters.take(other))
  }

  @Test
  fun aMeterTakenCountsNoMore() = runBlocking {
    val meter = meters.start()
    withContext(NetworkMeter(meter)) { http.get(url).bodyAsText() }
    meters.take(meter)
    withContext(NetworkMeter(meter)) { http.get(url).bodyAsText() }
    assertEquals(MeteredUse(0, 0), meters.take(meter))
  }

  private companion object {
    const val CRLF = "\r\n"
  }
}
