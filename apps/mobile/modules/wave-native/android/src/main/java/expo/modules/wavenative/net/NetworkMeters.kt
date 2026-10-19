package expo.modules.wavenative.net

import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.okhttp.OkHttpConfig
import io.ktor.client.plugins.api.createClientPlugin
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.currentCoroutineContext
import okhttp3.Interceptor
import okhttp3.MediaType
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.buffer

/** What a meter counted: the requests that went out, and the bytes received for them, as on the wire. */
data class MeteredUse(val requests: Int, val bytes: Long) {
  fun toMap(): Map<String, Any> = mapOf("requests" to requests, "bytes" to bytes.toDouble())
}

/**
 * Counts the network a run uses (docs/spec.md, App log: a mix build, a Magic
 * Queue batch), however many run at once: each run [start]s a meter, makes its
 * requests inside a [NetworkMeter] with its id, and [take]s what it counted at
 * its end. Bytes are counted as received, before OkHttp unzips them.
 */
class NetworkMeters {
  private class Counts {
    val requests = AtomicLong()
    val bytes = AtomicLong()
  }

  private val next = AtomicLong()
  private val open = ConcurrentHashMap<String, Counts>()

  /** A new meter's id. */
  fun start(): String = "meter-${next.incrementAndGet()}".also { open[it] = Counts() }

  /** What meter [id] counted, ending it: nothing for a meter that isn't open. A request it made later counts nowhere. */
  fun take(id: String): MeteredUse {
    val counts = open.remove(id) ?: return MeteredUse(0, 0)
    return MeteredUse(counts.requests.get().toInt(), counts.bytes.get())
  }

  internal fun requested(id: String) {
    open[id]?.requests?.incrementAndGet()
  }

  internal fun received(id: String, bytes: Long) {
    open[id]?.bytes?.addAndGet(bytes)
  }

  companion object {
    /** Carries a request's meter from the caller's coroutine to OkHttp; never sent. */
    const val HEADER = "X-Wave-Network-Meter"
  }
}

/** Requests made in a coroutine with this element count on meter [id] ([NetworkMeters]). */
class NetworkMeter(val id: String) : AbstractCoroutineContextElement(Key) {
  companion object Key : CoroutineContext.Key<NetworkMeter>
}

/**
 * Counts each metered request as it goes on the wire (a retry or redirect too)
 * and the bytes of its answer as they're read, and strips the meter's header.
 */
private class NetworkMeterInterceptor(private val meters: NetworkMeters) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val id = request.header(NetworkMeters.HEADER) ?: return chain.proceed(request)
    meters.requested(id)
    val response = chain.proceed(request.newBuilder().removeHeader(NetworkMeters.HEADER).build())
    return response.newBuilder().body(CountedBody(response.body) { meters.received(id, it) }).build()
  }
}

/** [body], telling [count] each time bytes of it are read. */
private class CountedBody(private val body: ResponseBody, private val count: (Long) -> Unit) : ResponseBody() {
  private val source: BufferedSource by lazy {
    object : ForwardingSource(body.source()) {
      override fun read(sink: Buffer, byteCount: Long): Long {
        val read = super.read(sink, byteCount)
        if (read > 0) count(read)
        return read
      }
    }.buffer()
  }

  override fun contentType(): MediaType? = body.contentType()

  override fun contentLength(): Long = body.contentLength()

  override fun source(): BufferedSource = source

  @Throws(IOException::class)
  override fun close() = body.close()
}

/** Puts the caller's meter ([NetworkMeter]) on each request, for [NetworkMeterInterceptor]. */
private val NetworkMeterPlugin = createClientPlugin("WaveNetworkMeter") {
  onRequest { request, _ ->
    val meter = currentCoroutineContext()[NetworkMeter] ?: return@onRequest
    request.headers.append(NetworkMeters.HEADER, meter.id)
  }
}

/** Counts this ktor client's requests made inside a [NetworkMeter] on [meters]. */
fun HttpClientConfig<OkHttpConfig>.meteredBy(meters: NetworkMeters) {
  engine { addNetworkInterceptor(NetworkMeterInterceptor(meters)) }
  install(NetworkMeterPlugin)
}
