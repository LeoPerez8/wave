package expo.modules.wavenative.account

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.ServerSocket
import java.net.SocketException
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/** A request the fake service received. */
data class Received(val method: String, val path: String, val headers: Map<String, String>, val body: String)

/** What the fake service answers. */
data class Reply(val status: Int, val body: String = "")

/** Wave's sync service on a local port: records every request and answers with [respond]. */
class FakeWaveService(var respond: (Received) -> Reply = { Reply(404, """{"error":"not_found"}""") }) : AutoCloseable {
  private val server = ServerSocket(0)
  val url: String get() = "http://127.0.0.1:${server.localPort}"
  val received = CopyOnWriteArrayList<Received>()

  init {
    thread(isDaemon = true) {
      while (!server.isClosed) {
        val socket = try { server.accept() } catch (_: SocketException) { break }
        socket.use {
          val input = BufferedInputStream(it.getInputStream())
          val (method, path) = line(input).split(" ").let { parts -> parts[0] to parts[1] }
          val headers = generateSequence { line(input).takeIf(String::isNotEmpty) }
            .associate { header -> header.substringBefore(":").trim().lowercase() to header.substringAfter(":").trim() }
          val length = headers["content-length"]?.toInt() ?: 0
          val body = ByteArray(length).also { bytes -> var read = 0; while (read < length) read += input.read(bytes, read, length - read) }
          val request = Received(method, path, headers, body.decodeToString())
          received.add(request)
          val reply = respond(request)
          val payload = reply.body.encodeToByteArray()
          val head = "HTTP/1.1 ${reply.status} Fixture\r\nContent-Type: application/json\r\n" +
            "Content-Length: ${payload.size}\r\nConnection: close\r\n\r\n"
          it.getOutputStream().apply { write(head.encodeToByteArray()); write(payload); flush() }
        }
      }
    }
  }

  private fun line(input: InputStream): String {
    val bytes = ByteArrayOutputStream()
    while (true) {
      val byte = input.read()
      if (byte == -1 || byte == '\n'.code) break
      if (byte != '\r'.code) bytes.write(byte)
    }
    return bytes.toString(Charsets.UTF_8)
  }

  override fun close() = server.close()

  companion object {
    /** A URL nothing listens on: the port of a server that was opened and closed. */
    fun closedUrl(): String = ServerSocket(0).use { "http://127.0.0.1:${it.localPort}" }
  }
}
