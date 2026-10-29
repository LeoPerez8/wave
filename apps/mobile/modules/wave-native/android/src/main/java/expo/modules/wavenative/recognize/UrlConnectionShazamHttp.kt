package expo.modules.wavenative.recognize

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** [ShazamHttp] over [HttpURLConnection]. */
class UrlConnectionShazamHttp(private val timeoutMs: Int = 15_000) : ShazamHttp {
  override fun post(request: ShazamRequest): ShazamResponse {
    val connection = URL(request.url).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = timeoutMs
      connection.readTimeout = timeoutMs
      connection.doOutput = true
      request.headers.forEach(connection::setRequestProperty)
      connection.outputStream.use { it.write(request.body.toByteArray()) }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val body = stream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
      return ShazamResponse(status, body)
    } catch (e: RuntimeException) {
      // HttpURLConnection reports some broken connections as runtime exceptions.
      throw IOException(e)
    } finally {
      connection.disconnect()
    }
  }
}
