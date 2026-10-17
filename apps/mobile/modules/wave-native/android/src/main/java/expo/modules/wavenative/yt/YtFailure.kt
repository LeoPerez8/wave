package expo.modules.wavenative.yt

import com.metrolist.innertubex.InnerTubeHttpException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Why a YT Music request got no songs, as JS sees it (a rejection code): no
 * network, YouTube failed or answered with something unreadable, or YT Music
 * is off in Settings. JS shows the first two as a quiet line.
 */
enum class YtFailure(val code: String) {
  OFFLINE("ERR_YT_OFFLINE"),
  FAILED("ERR_YT_FAILED"),
  DISABLED("ERR_YT_DISABLED");

  companion object {
    /** What [error] means for the owner, given whether the phone was online ([expo.modules.wavenative.net.Connectivity.online]). */
    fun of(error: Throwable, online: Boolean): YtFailure =
      if (!online || generateSequence(error) { it.cause }.any(::isUnreachable)) OFFLINE else FAILED

    private fun isUnreachable(error: Throwable): Boolean =
      error is UnknownHostException ||
        error is ConnectException ||
        error is NoRouteToHostException ||
        error is SocketTimeoutException

    /**
     * The app log's line for [what] (`Songs search "…"`) that failed as [error]: the failure as JS
     * names it (offline, YT Music off, failed), then what native code saw, the HTTP status
     * YouTube answered or the exception's class and message. (Redacted as every line is.)
     * [statusOf] reads the HTTP status off a cause; JVM tests pass their own, since innertubex
     * is built for a newer Java than the unit tests run on.
     */
    fun failedLine(what: String, error: YtException, statusOf: (Throwable) -> Int? = ::innerTubeStatus): String =
      "$what failed (${error.failure.logName}): ${seen(error, statusOf)}"

    private fun innerTubeStatus(cause: Throwable): Int? = (cause as? InnerTubeHttpException)?.status?.value

    private fun seen(error: YtException, statusOf: (Throwable) -> Int?): String {
      val causes = generateSequence(error.cause) { it.cause }.toList()
      causes.firstNotNullOfOrNull(statusOf)?.let { return "HTTP $it" }
      val root = causes.lastOrNull() ?: return when (error.failure) {
        YtFailure.OFFLINE -> "no network"
        YtFailure.DISABLED -> "YT Music is off"
        YtFailure.FAILED -> "no cause given"
      }
      return listOfNotNull(root.javaClass.simpleName, root.message).joinToString(": ")
    }
  }
}

/** A failure as the app log names it, as JS's line for the same search does (Core's `searchFailedLine`). */
private val YtFailure.logName: String
  get() = when (this) {
    YtFailure.OFFLINE -> "offline"
    YtFailure.FAILED -> "failed"
    YtFailure.DISABLED -> "YT Music off"
  }

/** A YT Music request that failed, carrying the code JS reads. */
class YtException(val failure: YtFailure, cause: Throwable? = null) :
  Exception("YT Music request failed: ${failure.name.lowercase()}", cause)
