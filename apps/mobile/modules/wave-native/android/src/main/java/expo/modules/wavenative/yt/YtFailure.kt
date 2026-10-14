package expo.modules.wavenative.yt

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
  }
}

/** A YT Music request that failed, carrying the code JS reads. */
class YtException(val failure: YtFailure, cause: Throwable? = null) :
  Exception("YT Music request failed: ${failure.name.lowercase()}", cause)
