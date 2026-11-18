package expo.modules.wavenative.soulseek

import java.io.IOException

enum class SoulseekFailure(val code: String, val notice: String) {
  /** Download in best quality is off, or the phone has no Soulseek account. */
  SIGNED_OUT("ERR_SLSK_SIGNED_OUT", "Turn on Download in best quality in Settings"),
  /** Soulseek turned the account down: a wrong password, or a name someone else has. */
  AUTH("ERR_SLSK_AUTH", "Soulseek rejected the account"),
  /** Every username drawn for a new account was taken. */
  NO_ACCOUNT("ERR_SLSK_NO_ACCOUNT", "Couldn't make a Soulseek account. Try again"),
  /** The phone is offline, or the connection to Soulseek's server dropped: connecting again tells which. */
  OFFLINE("ERR_SLSK_OFFLINE", "Couldn't connect to Soulseek. Retry when you're online"),
  /** The phone is online but Soulseek's server doesn't answer when connecting. */
  UNREACHABLE("ERR_SLSK_UNREACHABLE", "Soulseek's server can't be reached. Retry later"),
  PEER("ERR_SLSK_PEER", "The peer is unavailable. Retry the download"),
  QUEUED("ERR_SLSK_QUEUED", "The peer queue took too long. Retry the download"),
  INVALID_AUDIO("ERR_SLSK_INVALID_AUDIO", "The received file isn't a complete MP3 320 recording"),
  CANCELLED("ERR_SLSK_CANCELLED", "Download cancelled"),
  STORAGE("ERR_SLSK_STORAGE", "Couldn't save the download"),
  PROTOCOL("ERR_SLSK_PROTOCOL", "Soulseek sent an invalid response"),
}

class SoulseekException(val failure: SoulseekFailure, message: String = failure.notice, cause: Throwable? = null) :
  IOException(message, cause)
